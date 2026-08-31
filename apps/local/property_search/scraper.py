"""
The scrape job itself: search pages in, grouped properties out.

For each job it walks the source's search result pages in one session, enriches each
distinct property from its project page (cached), groups everything into the shape the UI
renders, and records the result and the terminal status on the job row.

Which transport that session is comes from the mode the user has chosen, and reaches no
further than `run_job`: `fetching` reads the site over HTTP, `browser` drives a visible
Chrome, and both answer the same calls. A search run in one mode and re-run in the other
returns the same thing, so nothing recorded here says which one read the pages.

A job is one search per property type group, since a single query cannot span two of them
(see `sources/property_guru.py`). They are not sequential scrapes: every group's pages go
into the same batches as every other group's, so three groups cost the wall clock of one.
Each group carries its own filters and its own page budget, which is the point of the
fan-out rather than a consequence of it.

Both phases hand their URLs to the session in one batch, so it can have several of them
in flight at once, and each says how many that should be: search pages are heavier on the
site than project pages are. Enrichment is where the concurrency matters most, since it
is one request per distinct property and dominates a cold run, while the search itself is
only ever a handful of pages.

Both phases end in a filter check, and each record is checked against the filters of the
group it came from rather than against some merged set. The source's query is what does
the real filtering, so this only catches what came back contradicting it -- a bound the
site quietly ignored, or a card that was never a search hit in the first place. Silently
keeping those reads as a broad search rather than as a bug, which is why the check is here
at all.

Status moves queued -> scraping -> enriching -> succeeded, or -> failed, or -> cancelled
when the user stops it. A cancel is cooperative: a request already handed to a worker
cannot be taken back, so it stops the job submitting new ones rather than interrupting
what is in flight. Nothing is written as a result, but whatever enrichment had already
paid for stays in the property cache, since those pages cost the same to fetch again.

Enrichment is best effort by design: a project page that will not load leaves that
property flagged `enrichment: "unavailable"` rather than failing a job whose listings are
all fine.
"""

import time
import traceback

import browser
import fetching
import grouping
import store
from sources.property_guru import PropertyGuruSource

# Bounds an explicit page count. A maxPages of 0 asks for every page and is not capped.
MAX_PAGES_CEILING = 10

# A failure's debuggable detail rides on the job row so it reaches the UI.
DETAIL_MAX_CHARS = 4000

# How often the scrape thread may re-read the cancel flag. It is asked between every
# request, and the answer sits behind the store's one lock, so an unthrottled read would
# take that lock thousands of times a job for something that changes at most once.
CANCEL_POLL_SECONDS = 0.25

# (min filter, max filter, listing field) for every bound `keep_matching_listings` checks.
_RANGE_CHECKS = (
    ("minPrice", "maxPrice", "price"),
    ("minSize", "maxSize", "floorAreaSqft"),
    ("minPsf", "maxPsf", "psf"),
)

_SOURCES = {PropertyGuruSource.name: PropertyGuruSource}

# The transports a job can read the pages through, keyed by the mode the user picks in the
# sidebar. `api` is unattended and spends unlocker credits on the page shapes Cloudflare
# refuses; `browser` is free and asks the user to clear those by hand. Both offer the same
# session, so the choice reaches no further than this module: what a search returns is the
# same either way, and nothing downstream records which one read it.
_TRANSPORTS = {"api": fetching, "browser": browser}


class Cancelled(Exception):
    """The user asked for this job to stop. Not a failure: nothing went wrong."""


def get_source(name: str):
    """Resolve a source adapter by name. Adding a portal means one entry in _SOURCES."""
    source_class = _SOURCES.get(name or PropertyGuruSource.name)
    if source_class is None:
        raise ValueError(f"Unknown source: {name}")
    return source_class()


def get_transport(mode: str):
    """Resolve the transport module for a scrape mode, the way get_source does a portal."""
    transport = _TRANSPORTS.get(mode)
    if transport is None:
        raise ValueError(f"Unknown scrape mode: {mode}")
    return transport


def _check_stopped(session, abort):
    """End the job early when the user has asked it to stop, or the transport itself failed.

    Two very different endings from one place, because both are decided between phases
    rather than inside them. A cancel means nothing further should be fetched. A transport
    error means the tier that reads the pages Cloudflare refuses has stopped answering at
    all, so what has been gathered is short for a reason the result payload has no way to
    state. Reporting either as a complete search is the one outcome neither may produce.
    """
    if abort():
        raise Cancelled()
    if session.transport_error:
        raise RuntimeError(session.transport_error)


def scrape_search_pages(session, transport, source, searches, on_progress=None,
                        should_abort=None):
    """Walk every group's search result pages in one session, deduplicating as we go.

    Two batches rather than one. Every group's page 1 goes into the first, because its
    payload is what says how many pages that group's search actually has, and everything
    those totals turn out to allow goes into the second. Groups do not take turns: one
    batch holds them all, so three groups cost the wall clock of one. That is also why
    `on_progress` cannot report a total until the first batch has landed.

    A group's `maxPages` of 0 means every page its search has, which is only knowable from
    its page 1, so an unlimited run is bounded by what page 1 reports rather than upfront.

    `should_abort` is checked as each batch lands, before anything is read out of it. A
    cancelled first batch has no page 1 in it, and the missing page 1 below would otherwise
    be reported as the search having broken rather than as the user having stopped it.
    """
    report = on_progress or (lambda done, total: None)
    abort = should_abort or (lambda: False)
    extract_js = source.search_extract_js()
    groups = [search["propertyTypeGroup"] for search in searches]
    filters_by_group = {search["propertyTypeGroup"]: search["filters"] for search in searches}

    first_pages = session.fetch_many(
        [(group, source.build_search_url(group, filters_by_group[group], 1)) for group in groups],
        must_contain="__NEXT_DATA__",
        concurrency=transport.SCRAPE_SEARCH_CONCURRENCY,
        extract_js=extract_js,
        should_abort=should_abort,
    )
    _check_stopped(session, abort)

    listings = []
    seen = set()
    last_page_by_group = {}
    total_by_group = {}
    pages_scanned = 0

    for search in searches:
        group = search["propertyTypeGroup"]
        html = first_pages.get(group)
        if not html:
            # Page 1 is the one page a group cannot do without: it carries the first
            # results and the page count the rest of the walk is bounded by.
            raise RuntimeError(f"{group}: search page 1 never returned any content")

        total_pages = source.total_pages(html)
        first = source.parse_listings(html)
        print(f"{group} page 1: {len(first)} listings")
        if not first and total_pages:
            # The page came back (fetch_many asserts the data marker) but yielded nothing.
            # On page 1 with pages available upstream, that means the payload shape moved
            # under us, not that the search is empty. Failing here is deliberate: the
            # alternative reports "no properties matched" for a broken parser, which looks
            # identical to a genuinely empty search.
            raise RuntimeError(
                f"{group}: parsed 0 listings from a rendered page 1 while the site reports "
                f"{total_pages} page(s) of results, the payload shape has likely changed"
            )

        _collect(first, listings, seen, group)
        pages_scanned += 1

        max_pages = int(search.get("maxPages") or 0)
        if not max_pages:
            # Unlimited, so the site's own total is the bound. A total the parser could
            # not read leaves nothing to scan towards, and stopping at the page already
            # fetched is the safe way to be wrong.
            last_page = total_pages or 1
        else:
            last_page = min(max_pages, total_pages) if total_pages else max_pages
        last_page_by_group[group] = last_page
        total_by_group[group] = total_pages

    # Summed across groups, so the readout counts the whole scrape rather than whichever
    # group happens to be reporting.
    pages_total = sum(last_page_by_group.values())
    report(pages_scanned, pages_total)

    rest = [
        ((group, page), source.build_search_url(group, filters_by_group[group], page))
        for group in groups
        for page in range(2, last_page_by_group[group] + 1)
    ]
    if rest:
        done_before = pages_scanned
        fetched = session.fetch_many(
            rest,
            must_contain="__NEXT_DATA__",
            on_progress=lambda done, total: report(done_before + done, pages_total),
            concurrency=transport.SCRAPE_SEARCH_CONCURRENCY,
            extract_js=extract_js,
            should_abort=should_abort,
        )
        _check_stopped(session, abort)
        for key, _ in rest:
            page_html = fetched.get(key)
            if not page_html:
                continue
            group, page = key
            page_listings = source.parse_listings(page_html)
            print(f"{group} page {page}: {len(page_listings)} listings")
            _collect(page_listings, listings, seen, group)
            pages_scanned += 1

    # The cap bit before the result set was exhausted, so the user is seeing a capped
    # view. Never report a capped scrape as a complete one, and one group hitting its cap
    # is enough: the consolidated result set is short either way.
    truncated = any(
        total_by_group[group] and total_by_group[group] > last_page_by_group[group]
        for group in groups
    )
    return listings, pages_scanned, sum(total_by_group.values()), truncated


def _collect(page_listings, listings, seen, group):
    """Add one page's listings to the run, skipping ids already taken.

    Deduplicating across ALL pages and ALL groups, not per page. A listing can repeat
    across page boundaries when the underlying result set shifts between requests.

    The group that fetched the page is stamped on any listing whose card did not name one,
    because every later check reads a listing's group to decide which filters it answers
    to, and the query it came from is the one fact about that which cannot be wrong.
    """
    for listing in page_listings:
        listing_id = listing.get("listingId")
        if listing_id and listing_id not in seen:
            seen.add(listing_id)
            listing["propertyTypeGroup"] = listing.get("propertyTypeGroup") or group
            listings.append(listing)


def keep_matching_listings(listings: list, searches: list) -> list:
    """Drop the listings that contradict the filters their own group was searched with.

    The site's own query does the real filtering; this only re-checks it. A filter the
    site does not recognise is dropped in silence, and the result then reads as a very
    broad search rather than as a bug -- which is the failure this catches.

    Each listing answers to its own group's filters and to no others, which is the whole
    reason a group carries a filter set of its own: measuring a landed home against the
    floor area someone set for condos is exactly the bug the tabs exist to avoid.

    Only the filters that can be checked exactly are here. Bedrooms and bathrooms are
    not: the panel's top option means "or more", so an exact match would drop legitimate
    hits. Neither is lastPosted, whose day boundary is the site's to define, not ours,
    nor land size, which no search result card states.
    """
    by_group = {search["propertyTypeGroup"]: search["filters"] for search in searches}
    kept = [
        listing
        for listing in listings
        if _listing_matches(listing, by_group.get(listing.get("propertyTypeGroup")) or {})
    ]
    dropped = len(listings) - len(kept)
    if dropped:
        print(f"Filter check dropped {dropped} of {len(listings)} listings")
    return kept


def _listing_matches(listing: dict, filters: dict) -> bool:
    """False when one of the exactly checkable filters rules this listing out."""
    for low, high, field in _RANGE_CHECKS:
        value = listing.get(field)
        # An absent value contradicts nothing, so it is kept rather than guessed at.
        if value is None:
            continue
        if filters.get(low) is not None and value < filters[low]:
            return False
        if filters.get(high) is not None and value > filters[high]:
            return False

    districts = filters.get("districtCode")
    if districts and listing.get("district") and listing["district"] not in districts:
        return False
    return True


def store_listing_photos(listings: list):
    """Move each listing's photos into the store, leaving the count behind on the listing.

    The photos are what the carousel renders and there are enough of them that carrying
    them through the result payload would add megabytes to what the browser then holds.
    The unit row keeps the count alone, which is all the table needs in order to know
    whether there is anything worth opening.

    After the filter check, so a listing that never belonged to this search does not take
    up room in the store on its way out.
    """
    photos_by_listing = {}
    for listing in listings:
        photos = listing.pop("photos", None) or []
        listing["photoCount"] = len(photos)
        if photos:
            photos_by_listing[listing["listingId"]] = photos
    store.put_listing_photos(photos_by_listing)


def keep_matching_properties(properties: list, searches: list) -> list:
    """Drop the properties whose TOP year falls outside their own group's TOP range.

    Property level rather than listing level because TOP is a fact about the project, and
    it only exists once enrichment has read the project page.

    A property whose TOP year never came through is kept, which is the same rule
    `_listing_matches` applies to every other bound: an absent value contradicts nothing.
    The source has already filtered on the year for us, HDB and landed included, and
    landed project pages simply never print it, so dropping the unknowns here would empty
    the landed half of any search with a build year set. It also lets a condo whose
    project page would not load survive a build year filter, which is the same trade made
    deliberately rather than a side effect.
    """
    by_group = {search["propertyTypeGroup"]: search["filters"] for search in searches}
    if all(
        filters.get("minTop") is None and filters.get("maxTop") is None
        for filters in by_group.values()
    ):
        return properties

    kept = []
    for prop in properties:
        filters = by_group.get(prop["info"].get("propertyTypeGroup")) or {}
        if _in_range(prop["info"].get("topYear"), filters.get("minTop"), filters.get("maxTop")):
            kept.append(prop)
    dropped = len(properties) - len(kept)
    if dropped:
        print(f"TOP year check dropped {dropped} of {len(properties)} properties")
    return kept


def _in_range(value, low, high) -> bool:
    """True when value sits inside the bounds that are set, or is not stated at all."""
    if value is None:
        return True
    return (low is None or value >= low) and (high is None or value <= high)


def enrich_properties(session, transport, source, listings, on_progress=None,
                      should_abort=None):
    """Fetch each uncached project page once, returning propertyId -> project record.

    A cancelled pass still stores what it managed to fetch. Those pages cost the same to
    read again, and the cache is the whole difference between a warm run and a cold one,
    so throwing them away would make stopping a search more expensive than finishing it.
    """
    report = on_progress or (lambda done, total: None)
    by_id = {}
    for listing in listings:
        property_id = listing.get("propertyId")
        if property_id and property_id not in by_id:
            by_id[property_id] = listing

    cached, failed = store.get_property_cache(list(by_id))

    targets = []
    for property_id, listing in by_id.items():
        if property_id in cached or property_id in failed:
            continue
        url = source.project_url(listing)
        if url:
            targets.append((property_id, url))

    print(
        f"Property cache: {len(cached)} hit, {len(failed)} known bad, {len(targets)} to fetch"
    )
    report(0, len(targets))
    if not targets:
        return cached

    fetched = session.fetch_many(
        targets,
        must_contain="property-attr",
        on_progress=report,
        concurrency=transport.SCRAPE_DETAIL_CONCURRENCY,
        extract_js=source.project_extract_js(),
        should_abort=should_abort,
    )

    records = {}
    unavailable = []
    for property_id, url in targets:
        html = fetched.get(property_id)
        if not html:
            unavailable.append(property_id)
            continue
        try:
            record = source.parse_project(html)
            record["projectUrl"] = url
            records[property_id] = record
        except Exception as e:
            print(f"Enrichment failed for {property_id} ({url}): {e}")
            unavailable.append(property_id)

    # Best effort, as before: a property that would not load renders with enrichment
    # "unavailable" rather than failing the job. The miss is written down alongside the
    # successes so the next search skips it instead of paying for it again.
    store.put_property_cache(records, unavailable)
    cached.update(records)
    return cached


def _cancel_watch(job_id: str):
    """Return a callable answering whether this job has been asked to stop.

    The flag lives on the job row rather than in a threading.Event, because the request
    arrives on the API thread and a job still queued behind another one has no thread of
    its own yet. Reading it is a lock and a file though, and the fetch loop asks between
    every request, so the answer is cached for CANCEL_POLL_SECONDS. Once it is True it
    stays True and stops reading altogether: a cancel is never taken back.
    """
    state = {"checked_at": 0.0, "cancelled": False}

    def cancelled():
        if state["cancelled"]:
            return True
        now = time.monotonic()
        if now - state["checked_at"] < CANCEL_POLL_SECONDS:
            return False
        state["checked_at"] = now
        state["cancelled"] = store.is_cancelled(job_id)
        return state["cancelled"]

    return cancelled


def run_job(job: dict) -> dict:
    """Scrape, enrich and group one job, returning the result payload."""
    source = get_source(job.get("source"))
    searches = [
        {
            "propertyTypeGroup": search["propertyTypeGroup"],
            "maxPages": min(int(search.get("maxPages") or 0), MAX_PAGES_CEILING)
            if search.get("maxPages")
            else 0,
            "filters": search.get("filters") or {},
        }
        for search in job.get("searches") or []
    ]
    job_id = job["jobId"]

    def notice(message):
        """Surface what the transport is blocked on, so the UI can say so mid-scrape."""
        store.update_status(job_id, note=message or None)

    def pages(done, total):
        """Report search page progress onto the job row, for the readout."""
        store.update_status(job_id, pagesFetched=done, pagesTotal=total)

    def details(done, total):
        """Report project page progress onto the job row, for the readout.

        A total of 0 here means every property was already cached, which is the whole
        difference between a warm search and a cold one.
        """
        store.update_status(job_id, detailsFetched=done, detailsTotal=total)

    cancelled = _cancel_watch(job_id)

    # Read once, here, rather than per phase: a mode flipped mid-scrape must not move a
    # job onto a session it never opened.
    mode = store.get_scrape_mode()
    transport = get_transport(mode)
    print(f"Scrape mode: {mode}")

    with transport.open_session(on_notice=notice) as session:
        store.update_status(job_id, "scraping")
        listings, pages_scanned, total_pages, truncated = scrape_search_pages(
            session, transport, source, searches, on_progress=pages, should_abort=cancelled
        )
        # Before enrichment, so a listing that never belonged here does not cost a page
        # load on the way out.
        listings = keep_matching_listings(listings, searches)
        print(f"Scraped {len(listings)} distinct listings over {pages_scanned} page(s)")

        store.update_status(job_id, "enriching", listingCount=len(listings))
        properties_cache = enrich_properties(
            session, transport, source, listings, on_progress=details, should_abort=cancelled
        )
        # After the pass rather than inside it, so a cancel still leaves the project pages
        # it had already paid for in the cache.
        _check_stopped(session, cancelled)

    store_listing_photos(listings)
    properties = keep_matching_properties(
        grouping.group_listings(listings, properties_cache), searches
    )
    return {
        "source": source.name,
        "properties": properties,
        "propertyCount": len(properties),
        "unitCount": grouping.count_units(properties),
        "pagesScanned": pages_scanned,
        "totalPages": total_pages,
        "truncated": truncated,
    }


def process_job(job: dict):
    """Run one job end to end, recording its terminal status on the job row."""
    job_id = job["jobId"]
    # Asked before anything is fetched, because a job cancelled while it was still queued
    # behind another one has never been looked at until now.
    if store.is_cancelled(job_id):
        store.update_status(job_id, "cancelled", note=None)
        return
    try:
        result = run_job(job)
        store.put_result(job_id, result)
        store.update_status(
            job_id,
            "succeeded",
            note=None,
            propertyCount=result["propertyCount"],
            unitCount=result["unitCount"],
            pagesScanned=result["pagesScanned"],
            totalPages=result["totalPages"],
            truncated=result["truncated"],
        )
        if job.get("savedSearchId"):
            store.touch_saved_search(job["savedSearchId"])
    except Cancelled:
        # No result is written and the saved search is not stamped: a run that was stopped
        # never returned anything, so the next one still measures new listings from the
        # last time results actually came back.
        print(f"Job {job_id} cancelled")
        store.update_status(job_id, "cancelled", note=None)
    except Exception as e:
        print(f"Job {job_id} failed: {e}")
        store.update_status(
            job_id,
            "failed",
            note=None,
            error=str(e),
            errorDetail=traceback.format_exc()[-DETAIL_MAX_CHARS:],
        )
