"""
Local API for the property search page.

Serves the same routes the SPA's listings service already calls, so the React page needs
no rework beyond pointing at this host instead of API Gateway:

    POST   /listings/search           -> 202 {jobId}, runs the scrape in the background
    GET    /listings/results?jobId=   -> the poll AND the fetch; results once succeeded
    GET    /listings/hidden           -> the dismissed properties and units
    POST   /listings/hidden           -> hide one
    DELETE /listings/hidden/{key}     -> unhide one

The cloud version ran the scrape on an SQS-triggered Lambda because API Gateway gives up
at 29 seconds. Here the same handoff is a single background thread: the POST returns a
jobId immediately and the SPA polls, which is what keeps the request alive across a scrape
that pauses for however long the human verification takes.

Scrapes run ONE at a time. Chrome holds an exclusive lock on its user-data-dir, and that
profile is what carries the Cloudflare clearance between runs, so a second concurrent
browser would either fail to start or have to throw the clearance away.

There is no authentication: this listens on loopback and serves one person on one machine.
"""

import os
import uuid
from contextlib import asynccontextmanager
from concurrent.futures import ThreadPoolExecutor

from fastapi import FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

import scraper
import store
import validation

# The Vite dev server. Loopback only, and an explicit list rather than "*", so a page on
# some other site cannot drive this API through a visiting browser.
ALLOWED_ORIGINS = [
    "http://localhost:3000",
    "http://127.0.0.1:3000",
]

HOST = os.environ.get("HOST", "127.0.0.1")
PORT = int(os.environ.get("PORT", "8000"))

@asynccontextmanager
async def lifespan(app: FastAPI):
    """Create the data directories before the first request can reach the store."""
    store.init()
    print(f"Property search API on http://{HOST}:{PORT}")
    yield


app = FastAPI(title="Property search (local)", lifespan=lifespan)
app.add_middleware(
    CORSMiddleware,
    allow_origins=ALLOWED_ORIGINS,
    allow_methods=["GET", "POST", "DELETE", "OPTIONS"],
    allow_headers=["Content-Type"],
)

# max_workers=1 is the concurrency limit described above, not a performance choice.
_jobs = ThreadPoolExecutor(max_workers=1, thread_name_prefix="scrape")


@app.post("/listings/search", status_code=202)
async def create_search(request: Request):
    """Validate the filters, record a queued job and hand it to the scrape thread."""
    try:
        body = await request.json()
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid JSON in request body")

    try:
        source, max_pages, filters = validation.build_request(body)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))

    job_id = str(uuid.uuid4())
    job = store.create_job(job_id, source, max_pages, filters)
    _jobs.submit(scraper.process_job, job)

    return {"jobId": job_id, "status": "queued"}


@app.get("/listings/results")
def get_search_results(jobId: str = ""):
    """One endpoint serves both the poll and the final fetch.

    The last poll already carries the results, so the page never needs a follow-up
    request once the job reaches 'succeeded'.
    """
    if not jobId:
        raise HTTPException(status_code=400, detail="jobId is required")

    row = store.get_job(jobId)
    if not row:
        raise HTTPException(status_code=404, detail="Job not found")

    view = {
        "jobId": jobId,
        "status": row.get("status"),
        "source": row.get("source"),
        "propertyCount": int(row.get("propertyCount") or 0),
        "unitCount": int(row.get("unitCount") or 0),
        "error": row.get("error"),
        "errorDetail": row.get("errorDetail"),
        # What the browser is currently blocked on, e.g. an unsolved challenge. Present
        # only while it is true, so the UI shows it and then stops showing it by itself.
        "note": row.get("note"),
        # How far through each phase the scrape is, so the readout can count rather than
        # sit on one label for the whole run. A total is 0 until the phase that knows it
        # begins -- the page total only exists once page 1 has said how many there are,
        # and a details total of 0 during enrichment means the cache covered every one.
        "listingCount": int(row.get("listingCount") or 0),
        "pagesFetched": int(row.get("pagesFetched") or 0),
        "pagesTotal": int(row.get("pagesTotal") or 0),
        "detailsFetched": int(row.get("detailsFetched") or 0),
        "detailsTotal": int(row.get("detailsTotal") or 0),
    }

    if row.get("status") != "succeeded":
        return view

    result = store.get_result(jobId)
    if not result:
        # The row outlived its result file. An expected end state after a prune, not a
        # server fault, so it is reported rather than raised.
        view["expired"] = True
        return view

    properties = result.get("properties") or []
    view.update(
        {
            "properties": properties,
            "hiddenCounts": apply_hidden(properties),
            "scrapedAt": row.get("updatedAt"),
            "truncated": bool(result.get("truncated")),
            "pagesScanned": int(result.get("pagesScanned") or 0),
            "totalPages": int(result.get("totalPages") or 0),
        }
    )
    return view


def apply_hidden(properties: list) -> dict:
    """Flag hidden properties and units in place, returning how many of each.

    Hides are flags, not deletions: the payload keeps everything, the page filters at
    render time, and unhiding puts a row straight back without re-running the scrape.
    """
    hidden_properties, hidden_units = store.hidden_id_sets()
    counts = {"properties": 0, "units": 0}

    for prop in properties:
        prop["hidden"] = str(prop.get("propertyId")) in hidden_properties
        if prop["hidden"]:
            counts["properties"] += 1
        for unit_type in prop.get("unitTypes") or []:
            for unit in unit_type.get("units") or []:
                unit["hidden"] = str(unit.get("listingId")) in hidden_units
                if unit["hidden"]:
                    counts["units"] += 1

    return counts


@app.get("/listings/hidden")
def list_hidden():
    """Every property and unit that has been dismissed, newest first."""
    return {"hidden": store.list_hidden()}


@app.post("/listings/hidden", status_code=201)
async def create_hidden(request: Request):
    """Hide a property or a single unit. Re-hiding the same key is a no-op."""
    try:
        body = await request.json()
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid JSON in request body")

    try:
        scope, entity_id, label = validation.clean_hidden(body)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))

    return store.put_hidden(scope, entity_id, label)


@app.delete("/listings/hidden/{entity_key:path}")
def delete_hidden(entity_key: str):
    """Unhide by key. Deleting a key that is already gone counts as success."""
    try:
        validation.parse_entity_key(entity_key)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))

    store.delete_hidden(entity_key)
    return {"entityKey": entity_key}


@app.exception_handler(HTTPException)
def http_exception_handler(request: Request, exc: HTTPException):
    """Answer errors as {"message": ...}, which is the shape the SPA's services read."""
    return JSONResponse(status_code=exc.status_code, content={"message": exc.detail})


if __name__ == "__main__":
    import uvicorn

    uvicorn.run(app, host=HOST, port=PORT, log_level="info")
