"""
Persistence for the local scraper: the job rows, the property cache, the hidden list and
the result JSON.

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
HIDDEN_FILE = os.path.join(DATA_DIR, "hidden.json")

PROPERTY_TTL_SECONDS = int(os.environ.get("PROPERTY_TTL_SECONDS", str(30 * 24 * 3600)))
# A project page that would not load is remembered too, but only briefly: the usual
# causes (a slug that moved, a page pulled down) are the kind of thing that gets fixed
# upstream, so the tombstone has to expire on its own.
PROPERTY_FAIL_TTL_SECONDS = int(os.environ.get("PROPERTY_FAIL_TTL_SECONDS", str(24 * 3600)))
# Jobs are kept only so a reload of the page can still poll the run that is in flight.
JOB_TTL_SECONDS = int(os.environ.get("JOB_TTL_SECONDS", str(24 * 3600)))

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


# ---------------------------------------------------------------------- hidden


def list_hidden() -> list:
    """Every hidden entity, newest first."""
    with _lock:
        hidden = _read(HIDDEN_FILE)
    return sorted(hidden.values(), key=lambda item: item.get("createdAt") or 0, reverse=True)


def put_hidden(scope: str, entity_id: str, label: str) -> dict:
    """Hide a property or unit. Rewriting an existing key is a no-op re-hide."""
    entity_key = f"{scope}#{entity_id}"
    entity = {
        "entityKey": entity_key,
        "scope": scope,
        "id": entity_id,
        "label": label,
        "createdAt": int(time.time()),
    }
    with _lock:
        hidden = _read(HIDDEN_FILE)
        hidden[entity_key] = entity
        _write(HIDDEN_FILE, hidden)
    return entity


def delete_hidden(entity_key: str):
    """Unhide by key. Deleting a key that is already gone counts as success."""
    with _lock:
        hidden = _read(HIDDEN_FILE)
        if hidden.pop(entity_key, None) is not None:
            _write(HIDDEN_FILE, hidden)


def hidden_id_sets() -> tuple:
    """Return (hidden property ids, hidden unit ids) as sets of strings."""
    properties = set()
    units = set()
    for entity in list_hidden():
        if entity.get("scope") == "property":
            properties.add(str(entity.get("id")))
        elif entity.get("scope") == "unit":
            units.add(str(entity.get("id")))
    return properties, units
