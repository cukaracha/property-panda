"""
The scrape job itself: search pages in, grouped properties out.

For each job it walks the source's search result pages in one browser session, enriches
each distinct property from its project page (cached), groups everything into the shape
the UI renders, and records the result and the terminal status on the job row.

Both phases hand their URLs to the session in a batch so its tabs can load them at the
same time. Enrichment is where that matters: it is one page load per distinct property
and it dominates a cold run, while the search itself is only ever a handful of pages.

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

MAX_PAGES_CEILING = 10

# A failure's debuggable detail rides on the job row so it reaches the UI.
DETAIL_MAX_CHARS = 4000

_SOURCES = {PropertyGuruSource.name: PropertyGuruSource}


def get_source(name: str):
    """Resolve a source adapter by name. Adding a portal means one entry in _SOURCES."""
    source_class = _SOURCES.get(name or PropertyGuruSource.name)
    if source_class is None:
        raise ValueError(f"Unknown source: {name}")
    return source_class()


def scrape_search_pages(session, source, filters, max_pages):
    """Walk the search result pages in one browser session, deduplicating as we go.

    Page 1 goes on its own because its payload is what says how many pages the search
    actually has; the rest are handed over as one batch and load across the tabs.
    """
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

    last_page = min(max_pages, total_pages) if total_pages else max_pages
    rest = [(page, source.build_search_url(filters, page)) for page in range(2, last_page + 1)]
    if rest:
        fetched = session.fetch_many(rest, must_contain="__NEXT_DATA__")
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


def enrich_properties(session, source, listings):
    """Fetch each uncached project page once, returning propertyId -> project record."""
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
    if not targets:
        return cached

    fetched = session.fetch_many(targets, must_contain="property-attr")

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
    max_pages = max(1, min(int(job.get("maxPages") or 1), MAX_PAGES_CEILING))
    job_id = job["jobId"]

    def notice(message):
        """Surface what the browser is blocked on, so the UI can say so mid-scrape."""
        store.update_status(job_id, note=message or None)

    with browser.BrowserSession(on_notice=notice) as session:
        store.update_status(job_id, "scraping")
        listings, pages_scanned, total_pages, truncated = scrape_search_pages(
            session, source, filters, max_pages
        )
        print(f"Scraped {len(listings)} distinct listings over {pages_scanned} page(s)")

        store.update_status(job_id, "enriching", listingCount=len(listings))
        properties_cache = enrich_properties(session, source, listings)

    properties = grouping.group_listings(listings, properties_cache)
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
