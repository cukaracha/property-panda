"""
Browser session for the local scraper.

PropertyGuru sits behind a Cloudflare managed challenge: any non-browser client gets a
hard 403 ("Just a moment..."), so the listings can only be read through a real browser.
Four things here are load bearing:

1. ONE browser for the whole job, and one profile across jobs. Cloudflare hands out a
   `cf_clearance` cookie once a challenge is solved; reusing the same browser keeps that
   cookie for the rest of the run, and the persistent user-data-dir keeps it for the next
   run too. The Streamlit prototype constructed a fresh `webdriver.Chrome()` inside its
   page loop and quit it again, so it threw the clearance away on every page.

2. A REAL, VISIBLE window. Headless Chrome is fingerprinted and never clears the
   challenge. Running headed on the desktop is also what makes the manual escape hatch
   below possible: when Cloudflare decides to ask for a click, there is a window in front
   of the user to click in.

3. SEVERAL TABS, not one. A scrape is almost entirely waiting on page loads, so the tabs
   share the wait rather than queueing behind each other. `fetch_many` starts a load with
   `location.replace` (which returns immediately) instead of `driver.get` (which blocks
   until the load event and would serialise the tabs straight back into one). All tabs
   live in the one browser, so they share the one clearance cookie.

   Tabs are for overlapping the waiting, NOT for hitting the site harder: `_await_slot`
   holds every navigation to one shared rate, so N tabs never burst N requests at once.

4. A wait that watches the page rather than sleeping a fixed time. `_probe` runs a few
   lines of JS in the tab instead of dragging the whole DOM back over the wire, and it
   separates the two ways a page can fail to arrive. A challenge gets the full patient
   budget, and the session reports that it needs a human, parks on that tab so the user
   is not fighting the rotation, and carries on the moment the page comes good. A page
   that rendered but simply lacks what the caller asked for is a 404 or a shape that
   moved, so it fails in seconds and is not retried -- waiting out the challenge budget
   three times over for that took 15 minutes and asked the user to solve a challenge
   that was never on screen.
"""

import os
import random
import time
from collections import deque

from selenium import webdriver
from selenium.webdriver.chrome.options import Options

BASE_DIR = os.path.dirname(os.path.abspath(__file__))

# Deliberately NOT the user's own Chrome profile: Chrome refuses to start against a
# user-data-dir another instance already holds, so borrowing the real profile would make
# the scraper unusable whenever the user has Chrome open.
PROFILE_DIR = os.environ.get("CHROME_PROFILE_DIR", os.path.join(BASE_DIR, ".chrome-profile"))

# How long to let Cloudflare clear itself before asking the user to step in. Most loads
# pass well inside this; it is only long enough to not cry wolf on a slow one.
AUTO_SOLVE_SECONDS = float(os.environ.get("AUTO_SOLVE_SECONDS", "30"))
# How long to keep the window open waiting for the user once we have asked. Generous:
# the user may not be looking at the screen when the challenge appears.
MANUAL_SOLVE_SECONDS = float(os.environ.get("MANUAL_SOLVE_SECONDS", "300"))
POLL_INTERVAL_SECONDS = float(os.environ.get("POLL_INTERVAL_SECONDS", "2"))
SCRAPE_DELAY_SECONDS = float(os.environ.get("SCRAPE_DELAY_SECONDS", "5"))
PAGE_LOAD_TIMEOUT_SECONDS = float(os.environ.get("PAGE_LOAD_TIMEOUT_SECONDS", "60"))
MAX_RETRIES = int(os.environ.get("SCRAPE_MAX_RETRIES", "3"))
BACKOFF_BASE = 1.0

TAB_COUNT = max(1, int(os.environ.get("SCRAPE_TABS", "4")))
# Each tab still leaves SCRAPE_DELAY_SECONDS between its own loads, which is what the
# serial scraper did; dividing that across the tabs is what turns the extra tabs into
# extra throughput instead of extra burst.
REQUEST_GAP_SECONDS = SCRAPE_DELAY_SECONDS / TAB_COUNT
# How long after a page finishes rendering to keep looking for the caller's marker, for
# the markup that arrives a beat after readyState flips to complete.
MARKER_GRACE_SECONDS = float(os.environ.get("MARKER_GRACE_SECONDS", "5"))

# Run in the tab rather than pulling `page_source` back on every poll: a search page is
# well over a megabyte of HTML and it was crossing the wire every two seconds per tab.
# getElementById covers `__NEXT_DATA__` (a script id); the innerHTML scan covers a class
# name like `property-attr`.
_PROBE_JS = """
var marker = arguments[0];
if ((document.title || '').indexOf('Just a moment') >= 0) { return 'challenge'; }
if (document.getElementById('challenge-form')) { return 'challenge'; }
if (document.getElementById('cf-challenge-running')) { return 'challenge'; }
if (document.readyState !== 'complete') { return 'loading'; }
if (!marker) { return 'ready'; }
if (document.getElementById(marker)) { return 'ready'; }
return document.documentElement.innerHTML.indexOf(marker) >= 0 ? 'ready' : 'missing';
"""

HELP_NOTICE = (
    "Waiting for you to complete the human verification in the Chrome window that just "
    "opened. The search continues by itself once the page loads."
)


class FetchError(RuntimeError):
    """A page could not be retrieved after every retry was spent."""


class BrowserSession:
    """A context manager owning one visible Chrome instance for one scrape job.

    `on_notice` is called with a short human sentence whenever the session starts or
    stops waiting on the user, so the job row (and therefore the UI) can say what the
    browser is blocked on instead of just sitting on 'scraping'.
    """

    def __init__(self, on_notice=None):
        self._driver = None
        self._tabs = []
        self._on_notice = on_notice or (lambda message: None)
        self._next_slot = 0.0
        # The tab a human is being asked to look at, if any. While one is set the poll
        # stops rotating, so the tab the user is clicking in stays in front of them.
        self._blocked = None

    def __enter__(self):
        options = Options()
        options.add_argument(f"--user-data-dir={PROFILE_DIR}")
        options.add_argument("--window-size=1440,960")
        options.add_argument("--no-first-run")
        options.add_argument("--no-default-browser-check")
        # Chrome shows an "automated test software" infobar and sets navigator.webdriver
        # by default. Both are read by Cloudflare's fingerprint, and neither is needed
        # for anything here.
        options.add_argument("--disable-blink-features=AutomationControlled")
        options.add_experimental_option("excludeSwitches", ["enable-automation"])
        options.add_experimental_option("useAutomationExtension", False)
        # Chrome throttles timers in tabs that are not in front. Cloudflare's challenge
        # runs on those timers, so without these a background tab can sit on the
        # interstitial for as long as the budget allows and never clear it.
        options.add_argument("--disable-background-timer-throttling")
        options.add_argument("--disable-backgrounding-occluded-windows")
        options.add_argument("--disable-renderer-backgrounding")

        self._driver = webdriver.Chrome(options=options)
        self._driver.set_page_load_timeout(PAGE_LOAD_TIMEOUT_SECONDS)

        self._tabs = [self._driver.current_window_handle]
        for _ in range(TAB_COUNT - 1):
            self._driver.switch_to.new_window("tab")
            self._tabs.append(self._driver.current_window_handle)
        return self

    def __exit__(self, exc_type, exc, tb):
        if self._driver is not None:
            try:
                self._driver.quit()
            except Exception as e:  # a dead browser must not mask the real job error
                print(f"Browser shutdown failed: {e}")
            self._driver = None
            self._tabs = []

    # ----------------------------------------------------------------- fetching

    def fetch_html(self, url: str, must_contain: str = "") -> str:
        """Fetch one URL, raising when it never came good.

        For the callers where a missing page ends the job rather than degrading it.
        """
        results = self.fetch_many([(url, url)], must_contain)
        html = results.get(url)
        if not html:
            raise FetchError(f"{url}: never rendered {must_contain or 'any content'}")
        return html

    def fetch_many(self, targets: list, must_contain: str = "", on_progress=None) -> dict:
        """Fetch many URLs across the tabs, returning {key: html} for those that loaded.

        `targets` is a list of (key, url). A URL that never came good is simply absent
        from the result rather than raising, because every batch caller here treats
        enrichment as best effort and one dead project page must not fail a whole job.

        `on_progress(done, total)` is called as the batch settles, so a caller can report
        how far through it is rather than going quiet for the whole batch. A URL counts
        as done once it is neither queued nor in a tab -- fetched, or out of retries --
        so a job waiting out a backoff correctly counts as still outstanding.
        """
        pending = deque(
            {"key": key, "url": url, "attempt": 0, "ready_at": 0.0, "asked": False,
             "missing_since": None}
            for key, url in targets
        )
        active = {}
        results = {}
        total = len(pending)
        done = 0
        if on_progress:
            on_progress(0, total)

        while pending or active:
            self._fill_tabs(pending, active)
            if active:
                self._poll_tabs(pending, active, results, must_contain)
            else:
                # Everything left is still waiting out a retry backoff.
                time.sleep(POLL_INTERVAL_SECONDS)
            settled = total - len(pending) - len(active)
            if on_progress and settled != done:
                done = settled
                on_progress(done, total)

        return results

    def _fill_tabs(self, pending, active):
        """Point every idle tab at the next URL that is due.

        Nothing new starts while the user is being asked to clear a challenge: the site
        has just told us it is unhappy, and queueing more loads into that is the wrong
        answer. The tabs already in flight are left to finish.
        """
        if self._blocked is not None:
            return
        for handle in list(self._tabs):
            if handle in active or not pending:
                continue
            if pending[0]["ready_at"] > time.monotonic():
                break  # the head of the queue is still backing off after a failure
            job = pending.popleft()
            try:
                self._navigate(handle, job["url"])
            except Exception as e:
                self._requeue(pending, job, str(e))
                self._drop_if_dead(handle)
                continue
            job["started"] = time.monotonic()
            job["asked"] = False
            active[handle] = job

    def _navigate(self, handle, url: str):
        """Start a load in one tab without waiting for it to finish."""
        self._await_slot()
        self._driver.switch_to.window(handle)
        # location.replace, not driver.get: get() blocks until the load event, which would
        # serialise the tabs back into the one-at-a-time behaviour this replaced. replace()
        # also keeps the tab's history from growing over hundreds of loads.
        self._driver.execute_script("window.location.replace(arguments[0]);", url)

    def _await_slot(self):
        """Hold every tab to one shared request rate, so N tabs are not N bursts."""
        now = time.monotonic()
        if now < self._next_slot:
            time.sleep(self._next_slot - now)
            now = time.monotonic()
        self._next_slot = now + REQUEST_GAP_SECONDS

    def _poll_tabs(self, pending, active, results, must_contain: str):
        """Check each loading tab once, harvesting, failing or retrying as it resolves."""
        if self._blocked in active:
            handles = [self._blocked]  # park on the tab the user was sent to
        else:
            self._blocked = None
            handles = list(active)

        for handle in handles:
            job = active[handle]
            elapsed = time.monotonic() - job["started"]

            try:
                state = self._probe(handle, must_contain)
            except Exception as e:
                self._release(active, handle)
                self._requeue(pending, job, str(e))
                self._drop_if_dead(handle)
                continue

            if state == "ready":
                results[job["key"]] = self._driver.page_source or ""
                if job["asked"]:
                    print("Verification cleared, continuing.")
                self._release(active, handle)
            elif state == "missing":
                # Rendered, not challenged, and still without what the caller asked for:
                # a 404, a redirect, or a payload whose shape moved. Retrying never fixes
                # any of those, so it gives up now instead of after the challenge budget.
                # The grace runs from the first sighting rather than from the navigation,
                # so a page that was simply slow to arrive is not cut off for it.
                since = job["missing_since"] or time.monotonic()
                job["missing_since"] = since
                if time.monotonic() - since > MARKER_GRACE_SECONDS:
                    print(f"Fetch failed for {job['url']}: no {must_contain} on the page")
                    self._release(active, handle)
            elif state == "challenge":
                job["missing_since"] = None
                if elapsed > MANUAL_SOLVE_SECONDS:
                    self._release(active, handle)
                    self._requeue(pending, job, "human verification was not completed")
                elif not job["asked"] and elapsed > AUTO_SOLVE_SECONDS:
                    job["asked"] = True
                    self._blocked = handle
                    self._driver.switch_to.window(handle)
                    self._on_notice(HELP_NOTICE)
                    print(f"\n*** {HELP_NOTICE} ***\n")
                    return
            else:
                job["missing_since"] = None

        time.sleep(POLL_INTERVAL_SECONDS)

    def _probe(self, handle, must_contain: str) -> str:
        """Ask one tab where it is up to: ready, loading, challenge or missing."""
        self._driver.switch_to.window(handle)
        return self._driver.execute_script(_PROBE_JS, must_contain)

    def _release(self, active, handle):
        """Free one tab for the next URL, clearing any hold the user was put on."""
        active.pop(handle, None)
        if self._blocked == handle:
            self._blocked = None
            if any(job["asked"] for job in active.values()):
                return
            self._on_notice("")

    def _requeue(self, pending, job, reason: str):
        """Put a retryable failure back on the queue, or report it as spent."""
        job["attempt"] += 1
        if job["attempt"] >= MAX_RETRIES:
            print(f"Fetch failed for {job['url']} after {MAX_RETRIES} attempts: {reason}")
            return
        backoff = BACKOFF_BASE * (2 ** (job["attempt"] - 1)) + random.uniform(0, BACKOFF_BASE)
        job["ready_at"] = time.monotonic() + backoff
        pending.append(job)

    def _drop_if_dead(self, handle):
        """Stop handing work to a tab that is no longer there.

        Without this one crashed tab keeps being handed the next URL, burns every retry
        on it, and takes the rest of the batch down with it.
        """
        try:
            if handle in self._driver.window_handles:
                return
        except Exception:
            return  # the whole browser is gone; the next navigation will say so
        if handle in self._tabs:
            self._tabs.remove(handle)
            print(f"Lost a browser tab, continuing on {len(self._tabs)}")
        if not self._tabs:
            raise FetchError("every browser tab was lost")
