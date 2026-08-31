"""
HTTP transport for the local scraper.

PropertyGuru sits behind a Cloudflare managed challenge, but not on every request. Probed
live against the site, only three request shapes are ever refused:

  * a search URL carrying `sort=date` and `order=desc` together,
  * a search URL with the page number in its PATH, which is the form the site's own links
    use (`/property-for-sale/1?page=1` is refused where `/property-for-sale?page=1` is
    not), and
  * any search page past the first, in either form.

Only the second is worth avoiding, and the source stops sending it: the first page is
asked for by the query alone, which costs nothing. The sort pair is still sent, because
the ordering it buys cannot be had any other way and the default is not a date sort at
all. See `build_search_url` in `sources/property_guru.py` for the measurement. That makes
a search's page 1 escalate like any other refused shape, at one credit per property type
group per job.

Everything else -- project pages, listing pages, and a first page under any other sort --
answers 200 to a plain HTTP client, provided that client's TLS and HTTP/2 fingerprints
look like a real Chrome. That is what `curl_cffi` gives, and it is why this
module can replace the visible Chrome window `browser.py` drives.

So there are two tiers:

1. `curl_cffi` impersonating Chrome. Free, fast, and reads everything the site does not
   refuse. It can never clear a challenge: the `cf_clearance` cookie is minted only by
   running the challenge's own JavaScript, which an HTTP client does not do.

2. Bright Data's Web Unlocker, a paid per-request API that runs the challenge on its own
   infrastructure and hands back the page. One credit per request whatever the page
   weighs, so it is spent on exactly the shapes tier 1 cannot read and on nothing else.

Routing is static where the answer is already known and dynamic where it is not. A tier 1
response that comes back challenged escalates to tier 2, and the shape it belongs to is
remembered for the rest of the job so the next page of that kind does not spend a wasted
attempt first. Every measurement behind the static table was taken from one residential
connection, so if a shape starts being refused from somewhere else the escalation covers
it without a code change.

A refusal is one condition: HTTP 403 carrying `cf-mitigated: challenge`. A genuine 404
carries no such header and real markup, so it never escalates and never costs a credit.
"""

import json
import os
import random
import threading
import time
from collections import deque
from concurrent.futures import FIRST_COMPLETED, ThreadPoolExecutor, wait
from urllib.parse import parse_qs, urlsplit

from curl_cffi import requests as curl_requests

# Which Chrome curl_cffi presents itself as. The alias rather than a pinned build, so an
# upgrade of the library tracks a current browser instead of an increasingly odd old one.
IMPERSONATE = os.environ.get("SCRAPE_IMPERSONATE", "chrome")

REQUEST_TIMEOUT_SECONDS = float(os.environ.get("PAGE_LOAD_TIMEOUT_SECONDS", "60"))
MAX_RETRIES = int(os.environ.get("SCRAPE_MAX_RETRIES", "3"))
BACKOFF_BASE = 1.0

# How many requests are in flight at once, per phase. The two phases are not alike: past
# about six search pages at once the site's own origin is the limit, whereas project pages
# are small and cheap and sixteen of them cost it nothing. Both numbers were measured
# through the browser and hold here, since what they bound is the site rather than us.
SCRAPE_SEARCH_CONCURRENCY = max(1, int(os.environ.get("SCRAPE_SEARCH_CONCURRENCY", "6")))
SCRAPE_DETAIL_CONCURRENCY = max(1, int(os.environ.get("SCRAPE_DETAIL_CONCURRENCY", "16")))
# Tier 2 lanes are capped separately, because what bounds them is the Bright Data zone's
# own concurrency limit rather than anything about the site. Ten covers a whole search's
# worth of pages in one wave (MAX_PAGES_CEILING is 10 in `scraper.py`), which matters more
# here than anywhere else: an unlocked page takes tens of seconds, so a second wave is the
# difference between a search that feels slow and one that feels stuck.
UNLOCKER_CONCURRENCY = max(1, int(os.environ.get("UNLOCKER_CONCURRENCY", "10")))
# How often the loop collects what has landed. Short, because this is also how often the
# progress readout can move and how often a cancel can be noticed.
DRAIN_INTERVAL_SECONDS = float(os.environ.get("DRAIN_INTERVAL_SECONDS", "0.25"))

UNLOCKER_URL = "https://api.brightdata.com/request"
# Generous, and deliberately not the tier 1 timeout: the Unlocker is solving a challenge
# before it has anything to send back, so a slow answer is normal rather than a stall.
UNLOCKER_TIMEOUT_SECONDS = float(os.environ.get("UNLOCKER_TIMEOUT_SECONDS", "120"))
BRIGHTDATA_API_KEY = os.environ.get("BRIGHTDATA_API_KEY", "")
BRIGHTDATA_ZONE = os.environ.get("BRIGHTDATA_ZONE", "")
# Where the Unlocker should exit from. Left to itself it picked Los Angeles, and the site
# it is being pointed at is Singaporean: a search page pulls over two hundred subresources
# while it renders, and every one of them was crossing the Pacific twice. Set to empty to
# let Bright Data choose again.
UNLOCKER_COUNTRY = os.environ.get("UNLOCKER_COUNTRY", "sg")

# What the Unlocker's own API answers when the account, not the page, is the problem: a
# bad token, a zone the token cannot use, or a wallet with nothing left in it. Retrying
# any of them spends the budget on an answer that will not change, and letting one pass as
# "the page did not load" would report a short result set as a complete search.
#
# Safe to read this way only because the request asks for `format: "json"`. In `raw` the
# page's own body comes back as the response body, and Bright Data documents nothing about
# whose status the response then carries, so a target that answered 403 would be
# indistinguishable from a token that was refused.
UNLOCKER_ACCOUNT_STATUSES = (401, 402, 403, 407)

NO_CREDENTIALS_NOTICE = (
    "This search needs the pages Cloudflare refuses, and no Bright Data credentials are "
    "set. Set BRIGHTDATA_API_KEY and BRIGHTDATA_ZONE, then run the search again."
)


def _page_number(url: str) -> int:
    """The page this URL asks for, or 1 when it does not ask for one.

    Read off the query rather than off anything site specific: the pages a search
    paginates into are the one shape Cloudflare refuses outright, and every portal names
    that parameter the same way.
    """
    values = parse_qs(urlsplit(url).query).get("page") or []
    try:
        return int(values[0])
    except (IndexError, ValueError):
        return 1


def _shape(url: str) -> str:
    """A coarse key for "requests like this one", which is what an escalation is kept under.

    The first path segment separates a search from a project page from a listing page, and
    the page bucket separates a search's first page from the rest, because those are the
    two axes Cloudflare was measured to distinguish. Anything finer would remember one URL
    rather than a class of them, and escalate nothing.
    """
    section = urlsplit(url).path.strip("/").split("/")[0]
    return f"{section}/{'first' if _page_number(url) <= 1 else 'rest'}"


def _snippet(response) -> str:
    """The first of a response body, for a message. Only ever called on a failure."""
    return (response.text or "")[:200].strip()


def _is_challenge(record: dict) -> bool:
    """Whether Cloudflare refused this response, as opposed to the site answering it."""
    return (
        record.get("status") == 403
        and (record.get("headers") or {}).get("cf-mitigated") == "challenge"
    )


class HttpSession:
    """A context manager owning the HTTP clients for one scrape job.

    `on_notice` is called with a short human sentence when something outside the pages
    themselves goes wrong, so the job row (and therefore the UI) can say what it is rather
    than sitting on 'scraping'. It is the same callback `browser.BrowserSession` took, and
    the same job row field.
    """

    def __init__(self, on_notice=None):
        self._on_notice = on_notice or (lambda message: None)
        self._local = threading.local()
        self._clients = []
        self._escalated = set()
        self._lock = threading.Lock()
        self._counts = {"tier1": 0, "tier2": 0}
        # Tier 2 is bounded here rather than by the lane count, because the lane count
        # belongs to the phase and a batch can be any mix of the two tiers. A worker that
        # has to wait for a credit lane is one that would otherwise have spent one.
        self._unlocker_lanes = threading.Semaphore(UNLOCKER_CONCURRENCY)
        # The first account level refusal from the Unlocker, kept so the job can end as a
        # failure with a reason rather than as a success that is quietly short. See
        # UNLOCKER_ACCOUNT_STATUSES.
        self._transport_error = ""

    def __enter__(self):
        return self

    def __exit__(self, exc_type, exc, tb):
        print(f"Fetched {self._counts['tier1']} direct, {self._counts['tier2']} unlocked")
        for client in self._clients:
            try:
                client.close()
            except Exception as e:  # a dead client must not mask the real job error
                print(f"Could not close a fetch client: {e}")
        self._clients = []

    @property
    def transport_error(self) -> str:
        """The account level failure that stopped this session, or '' when there was none."""
        return self._transport_error

    # ----------------------------------------------------------------- fetching

    def fetch_many(self, targets: list, must_contain: str = "", on_progress=None,
                   concurrency: int = 1, extract_js: str = "", should_abort=None) -> dict:
        """Fetch many URLs in parallel, returning {key: html} for the good ones.

        `targets` is a list of (key, url), where the key is anything hashable and is what
        the result comes back under. A URL that never came good is simply absent from the
        result rather than raising, because every batch caller here treats enrichment as
        best effort and one dead project page must not fail a whole job.

        `concurrency` bounds the FREE tier's requests. The paid tier is bounded by
        `UNLOCKER_CONCURRENCY` instead, and the worker pool is sized to satisfy whichever
        of the two is larger, so neither can quietly cap the other. Sizing the pool at
        `concurrency` alone held tier 2 to `min(concurrency, UNLOCKER_CONCURRENCY)`, which
        meant raising the paid limit past the free one did nothing at all.

        `extract_js` is the source's
        in-browser reducer and is accepted and ignored: it exists to keep a megabyte of
        markup from crossing the WebDriver channel, and there is no such channel here.
        The source's parsers read the whole page the same way either way.

        `on_progress(done, total)` is called as the batch settles, so a caller can report
        how far through it is rather than going quiet for the whole batch. A URL counts as
        done once it is neither queued nor in flight -- fetched, or out of retries -- so a
        job waiting out a backoff correctly counts as still outstanding.

        `should_abort()` is asked between requests. Once it answers True nothing further is
        submitted and what is already in flight is left to finish, because a request handed
        to a worker cannot be taken back. The partial result comes back rather than
        raising, so the caller keeps whatever was already paid for.
        """
        pending = deque(
            {"key": key, "url": url, "attempt": 0, "ready_at": 0.0} for key, url in targets
        )
        results = {}
        total = len(pending)
        resolved = 0
        reported = -1
        lanes = max(1, int(concurrency))
        # Per batch rather than per session, since what a free request costs the site
        # depends on which phase asked for it. The paid gate is the session's own.
        direct_lanes = threading.Semaphore(lanes)
        workers = max(lanes, UNLOCKER_CONCURRENCY)
        abort = should_abort or (lambda: False)

        def report():
            nonlocal reported
            if on_progress and resolved != reported:
                reported = resolved
                on_progress(resolved, total)

        def landed(job, record):
            nonlocal resolved
            status = record.get("status") or 0
            html = record.get("html") or ""
            if status == 200 and (not must_contain or must_contain in html):
                results[job["key"]] = html
                resolved += 1
            elif status in (200, 404):
                # Served, not refused, and still without what the caller asked for: a 404,
                # a redirect, or a payload whose shape moved. Retrying never fixes any of
                # those, so it gives up now rather than three times over.
                print(f"Fetch failed for {job['url']}: no {must_contain} in the response")
                resolved += 1
            elif record.get("fatal"):
                # Nothing about this one will be different on the third attempt either.
                resolved += 1
            elif not self._requeue(pending, job, record.get("reason") or f"HTTP {status}"):
                resolved += 1

        report()
        in_flight = {}
        with ThreadPoolExecutor(max_workers=workers, thread_name_prefix="fetch") as pool:
            while pending or in_flight:
                if abort():
                    pending.clear()

                while pending and len(in_flight) < workers:
                    job = self._take_due(pending)
                    if job is None:
                        break
                    in_flight[pool.submit(self._fetch, job["url"], direct_lanes)] = job

                if not in_flight:
                    # Everything left is still waiting out a retry backoff.
                    time.sleep(DRAIN_INTERVAL_SECONDS)
                    continue

                done, _ = wait(
                    in_flight, timeout=DRAIN_INTERVAL_SECONDS, return_when=FIRST_COMPLETED
                )
                for future in done:
                    job = in_flight.pop(future)
                    try:
                        record = future.result()
                    except Exception as e:
                        # Nothing in _fetch is meant to raise, so this is the transport
                        # failing in a way it does not report. Treated as any other
                        # refused request, which is to say retried and then given up on.
                        record = {"status": 0, "html": "", "reason": str(e), "headers": {}}
                    landed(job, record)
                report()

        return results

    def _take_due(self, pending):
        """Take the first queued job whose backoff has expired, or None when none has."""
        now = time.monotonic()
        for _ in range(len(pending)):
            job = pending.popleft()
            if job["ready_at"] <= now:
                return job
            pending.append(job)
        return None

    def _fetch(self, url: str, direct_lanes) -> dict:
        """Fetch one URL through whichever tier its shape calls for.

        Tier 1 first unless the shape is already known to be refused, and one escalation
        on a refusal. There is no path back down: a shape that was challenged once stays
        on tier 2 for the rest of the job, since the clearance an HTTP client would need in
        order to try again is exactly what it cannot get.

        The two gates are held one at a time and never together, so a worker escalating
        releases the free lane before it waits on a paid one and the two cannot deadlock.
        """
        if self._tier_of(url) == 1:
            with direct_lanes:
                record = self._fetch_direct(url)
            if not _is_challenge(record):
                return record
            with self._lock:
                self._escalated.add(_shape(url))
            print(f"Cloudflare refused {url}, escalating {_shape(url)} to the unlocker")
        return self._fetch_unlocked(url)

    def _tier_of(self, url: str) -> int:
        """Which tier this URL starts on: 2 for a shape known to be refused, 1 otherwise."""
        if _page_number(url) > 1:
            return 2
        with self._lock:
            return 2 if _shape(url) in self._escalated else 1

    def _fetch_direct(self, url: str) -> dict:
        """Tier 1: one plain request wearing Chrome's own TLS and HTTP/2 fingerprint."""
        try:
            response = self._client().get(url, timeout=REQUEST_TIMEOUT_SECONDS)
        except Exception as e:
            return {"status": 0, "html": "", "reason": str(e), "headers": {}}
        self._count("tier1")
        return {
            "status": response.status_code,
            "html": response.text,
            "reason": "",
            # Lowercased into a plain dict, so the one header this reads is looked up the
            # same way whatever the client hands back.
            "headers": {key.lower(): value for key, value in response.headers.items()},
        }

    def _fetch_unlocked(self, url: str) -> dict:
        """Tier 2: hand the URL to Bright Data's Web Unlocker and take the page it returns.

        `format: "json"` rather than `"raw"`, which costs a JSON decode of the page and
        buys the one distinction this needs. The envelope is
        `{"status_code": ..., "headers": {...}, "body": "<html>"}`, so the target's verdict
        arrives as a field and the HTTP status of this response stays Bright Data's own.
        Under `raw` the two are the same number and nothing documents which one it is,
        which would leave a page that genuinely 403s looking exactly like a refused token.

        `status_code` is the key a live call actually returns. Bright Data's own docs
        write it as `status`, so both are read here and the observed one wins.

        The record this returns is therefore shaped exactly like tier 1's, target status
        and target headers included, so everything downstream reads both tiers the same
        way -- the challenge check included, which is what would catch the Unlocker itself
        being turned away.
        """
        if not BRIGHTDATA_API_KEY or not BRIGHTDATA_ZONE:
            return self._account_error(NO_CREDENTIALS_NOTICE)
        try:
            payload = {"zone": BRIGHTDATA_ZONE, "url": url, "format": "json"}
            if UNLOCKER_COUNTRY:
                payload["country"] = UNLOCKER_COUNTRY
            with self._unlocker_lanes:
                response = self._client().post(
                    UNLOCKER_URL,
                    headers={"Authorization": f"Bearer {BRIGHTDATA_API_KEY}"},
                    json=payload,
                    timeout=UNLOCKER_TIMEOUT_SECONDS,
                )
        except Exception as e:
            return {"status": 0, "html": "", "reason": str(e), "headers": {}}
        self._count("tier2")
        if response.status_code in UNLOCKER_ACCOUNT_STATUSES:
            return self._account_error(
                f"Bright Data refused the request with HTTP {response.status_code}. "
                f"{_snippet(response)}"
            )
        if response.status_code != 200:
            # Their side, but not fatally: a bad gateway or a target they could not reach
            # is worth the same retry any other transport failure gets.
            return {"status": 0, "html": "", "reason": f"unlocker HTTP {response.status_code}",
                    "headers": {}}
        try:
            envelope = json.loads(response.text)
        except ValueError:
            return {
                "status": 0,
                "html": "",
                "reason": f"unlocker sent no JSON envelope. {_snippet(response)}",
                "headers": {},
            }
        return {
            "status": int(envelope.get("status_code") or envelope.get("status") or 0),
            "html": envelope.get("body") or "",
            "reason": "",
            "headers": {
                str(key).lower(): value for key, value in (envelope.get("headers") or {}).items()
            },
        }

    def _account_error(self, message: str) -> dict:
        """Record an account level refusal, tell the user, and mark the page unretryable.

        The first one is what the job reports, because the rest of the batch is about to
        hit the same wall and a later message would only overwrite the reason with a copy
        of itself.
        """
        with self._lock:
            first = not self._transport_error
            if first:
                self._transport_error = message
        if first:
            print(message)
            self._on_notice(message)
        return {"status": 0, "html": "", "reason": message, "headers": {}, "fatal": True}

    def _client(self):
        """The calling thread's own client.

        One per worker rather than one per session: a client owns a curl handle and a
        connection pool, and two threads sharing one would interleave on it. One each
        keeps the connection reuse that makes a batch cheap without that risk.
        """
        client = getattr(self._local, "client", None)
        if client is None:
            client = curl_requests.Session(impersonate=IMPERSONATE)
            self._local.client = client
            with self._lock:
                self._clients.append(client)
        return client

    def _count(self, tier: str):
        """Tally one request against its tier, since tier 2 requests are paid for."""
        with self._lock:
            self._counts[tier] += 1

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


def open_session(on_notice=None):
    """Open a session for one scrape job. This transport reads the site over HTTP, escalating to the unlocker.

    Every transport module offers this name, so `scraper._TRANSPORTS` can hold the modules
    themselves and the job never has to know which class it ended up with.
    """
    return HttpSession(on_notice=on_notice)
