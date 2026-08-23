"""
Persistence for the local scraper: the job rows, the property cache, the saved searches,
the shortlist and the result JSON.

Everything lives in JSON files under `.data/` next to this module. The cloud version of
this scraper used DynamoDB for the rows and S3 for the results; running on one machine
for one person, files are enough and leave the whole state readable and deletable by
hand. Writes go through a lock and land via a temp file plus rename, because the API
thread and the scrape thread both write here and a half-written jobs file would lose
every job at once.

The property cache exists because project pages change on the order of months while
listings change hourly. Re-scraping a project page on every search would multiply the
page loads (and therefore the Cloudflare challenges) by the number of properties in the
result set, for data that has almost certainly not moved.
"""

import json
import os
import threading
import time

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
DATA_DIR = os.environ.get("DATA_DIR", os.path.join(BASE_DIR, ".data"))
RESULTS_DIR = os.path.join(DATA_DIR, "results")

JOBS_FILE = os.path.join(DATA_DIR, "jobs.json")
PROPERTIES_FILE = os.path.join(DATA_DIR, "properties.json")
SAVED_SEARCHES_FILE = os.path.join(DATA_DIR, "saved_searches.json")
SHORTLIST_FILE = os.path.join(DATA_DIR, "shortlist.json")

PROPERTY_TTL_SECONDS = int(os.environ.get("PROPERTY_TTL_SECONDS", str(30 * 24 * 3600)))
# A project page that would not load is remembered too, but only briefly: the usual
# causes (a slug that moved, a page pulled down) are the kind of thing that gets fixed
# upstream, so the tombstone has to expire on its own.
PROPERTY_FAIL_TTL_SECONDS = int(os.environ.get("PROPERTY_FAIL_TTL_SECONDS", str(24 * 3600)))
# Jobs are kept only so a reload of the page can still poll the run that is in flight.
JOB_TTL_SECONDS = int(os.environ.get("JOB_TTL_SECONDS", str(24 * 3600)))
# Saved searches never expire, so the list is capped instead. Well past what one
# person keeps, and low enough that the file stays something you can read by hand.
MAX_SAVED_SEARCHES = 50
# The shortlist never expires either, for the same reason and with the same answer.
MAX_SHORTLIST = 200

_lock = threading.Lock()


def init():
    """Create the data directories. Called once at server start."""
    os.makedirs(RESULTS_DIR, exist_ok=True)


def _read(path: str) -> dict:
    """Load one JSON file, treating a missing or corrupt one as empty.

    A corrupt file is recovered from rather than raised on: the only way to produce one
    is an interrupted write, and losing the cache is always better than a server that
    will not start.
    """
    try:
        with open(path) as f:
            data = json.load(f)
        return data if isinstance(data, dict) else {}
    except (FileNotFoundError, json.JSONDecodeError):
        return {}


def _write(path: str, data: dict):
    """Write one JSON file atomically, so a crash mid-write cannot truncate it."""
    os.makedirs(os.path.dirname(path), exist_ok=True)
    temp_path = f"{path}.tmp"
    with open(temp_path, "w") as f:
        json.dump(data, f)
    os.replace(temp_path, path)


# ------------------------------------------------------------------------ jobs


def create_job(job_id: str, source: str, max_pages: int, filters: dict) -> dict:
    """Record a queued job and return its row."""
    now = int(time.time())
    row = {
        "jobId": job_id,
        "status": "queued",
        "source": source,
        "maxPages": max_pages,
        "filters": filters,
        "propertyCount": 0,
        "unitCount": 0,
        "error": None,
        "errorDetail": None,
        "note": None,
        "createdAt": now,
        "updatedAt": now,
    }
    with _lock:
        jobs = _read(JOBS_FILE)
        jobs[job_id] = row
        _write(JOBS_FILE, _without_expired(jobs, now))
    return row


def update_status(job_id: str, status: str = None, **fields):
    """Merge a status and any extra fields into a job row, stamping updatedAt."""
    with _lock:
        jobs = _read(JOBS_FILE)
        row = jobs.get(job_id)
        if row is None:
            return
        if status is not None:
            row["status"] = status
        row.update(fields)
        row["updatedAt"] = int(time.time())
        jobs[job_id] = row
        _write(JOBS_FILE, jobs)


def get_job(job_id: str) -> dict:
    """Return one job row, or {} when it is unknown or has aged out."""
    with _lock:
        return _read(JOBS_FILE).get(job_id) or {}


def _without_expired(jobs: dict, now: int) -> dict:
    """Drop rows past their TTL, and the result files behind them.

    Done on create rather than on a timer so the pruning cannot run concurrently with a
    job that is still writing.
    """
    kept = {}
    for job_id, row in jobs.items():
        if now - int(row.get("createdAt") or 0) < JOB_TTL_SECONDS:
            kept[job_id] = row
            continue
        try:
            os.remove(_result_path(job_id))
        except OSError:
            pass
    return kept


# --------------------------------------------------------------------- results


def _result_path(job_id: str) -> str:
    return os.path.join(RESULTS_DIR, f"{job_id}.json")


def put_result(job_id: str, payload: dict):
    """Write a job's grouped result. Kept out of the job row so the rows stay small."""
    _write(_result_path(job_id), payload)


def get_result(job_id: str) -> dict:
    """Return a job's grouped result, or {} when it is gone."""
    return _read(_result_path(job_id))


# ------------------------------------------------------------- property cache


def get_property_cache(property_ids: list) -> tuple:
    """Return (fresh records by id, ids whose last fetch failed recently).

    Both halves come out of one read. The failures are returned so the caller can skip
    them: without that, a project page that 404s is re-fetched on every future search
    forever, spending the whole retry budget each time on an answer that has not changed.
    """
    now = int(time.time())
    with _lock:
        cache = _read(PROPERTIES_FILE)

    records = {}
    failed = set()
    for property_id in property_ids:
        entry = cache.get(str(property_id)) if property_id else None
        if not entry:
            continue
        if entry.get("record") is not None:
            if now - int(entry.get("updatedAt") or 0) < PROPERTY_TTL_SECONDS:
                records[property_id] = entry.get("record") or {}
        elif now - int(entry.get("failedAt") or 0) < PROPERTY_FAIL_TTL_SECONDS:
            failed.add(property_id)
    return records, failed


def put_property_cache(records: dict, failed=()):
    """Store a whole enrichment pass in one write.

    One write per pass rather than one per property: the previous version re-read and
    rewrote the entire cache file once for every project, which is quadratic in the
    number of properties a search turns up.
    """
    if not records and not failed:
        return
    now = int(time.time())
    with _lock:
        cache = _read(PROPERTIES_FILE)
        for property_id, record in records.items():
            cache[str(property_id)] = {"record": record, "updatedAt": now}
        for property_id in failed:
            cache[str(property_id)] = {"failedAt": now}
        _write(PROPERTIES_FILE, cache)


# --------------------------------------------------------------- saved searches


def list_saved_searches() -> list:
    """Every saved search, newest first."""
    with _lock:
        searches = _read(SAVED_SEARCHES_FILE)
    rows = sorted(searches.values(), key=lambda item: item.get("createdAt") or 0, reverse=True)
    # A row written before hiding moved onto the search has no list of its own.
    for row in rows:
        row.setdefault("hidden", [])
    return rows


def put_saved_search(
    search_id: str, name: str, source: str, max_pages: int, filters: dict, hidden: list
) -> dict:
    """Store one search under a fresh id, refusing to grow the list past the cap.

    The cap raises rather than evicting the oldest, because a saved search is something
    the user typed and only the user should decide which one goes.
    """
    search = {
        "searchId": search_id,
        "name": name,
        "source": source,
        "maxPages": max_pages,
        "filters": filters,
        "hidden": hidden,
        "createdAt": int(time.time()),
    }
    with _lock:
        searches = _read(SAVED_SEARCHES_FILE)
        if search_id not in searches and len(searches) >= MAX_SAVED_SEARCHES:
            raise ValueError(
                f"You already have {MAX_SAVED_SEARCHES} saved searches. "
                "Delete one before saving another."
            )
        searches[search_id] = search
        _write(SAVED_SEARCHES_FILE, searches)
    return search


def update_saved_search(
    search_id: str, name: str, source: str, max_pages: int, filters: dict, hidden: list
) -> dict:
    """Replace one saved search in place, returning None when the id is unknown.

    createdAt is kept, so editing a search does not jump it to the top of the list the
    user has learned the order of.
    """
    with _lock:
        searches = _read(SAVED_SEARCHES_FILE)
        search = searches.get(search_id)
        if search is None:
            return None
        search.update(
            {
                "name": name,
                "source": source,
                "maxPages": max_pages,
                "filters": filters,
                "hidden": hidden,
            }
        )
        searches[search_id] = search
        _write(SAVED_SEARCHES_FILE, searches)
    return search


def set_saved_search_hidden(search_id: str, hidden: list) -> dict:
    """Replace one saved search's hidden list, returning None when the id is unknown.

    Its own route because the results screen writes it on every hide and unhide, where
    resending the filters would mean the screen deciding what they are.
    """
    with _lock:
        searches = _read(SAVED_SEARCHES_FILE)
        search = searches.get(search_id)
        if search is None:
            return None
        search["hidden"] = hidden
        searches[search_id] = search
        _write(SAVED_SEARCHES_FILE, searches)
    return search


def delete_saved_search(search_id: str):
    """Forget one saved search. Deleting an id that is already gone counts as success."""
    with _lock:
        searches = _read(SAVED_SEARCHES_FILE)
        if searches.pop(search_id, None) is not None:
            _write(SAVED_SEARCHES_FILE, searches)


# ------------------------------------------------------------------- shortlist


def list_shortlist() -> list:
    """Every shortlisted unit, newest first.

    Each entry is a whole listing frozen at the moment it was hearted, not a reference to
    one. A job row ages out after JOB_TTL_SECONDS and takes its result file with it, and
    the property cache holds project facts only, so an id on its own would name a unit
    nothing left on this machine could describe.
    """
    with _lock:
        entries = _read(SHORTLIST_FILE)
    return sorted(entries.values(), key=lambda item: item.get("createdAt") or 0, reverse=True)


def put_shortlist(entry: dict) -> dict:
    """Store one unit under its listing id, refusing to grow the list past the cap.

    Re-hearting a unit overwrites it, which refreshes the snapshot. The cap raises rather
    than evicting the oldest: only the user should decide what leaves their own list.
    """
    listing_id = str(entry["listingId"])
    entry = dict(entry, listingId=listing_id, createdAt=int(time.time()))
    with _lock:
        entries = _read(SHORTLIST_FILE)
        if listing_id not in entries and len(entries) >= MAX_SHORTLIST:
            raise ValueError(
                f"Your shortlist already holds {MAX_SHORTLIST} units. "
                "Remove one before adding another."
            )
        entries[listing_id] = entry
        _write(SHORTLIST_FILE, entries)
    return entry


def delete_shortlist(listing_id: str):
    """Drop one unit from the shortlist. An id that is already gone counts as success."""
    with _lock:
        entries = _read(SHORTLIST_FILE)
        if entries.pop(str(listing_id), None) is not None:
            _write(SHORTLIST_FILE, entries)
