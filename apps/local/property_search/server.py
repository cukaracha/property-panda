"""
Local API for the property search page.

Serves the same routes the SPA's listings service already calls, so the React page needs
no rework beyond pointing at this host instead of API Gateway:

    POST   /listings/search           -> 202 {jobId}, runs the scrape in the background
    GET    /listings/results?jobId=   -> the poll AND the fetch; results once succeeded
    GET    /listings/saved-searches   -> the searches kept for re-running
    POST   /listings/saved-searches   -> save one, with the items it hides
    PUT    /listings/saved-searches/{id} -> replace its name, request and hidden items
    PUT    /listings/saved-searches/{id}/hidden -> replace its hidden items alone
    DELETE /listings/saved-searches/{id} -> forget one

It also serves the in-app assistant, which used to be a Bedrock AgentCore runtime the
browser invoked directly and is now an agent in this process (see `agent/`):

    POST   /chat                          -> SSE stream of {type, content} events
    GET    /chat/conversations/{sessionId} -> replay one stored conversation
    GET    /profile/claude-token          -> whether a Claude token is saved
    PUT    /profile/claude-token          -> save or remove it

The cloud version ran the scrape on an SQS-triggered Lambda because API Gateway gives up
at 29 seconds. Here the same handoff is a single background thread: the POST returns a
jobId immediately and the SPA polls, which is what keeps the request alive across a scrape
that pauses for however long the human verification takes.

Scrapes run ONE at a time. Chrome holds an exclusive lock on its user-data-dir, and that
profile is what carries the Cloudflare clearance between runs, so a second concurrent
browser would either fail to start or have to throw the clearance away.

There is no authentication: this listens on loopback and serves one person on one machine.
"""

import json
import os
import traceback
import uuid
from contextlib import asynccontextmanager
from concurrent.futures import ThreadPoolExecutor

from fastapi import FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, StreamingResponse

import scraper
import store
import validation
from agent import format_prompt, runner, tokens, transcript

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
    allow_methods=["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    allow_headers=["Content-Type"],
)

# max_workers=1 is the concurrency limit described above, not a performance choice.
_jobs = ThreadPoolExecutor(max_workers=1, thread_name_prefix="scrape")

# HOME and cwd for the `claude` CLI the assistant runs through. Kept inside .data/ so
# the whole of this app's state is one directory you can delete.
AGENT_WORKSPACE = os.path.join(store.DATA_DIR, "agent")


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
            "scrapedAt": row.get("updatedAt"),
            "truncated": bool(result.get("truncated")),
            "pagesScanned": int(result.get("pagesScanned") or 0),
            "totalPages": int(result.get("totalPages") or 0),
        }
    )
    return view


@app.get("/listings/saved-searches")
def list_saved_searches():
    """Every search kept for re-running, newest first."""
    return {"savedSearches": store.list_saved_searches()}


@app.post("/listings/saved-searches", status_code=201)
async def create_saved_search(request: Request):
    """Save one search under a name. The id is minted here, so names may repeat."""
    try:
        body = await request.json()
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid JSON in request body")

    try:
        name, source, max_pages, filters, hidden = validation.clean_saved_search(body)
        return store.put_saved_search(
            str(uuid.uuid4()), name, source, max_pages, filters, hidden
        )
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))


@app.put("/listings/saved-searches/{search_id}")
async def update_saved_search(search_id: str, request: Request):
    """Replace one saved search's name, filters and hidden items."""
    try:
        body = await request.json()
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid JSON in request body")

    try:
        validation.clean_search_id(search_id)
        name, source, max_pages, filters, hidden = validation.clean_saved_search(body)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))

    search = store.update_saved_search(search_id, name, source, max_pages, filters, hidden)
    if search is None:
        raise HTTPException(status_code=404, detail="That saved search no longer exists")
    return search


@app.put("/listings/saved-searches/{search_id}/hidden")
async def update_saved_search_hidden(search_id: str, request: Request):
    """Replace one saved search's hidden items, leaving its filters alone."""
    try:
        body = await request.json()
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid JSON in request body")

    try:
        validation.clean_search_id(search_id)
        hidden = validation.clean_hidden_update(body)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))

    search = store.set_saved_search_hidden(search_id, hidden)
    if search is None:
        raise HTTPException(status_code=404, detail="That saved search no longer exists")
    return search


@app.delete("/listings/saved-searches/{search_id}")
def delete_saved_search(search_id: str):
    """Forget one saved search. Deleting an id that is already gone counts as success."""
    try:
        validation.clean_search_id(search_id)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))

    store.delete_saved_search(search_id)
    return {"searchId": search_id}


# ------------------------------------------------------------------------- chat


def _sse(event: dict) -> str:
    """One SSE frame, in the `data: ` form the SPA's stream reader already parses."""
    return f"data: {json.dumps(event)}\n\n"


async def _chat_events(session_id: str, prompt: str, page_context: str, actions: list):
    """Run one turn, streaming it out and writing it down as it goes.

    Failures are reported as `error` events on a 200 stream rather than as an HTTP
    status. By the time anything can go wrong the response has usually started, and a
    turn that half-succeeded should leave the user with the half they saw plus a
    reason, not an exception in place of both.
    """
    token = tokens.get_token()
    if not token:
        yield _sse(
            {
                "type": "error",
                "content": (
                    "No Claude token is saved, so the assistant cannot answer. "
                    "Add one on the profile page and ask again."
                ),
            }
        )
        return

    history = transcript.recent_turns(session_id)
    enriched = format_prompt.build_enriched_prompt(page_context, actions, prompt, history)
    recorder = transcript.TurnRecorder()

    try:
        async for event in runner.stream_turn(enriched, token, AGENT_WORKSPACE):
            recorder.consume(event)
            yield _sse(event)
    except Exception as error:  # noqa: BLE001 - the request boundary must catch everything
        print(traceback.format_exc(), flush=True)
        event = {"type": "error", "content": f"{type(error).__name__}: {error}"}
        recorder.consume(event)
        yield _sse(event)
    finally:
        # In `finally`, not on the success path: a turn the user partly saw -- a closed
        # tab, a failure mid-answer -- still belongs in the transcript, and the next
        # turn reads worse without it. Nothing here yields, which is what makes it
        # legal under the GeneratorExit a disconnect raises.
        transcript.append(session_id, "user", prompt)
        if recorder.content or recorder.steps:
            transcript.append(
                session_id, "assistant", recorder.content, workflow=recorder.steps
            )


@app.post("/chat")
async def chat(request: Request):
    """Answer one message from the assistant panel, streaming as it is written."""
    try:
        body = await request.json()
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid JSON in request body")

    try:
        session_id, prompt, page_context, actions = validation.build_chat_request(body)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))

    return StreamingResponse(
        _chat_events(session_id, prompt, page_context, actions),
        media_type="text/event-stream",
        # The dev server sits behind nothing, but a proxy that buffered this would
        # turn a streamed answer back into one that lands whole.
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


@app.get("/chat/conversations/{session_id}")
def get_conversation(session_id: str):
    """Replay one stored conversation. An unknown id is an empty one, not an error."""
    return {"messages": transcript.load(session_id)}


# ---------------------------------------------------------------------- profile


@app.get("/profile/claude-token")
def get_claude_token():
    """Whether a Claude token is saved, when, and its last four characters."""
    return tokens.status()


@app.put("/profile/claude-token")
async def put_claude_token(request: Request):
    """Save the Claude token, or remove it when given an empty one."""
    try:
        body = await request.json()
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid JSON in request body")

    try:
        token = validation.clean_token(body)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))

    return tokens.put_token(token)


@app.exception_handler(HTTPException)
def http_exception_handler(request: Request, exc: HTTPException):
    """Answer errors as {"message": ...}, which is the shape the SPA's services read."""
    return JSONResponse(status_code=exc.status_code, content={"message": exc.detail})


if __name__ == "__main__":
    import uvicorn

    uvicorn.run(app, host=HOST, port=PORT, log_level="info")
