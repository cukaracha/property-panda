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

3. FETCHING FROM INSIDE A CLEARED PAGE, rather than navigating to each one. Navigation
   rendered every page in full -- a search page pulls over two hundred subresources of
   images, ads and trackers -- to read a payload out of it and throw the rest away.
   `fetch()` issued from a tab that is already on the site inherits the clearance cookie,
   Chrome's own TLS fingerprint and the open connection, and skips the rendering
   entirely. Measured against the navigation it replaces, that is roughly thirty five
   times faster end to end.

   The fetches run as a bounded pool inside that one tab, and the source's own extractor
   reduces each response to what its parser reads before it crosses the WebDriver
   channel. Python starts the pool and returns immediately (`execute_script`, not
   `execute_async_script`), then drains it in small sips: blocking on a whole batch would
   freeze the progress readout for most of a cold run.

   The pool is bounded per phase, not globally. Search pages saturate the site's own
   origin at around six in flight while project pages take sixteen happily, and one
   number for both would either throttle enrichment or lean on search harder than it
   takes.

4. A NAVIGATION FALLBACK for the challenge, because `fetch()` cannot clear one: it gets
   the 403 body back and nothing ever runs the challenge inside it. A refused batch parks
   a second tab on the URL the site would not serve and watches it with `_probe`, a few
   lines of JS in the tab rather than the whole DOM over the wire. The challenge gets a
   patient budget of its own, and only then does the session say it needs a human and put
   that window in front of them. The pool carries on the moment the page comes good.
"""

import os
import random
import time
from collections import deque
from urllib.parse import urlsplit

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
PAGE_LOAD_TIMEOUT_SECONDS = float(os.environ.get("PAGE_LOAD_TIMEOUT_SECONDS", "60"))
MAX_RETRIES = int(os.environ.get("SCRAPE_MAX_RETRIES", "3"))
BACKOFF_BASE = 1.0

# How many requests the in-page pool keeps in flight, per phase. The two phases are not
# alike: past about six search pages at once the site's own origin is the limit (time to
# first byte climbs while throughput stays flat), whereas project pages are small and
# cheap and sixteen of them cost it nothing.
SCRAPE_SEARCH_CONCURRENCY = max(1, int(os.environ.get("SCRAPE_SEARCH_CONCURRENCY", "6")))
SCRAPE_DETAIL_CONCURRENCY = max(1, int(os.environ.get("SCRAPE_DETAIL_CONCURRENCY", "16")))
# How often Python collects what the pool has finished. Short, because this is also how
# often the progress readout can move.
DRAIN_INTERVAL_SECONDS = float(os.environ.get("DRAIN_INTERVAL_SECONDS", "0.25"))
# A pool that has returned nothing for this long is not going to. Each request already
# aborts itself at the page load timeout, so the only way to reach this is the tab having
# stopped running the loop at all, and the batch is better retried than waited on.
STALL_SECONDS = PAGE_LOAD_TIMEOUT_SECONDS * 2

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

# The fetch pool, started once per batch and left running in the anchor tab. It keeps its
# results on `window.__pg` for _DRAIN_JS to collect, so the Python side never has to
# block on the batch to see any of it.
#
# The source's extractor is spliced in as a function body rather than built in the page
# with `new Function`, which the site's own content security policy is free to refuse.
# What chromedriver evaluates is one script, so there is no second eval to be blocked.
_START_JS = """
var targets = arguments[0];
var lanes = arguments[1];
var timeoutMs = arguments[2];

function reduce(text) {
__EXTRACT_BODY__
}

var state = {out: [], finished: 0, total: targets.length};
window.__pg = state;

var next = 0;
function pump() {
    if (next >= targets.length) { return; }
    var target = targets[next++];
    var slot = target[0];
    // Nothing else bounds a fetch: it has no timeout of its own, and one request left
    // hanging would hold its lane for the rest of the batch.
    var stop = new AbortController();
    var timer = setTimeout(function () { stop.abort(); }, timeoutMs);
    fetch(target[1], {credentials: 'include', signal: stop.signal})
        .then(function (response) {
            return response.text().then(function (text) {
                var html = '';
                try { html = reduce(text) || ''; } catch (e) { html = ''; }
                return {slot: slot, status: response.status, html: html, reason: ''};
            });
        })
        .catch(function (e) {
            return {slot: slot, status: 0, html: '', reason: String(e)};
        })
        .then(function (record) {
            clearTimeout(timer);
            state.out.push(record);
            state.finished += 1;
            pump();
        });
}
for (var i = 0; i < Math.min(lanes, targets.length); i++) { pump(); }
"""

# Hand back what has landed and clear it in the same breath, so a long batch never
# accumulates in the tab's memory.
_DRAIN_JS = """
var state = window.__pg;
if (!state) { return null; }
var batch = state.out;
state.out = [];
return {finished: state.finished, total: state.total, batch: batch};
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
        # Two tabs with two jobs. The anchor holds a cleared page on the site and never
        # leaves it during a batch, because every fetch runs from that document and a
        # navigation would take the pool down with it. The solve tab is the one the user
        # is sent to when a challenge needs a human.
        self._anchor = None
        self._solve = None
        self._origin = ""
        self._on_notice = on_notice or (lambda message: None)
        # Set once a manual verification has run out of time. Asking a second time just
        # spends another five minutes on a batch that is lost either way.
        self._gave_up = False

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

        self._anchor = self._driver.current_window_handle
        self._driver.switch_to.new_window("tab")
        self._solve = self._driver.current_window_handle
        self._driver.switch_to.window(self._anchor)
        return self

    def __exit__(self, exc_type, exc, tb):
        if self._driver is not None:
            try:
                self._driver.quit()
            except Exception as e:  # a dead browser must not mask the real job error
                print(f"Browser shutdown failed: {e}")
            self._driver = None
            self._anchor = None
            self._solve = None

    # ----------------------------------------------------------------- fetching

    def fetch_html(self, url: str, must_contain: str = "", extract_js: str = "") -> str:
        """Fetch one URL, raising when it never came good.

        For the callers where a missing page ends the job rather than degrading it.
        """
        results = self.fetch_many([(url, url)], must_contain, extract_js=extract_js)
        html = results.get(url)
        if not html:
            raise FetchError(f"{url}: never returned {must_contain or 'any content'}")
        return html

    def fetch_many(self, targets: list, must_contain: str = "", on_progress=None,
                   concurrency: int = 1, extract_js: str = "") -> dict:
        """Fetch many URLs from inside the anchor tab, returning {key: html} for the good ones.

        `targets` is a list of (key, url), where the key is anything hashable and is what
        the result comes back under. A URL that never came good is simply absent
        from the result rather than raising, because every batch caller here treats
        enrichment as best effort and one dead project page must not fail a whole job.

        `concurrency` is how many of them are in flight at once and `extract_js` is the
        source's own reducer, run on each response inside the browser so only what the
        parser reads crosses the wire. Neither changes what comes back, only what it
        costs.

        `on_progress(done, total)` is called as the batch settles, so a caller can report
        how far through it is rather than going quiet for the whole batch. A URL counts
        as done once it is neither queued nor in flight -- fetched, or out of retries --
        so a job waiting out a backoff correctly counts as still outstanding.
        """
        pending = deque(
            {"key": key, "url": url, "attempt": 0, "ready_at": 0.0} for key, url in targets
        )
        results = {}
        total = len(pending)
        resolved = 0
        reported = -1
        lanes = max(1, int(concurrency))

        def report():
            nonlocal reported
            if on_progress and resolved != reported:
                reported = resolved
                on_progress(resolved, total)

        report()

        while pending:
            batch = self._take_due(pending)
            if not batch:
                # Everything left is still waiting out a retry backoff.
                time.sleep(DRAIN_INTERVAL_SECONDS)
                continue

            challenged = ""

            def landed(job, record):
                nonlocal resolved, challenged
                status = record.get("status") or 0
                html = record.get("html") or ""
                if status == 200 and (not must_contain or must_contain in html):
                    results[job["key"]] = html
                    resolved += 1
                elif status in (200, 404):
                    # Served, not refused, and still without what the caller asked for: a
                    # 404, a redirect, or a payload whose shape moved. Retrying never
                    # fixes any of those, so it gives up now rather than three times over.
                    print(f"Fetch failed for {job['url']}: no {must_contain} in the response")
                    resolved += 1
                else:
                    if status in (403, 503):
                        challenged = challenged or job["url"]
                    if not self._requeue(pending, job, record.get("reason") or f"HTTP {status}"):
                        resolved += 1
                report()

            for job in self._run_batch(batch, lanes, extract_js, landed):
                if not self._requeue(pending, job, "the browser stopped fetching"):
                    resolved += 1
            report()

            # Only once the batch is over, and only if there is still work: a challenge
            # takes a navigation to clear, and navigating while the pool is running would
            # pull the document out from under it.
            if challenged and pending:
                self._solve_challenge(challenged)

        return results

    def _take_due(self, pending) -> list:
        """Take every queued job whose backoff has expired, leaving the rest queued."""
        now = time.monotonic()
        batch, held = [], deque()
        while pending:
            job = pending.popleft()
            (batch if job["ready_at"] <= now else held).append(job)
        pending.extend(held)
        return batch

    def _run_batch(self, batch: list, lanes: int, extract_js: str, landed) -> list:
        """Run one batch through the in-page pool, calling `landed(job, record)` as it goes.

        Returns the jobs that never came back, for the caller to retry. A batch ends when
        the pool says it has finished, when the document it was running in went away, or
        when it has been quiet long enough that it is not going to finish.

        What goes into the browser to identify a fetch is its slot in this batch, never
        the caller's own key. Everything crossing that boundary is JSON, so a key that is
        not a JSON scalar comes back as something else: a tuple leaves as an array and
        returns as a list, which is not even hashable. The slot is a string this method
        makes up and only this method reads, which is what lets `fetch_many` accept any
        key the caller finds natural.
        """
        outstanding = {str(slot): job for slot, job in enumerate(batch)}
        try:
            self._anchor_at(batch[0]["url"])
            self._driver.execute_script(
                _START_JS.replace("__EXTRACT_BODY__", extract_js or "return text;"),
                [[slot, job["url"]] for slot, job in outstanding.items()],
                lanes,
                int(PAGE_LOAD_TIMEOUT_SECONDS * 1000),
            )
        except Exception as e:
            print(f"Could not start a batch of {len(batch)}: {e}")
            return list(outstanding.values())

        last_landing = time.monotonic()
        while outstanding:
            time.sleep(DRAIN_INTERVAL_SECONDS)
            try:
                drained = self._driver.execute_script(_DRAIN_JS)
            except Exception as e:
                print(f"Lost contact with the browser mid-batch: {e}")
                break
            if not drained:
                print("The fetching tab navigated away, retrying what it was holding")
                break

            for record in drained.get("batch") or []:
                job = outstanding.pop(record.get("slot"), None)
                if job is not None:
                    landed(job, record)

            if drained.get("batch"):
                last_landing = time.monotonic()
            elif time.monotonic() - last_landing > STALL_SECONDS:
                print("The fetching tab went quiet, retrying what it was holding")
                break
            if (drained.get("finished") or 0) >= (drained.get("total") or 0):
                break

        return list(outstanding.values())

    def _anchor_at(self, url: str):
        """Leave the anchor tab on this URL's own origin, cleared and ready to fetch from.

        The fetches are same-origin requests made by that document, which is what carries
        the clearance cookie into them. It is navigated only when it is not already there,
        because a navigation costs the batch its pool.
        """
        parts = urlsplit(url)
        origin = f"{parts.scheme}://{parts.netloc}/"
        if self._origin != origin or self._probe(self._anchor, "") != "ready":
            self._origin = ""
            if not self._solve_challenge(origin, self._anchor):
                raise FetchError(f"{origin}: the browser could not get onto the site")
            self._origin = origin
        # Explicitly, and last: the pool is about to be started in whichever tab is
        # current, and a verification may have left that as the other one.
        self._driver.switch_to.window(self._anchor)

    def _solve_challenge(self, url: str, handle=None) -> bool:
        """Navigate one tab at a URL the site refused, and wait for it to come good.

        This is the only thing a navigation is still for. `fetch()` cannot clear a
        Cloudflare interstitial: it is handed the 403 body and nothing ever runs the
        challenge inside it, so the page has to be loaded for real. The wait watches the
        page rather than sleeping a fixed time, gives the challenge a patient budget on
        its own, and only then asks the user, leaving that tab in front of them so there
        is something to click in.
        """
        handle = handle or self._solve
        if self._gave_up:
            return False
        try:
            self._driver.switch_to.window(handle)
            # location.replace rather than driver.get: get() blocks until the load event,
            # which a challenge page does not reach until it has cleared. It also keeps
            # the tab's history from growing over a long job.
            self._driver.execute_script("window.location.replace(arguments[0]);", url)
        except Exception as e:
            print(f"Could not open {url} for verification: {e}")
            return False

        started = time.monotonic()
        asked = False
        while True:
            try:
                state = self._probe(handle, "")
            except Exception as e:
                print(f"Verification tab failed: {e}")
                return False

            if state == "ready":
                if asked:
                    print("Verification cleared, continuing.")
                    self._on_notice("")
                return True

            elapsed = time.monotonic() - started
            if elapsed > MANUAL_SOLVE_SECONDS:
                if asked:
                    self._gave_up = True
                    self._on_notice("")
                print(f"Gave up waiting for {url}")
                return False
            if state == "challenge" and not asked and elapsed > AUTO_SOLVE_SECONDS:
                asked = True
                self._driver.switch_to.window(handle)
                self._on_notice(HELP_NOTICE)
                print(f"\n*** {HELP_NOTICE} ***\n")
            time.sleep(POLL_INTERVAL_SECONDS)

    def _probe(self, handle, must_contain: str) -> str:
        """Ask one tab where it is up to: ready, loading, challenge or missing."""
        self._driver.switch_to.window(handle)
        return self._driver.execute_script(_PROBE_JS, must_contain)

    def _requeue(self, pending, job, reason: str) -> bool:
        """Put a retryable failure back on the queue, or report it as spent.

        True when it will be tried again, so the caller knows whether to count it as one
        more URL settled.
        """
        job["attempt"] += 1
        if job["attempt"] >= MAX_RETRIES:
            print(f"Fetch failed for {job['url']} after {MAX_RETRIES} attempts: {reason}")
            return False
        backoff = BACKOFF_BASE * (2 ** (job["attempt"] - 1)) + random.uniform(0, BACKOFF_BASE)
        job["ready_at"] = time.monotonic() + backoff
        pending.append(job)
        return True
