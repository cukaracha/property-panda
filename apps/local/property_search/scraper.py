"""
The scrape job itself: search pages in, grouped properties out.

For each job it walks the source's search result pages in one browser session, enriches
each distinct property from its project page (cached), groups everything into the shape
the UI renders, and records the result and the terminal status on the job row.

Both phases hand their URLs to the session in a batch so its tabs can load them at the
same time. Enrichment is where that matters: it is one page load per distinct property
and it dominates a cold run, while the search itself is only ever a handful of pages.

Both phases end in a filter check. The source's query is what does the real filtering, so
this only catches what came back contradicting it -- a bound the site quietly ignored, or
a card that was never a search hit in the first place. Silently keeping those reads as a
broad search rather than as a bug, which is why the check is here at all.

Status moves queued -> scraping -> enriching -> succeeded, or -> failed.

Enrichment is best effort by design: a project page that will not load leaves that
property flagged `enrichment: "unavailable"` rather than failing a job whose listings are
all fine.
"""

import traceback

import browser
import grouping
import store
from sources.property_guru import PropertyGuruSource

# Bounds an explicit page count. A maxPages of 0 asks for every page and is not capped.
MAX_PAGES_CEILING = 10

# A failure's debuggable detail rides on the job row so it reaches the UI.
DETAIL_MAX_CHARS = 4000

# (min filter, max filter, listing field) for every bound `keep_matching_listings` checks.
_RANGE_CHECKS = (
    ("minPrice", "maxPrice", "price"),
    ("minSize", "maxSize", "floorAreaSqft"),
    ("minPsf", "maxPsf", "psf"),
)

_SOURCES = {PropertyGuruSource.name: PropertyGuruSource}


def get_source(name: str):
    """Resolve a source adapter by name. Adding a portal means one entry in _SOURCES."""
    source_class = _SOURCES.get(name or PropertyGuruSource.name)
    if source_class is None:
        raise ValueError(f"Unknown source: {name}")
    return source_class()


def scrape_search_pages(session, source, filters, max_pages, on_progress=None):
    """Walk the search result pages in one browser session, deduplicating as we go.

    Page 1 goes on its own because its payload is what says how many pages the search
    actually has; the rest are handed over as one batch and load across the tabs. That
    is also why `on_progress` cannot report a total until page 1 has landed.

    A `max_pages` of 0 means every page the search has, which is only knowable from
    page 1, so an unlimited run is bounded by what page 1 reports rather than upfront.
    """
    report = on_progress or (lambda done, total: None)
    first_url = source.build_search_url(filters, 1)
    html = session.fetch_html(first_url, must_contain="__NEXT_DATA__")
    total_pages = source.total_pages(html)

    first = source.parse_listings(html)
    print(f"Page 1: {len(first)} listings")
    if not first and total_pages:
        # The page rendered (fetch_html asserts the data marker) but yielded nothing.
        # On page 1 with pages available upstream, that means the payload shape moved
        # under us, not that the search is empty. Failing here is deliberate: the
        # alternative reports "no properties matched" for a broken parser, which looks
        # identical to a genuinely empty search.
        raise RuntimeError(
            "parsed 0 listings from a rendered page 1 while the site reports "
            f"{total_pages} page(s) of results, the payload shape has likely changed"
        )

    listings = []
    seen = set()
    _collect(first, listings, seen)
    pages_scanned = 1

    if not max_pages:
        # Unlimited, so the site's own total is the bound. A total the parser could not
        # read leaves nothing to scan towards, and stopping at the page already fetched
        # is the safe way to be wrong.
        last_page = total_pages or 1
    else:
        last_page = min(max_pages, total_pages) if total_pages else max_pages
    report(1, last_page)
    rest = [(page, source.build_search_url(filters, page)) for page in range(2, last_page + 1)]
    if rest:
        fetched = session.fetch_many(
            rest,
            must_contain="__NEXT_DATA__",
            on_progress=lambda done, total: report(1 + done, last_page),
        )
        for page, _ in rest:
            page_html = fetched.get(page)
            if not page_html:
                continue
            page_listings = source.parse_listings(page_html)
            print(f"Page {page}: {len(page_listings)} listings")
            _collect(page_listings, listings, seen)
            pages_scanned += 1

    # The cap bit before the result set was exhausted, so the user is seeing a capped
    # view. Never report a capped scrape as a complete one.
    truncated = bool(total_pages and total_pages > last_page)
    return listings, pages_scanned, total_pages or 0, truncated


def _collect(page_listings, listings, seen):
    """Add one page's listings to the run, skipping ids already taken.

    Deduplicating across ALL pages, not per page. A listing can repeat across page
    boundaries when the underlying result set shifts between requests.
    """
    for listing in page_listings:
        listing_id = listing.get("listingId")
        if listing_id and listing_id not in seen:
            seen.add(listing_id)
            listings.append(listing)


def keep_matching_listings(listings: list, filters: dict) -> list:
    """Drop the listings that contradict the filters the search was run with.

    The site's own query does the real filtering; this only re-checks it. A filter the
    site does not recognise is dropped in silence, and the result then reads as a very
    broad search rather than as a bug -- which is the failure this catches.

    Only the filters that can be checked exactly are here. Bedrooms and bathrooms are
    not: the panel's top option means "or more", so an exact match would drop legitimate
    hits. Neither is lastPosted, whose day boundary is the site's to define, not ours.
    """
    kept = [listing for listing in listings if _listing_matches(listing, filters)]
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


def keep_matching_properties(properties: list, filters: dict) -> list:
    """Drop the properties whose TOP year falls outside the search's TOP range.

    Property level rather than listing level because TOP is a fact about the project, and
    it only exists once enrichment has read the project page. A property whose page would
    not load has no TOP year at all, and it goes too: under a TOP filter, "we could not
    tell" is not a match.
    """
    low, high = filters.get("minTop"), filters.get("maxTop")
    if low is None and high is None:
        return properties

    kept = [
        prop
        for prop in properties
        if _in_range(prop["info"].get("topYear"), low, high)
    ]
    dropped = len(properties) - len(kept)
    if dropped:
        print(f"TOP year check dropped {dropped} of {len(properties)} properties")
    return kept


def _in_range(value, low, high) -> bool:
    """True when value sits inside the bounds that are set. An unknown value never does."""
    if value is None:
        return False
    return (low is None or value >= low) and (high is None or value <= high)


def enrich_properties(session, source, listings, on_progress=None):
    """Fetch each uncached project page once, returning propertyId -> project record."""
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
        targets, must_contain="property-attr", on_progress=report
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


def run_job(job: dict) -> dict:
    """Scrape, enrich and group one job, returning the result payload."""
    source = get_source(job.get("source"))
    filters = job.get("filters") or {}
    requested_pages = int(job.get("maxPages") or 0)
    max_pages = min(requested_pages, MAX_PAGES_CEILING) if requested_pages else 0
    job_id = job["jobId"]

    def notice(message):
        """Surface what the browser is blocked on, so the UI can say so mid-scrape."""
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

    with browser.BrowserSession(on_notice=notice) as session:
        store.update_status(job_id, "scraping")
        listings, pages_scanned, total_pages, truncated = scrape_search_pages(
            session, source, filters, max_pages, on_progress=pages
        )
        # Before enrichment, so a listing that never belonged here does not cost a page
        # load on the way out.
        listings = keep_matching_listings(listings, filters)
        print(f"Scraped {len(listings)} distinct listings over {pages_scanned} page(s)")

        store.update_status(job_id, "enriching", listingCount=len(listings))
        properties_cache = enrich_properties(session, source, listings, on_progress=details)

    properties = keep_matching_properties(
        grouping.group_listings(listings, properties_cache), filters
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
    except Exception as e:
        print(f"Job {job_id} failed: {e}")
        store.update_status(
            job_id,
            "failed",
            note=None,
            error=str(e),
            errorDetail=traceback.format_exc()[-DETAIL_MAX_CHARS:],
        )
