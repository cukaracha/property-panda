"""
Browser session for the local scraper.

PropertyGuru sits behind a Cloudflare managed challenge: any non-browser client gets a
hard 403 ("Just a moment..."), so the listings can only be read through a real browser.
Three things here are load bearing:

1. ONE browser for the whole job, and one profile across jobs. Cloudflare hands out a
   `cf_clearance` cookie once a challenge is solved; reusing the same browser keeps that
   cookie for the rest of the run, and the persistent user-data-dir keeps it for the next
   run too. The Streamlit prototype constructed a fresh `webdriver.Chrome()` inside its
   page loop and quit it again, so it threw the clearance away on every page.

2. A REAL, VISIBLE window. Headless Chrome is fingerprinted and never clears the
   challenge. Running headed on the desktop is also what makes the manual escape hatch
   below possible: when Cloudflare decides to ask for a click, there is a window in front
   of the user to click in.

3. A wait that watches the page rather than sleeping a fixed time. `fetch_html` polls
   until the interstitial is gone AND the caller's content marker has rendered. Most
   loads clear on their own within a few seconds; when one does not, the session reports
   that it needs a human, keeps the window open, and carries on the moment the page
   comes good. The prototype instead waited 10s for `#listings-container` — an element
   the site no longer renders — and gave up.
"""

import os
import random
import time

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

CHALLENGE_MARKER = "Just a moment"


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
        self._on_notice = on_notice or (lambda message: None)

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

        self._driver = webdriver.Chrome(options=options)
        self._driver.set_page_load_timeout(PAGE_LOAD_TIMEOUT_SECONDS)
        return self

    def __exit__(self, exc_type, exc, tb):
        if self._driver is not None:
            try:
                self._driver.quit()
            except Exception as e:  # a dead browser must not mask the real job error
                print(f"Browser shutdown failed: {e}")
            self._driver = None

    def fetch_html(self, url: str, must_contain: str = "") -> str:
        """Fetch one URL and return its HTML once the challenge has cleared.

        `must_contain` is the marker that proves the real page rendered rather than the
        interstitial; the wait polls for it instead of sleeping a fixed time.
        """
        last_error = "unknown"

        for attempt in range(MAX_RETRIES):
            try:
                self._driver.get(url)
                html = self._settle(must_contain)
                if html:
                    return html
                last_error = "the human verification was not completed in time"
            except Exception as e:
                last_error = str(e).strip().splitlines()[0] if str(e).strip() else repr(e)

            if attempt < MAX_RETRIES - 1:
                time.sleep(BACKOFF_BASE * (2**attempt) + random.uniform(0, BACKOFF_BASE))

        raise FetchError(f"{url}: {last_error}")

    def _settle(self, must_contain: str) -> str:
        """Poll until the challenge clears and the content marker appears.

        Returns "" if neither happens before the manual deadline. The user is asked for
        help exactly once per load, and only after the automatic window has elapsed, so
        an ordinary page that takes a few seconds never nags.
        """
        started = time.monotonic()
        asked = False

        while True:
            elapsed = time.monotonic() - started
            html = self._driver.page_source or ""

            challenged = CHALLENGE_MARKER in html
            if not challenged and (not must_contain or must_contain in html):
                if asked:
                    self._on_notice("")
                    print("Verification cleared, continuing.")
                return html

            if elapsed > MANUAL_SOLVE_SECONDS:
                if asked:
                    self._on_notice("")
                return ""

            if not asked and elapsed > AUTO_SOLVE_SECONDS:
                asked = True
                notice = (
                    "Waiting for you to complete the human verification in the Chrome "
                    "window that just opened. The search continues by itself once the "
                    "page loads."
                )
                self._on_notice(notice)
                print(f"\n*** {notice} ***\n")

            time.sleep(POLL_INTERVAL_SECONDS)

    def be_polite(self):
        """Wait between page loads, so a multi-page scrape does not hammer the site."""
        if SCRAPE_DELAY_SECONDS > 0:
            time.sleep(SCRAPE_DELAY_SECONDS)
