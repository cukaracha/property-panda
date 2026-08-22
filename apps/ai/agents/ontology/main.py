"""AgentCore entrypoint for the ontology agent.

This runtime is the model in an otherwise deterministic pipeline. The convert state
machine owns every other stage: it converts each document to markdown, segments the
markdown into pages, fans EXTRACT out across its own Map (one branch per batch,
answered by this runtime), compacts the result, and then canonicalizes and emits in
Lambdas. What is left here needs a model to decide something.

Two modes, and they are shaped by their callers.

`extract` is one batch of pages and is answered **synchronously**: its caller is a
Map branch whose entire job is to wait, so there is no background task, no job-row
backstop and no trail. It reports the pages the tool actually recorded.

`build` is CONSOLIDATE. It is accepted and run in the background, returning 202-style
acceptance within a second so the caller is not held open, and it reports how it
ended by writing `agentStatus` on the job row — the one attribute the state machine
polls for. Progress never goes back over the invocation connection, which is what
lets a build survive the browser being closed. Inside that one background task the
stage runs as two concurrent halves, types and predicates, because the two designs
share almost nothing and running them in sequence made the stage twice as long as it
needed to be. Neither half writes the schema. `merge_consolidation` does, once both
have committed their part.

While the background task runs, `/ping` reports HealthyBusy (via add_async_task),
so the managed runtime does not reap the session as idle during a long stage.

The caller's personal Claude token is resolved per email from the shared secret and
passed through `options.env`, so concurrent runs for different users stay isolated
and every build consumes the subscription of the person who started it. A missing
token is a clean, recoverable failure — never a fallback to some shared credential.
"""

import asyncio
import json
import logging
import os
import sys
import time
import traceback

from bedrock_agentcore.runtime import BedrockAgentCoreApp
from claude_agent_sdk import ResultMessage, query

from run_store import RunStore
from sdk_options import (
    PREDICATES_ROLE,
    TYPES_ROLE,
    build_consolidate_options,
    build_extract_options,
    load_prompts,
)
from shared import artifacts, models
from stream_map import StreamMapper
from tools import extract as extract_tools
from tools.consolidate import merge_consolidation, prime_vocab
from tools.context import RunContext

JOB_TABLE = os.environ.get('JOB_TABLE', '')
CLAUDE_TOKENS_SECRET = os.environ.get('CLAUDE_TOKENS_SECRET', '')
SILVER_BUCKET_NAME = os.environ.get('SILVER_BUCKET_NAME', '')
GOLD_BUCKET_NAME = os.environ.get('GOLD_BUCKET_NAME', '')
REGION = os.environ.get('AWS_REGION', 'us-east-1')
WORKSPACE_ROOT = os.environ.get('WORKSPACE_ROOT', '/tmp/ontology')

# Container stdout is block-buffered, and a background task's traceback would
# otherwise never reach CloudWatch — a dead build would look like a silent one.
logging.basicConfig(level=logging.INFO, stream=sys.stdout)

app = BedrockAgentCoreApp()

_PROMPTS = load_prompts()

# Strong references to in-flight background tasks. Without this the event loop is
# free to garbage-collect a task whose coroutine is still running once the request
# handler returns, which would silently kill the build.
_BACKGROUND_TASKS: set = set()


def _as_dict(payload) -> dict:
    """Unwrap the payload, which arrives either bare or wrapped in `input`."""
    if isinstance(payload, str):
        payload = json.loads(payload)
    if isinstance(payload, dict) and isinstance(payload.get('input'), dict):
        payload = payload['input']
    if not isinstance(payload, dict):
        raise ValueError('payload must be an object')
    return payload


def parse_payload(payload) -> dict:
    """Pull the build's identity from the (possibly wrapped) payload.

    Nothing about the corpus is carried any more. CONSOLIDATE reads a vocabulary
    that was aggregated before it was invoked, so the list of converted markdown
    keys — which at hundreds of documents was a large prompt for a stage that opens
    none of them — has no reader left.
    """
    payload = _as_dict(payload)

    build = {
        'job_id': payload.get('jobId'),
        'user_sub': payload.get('userSub'),
        'email': payload.get('email'),
        'title': payload.get('title', ''),
    }

    if not all(build[field] for field in ('job_id', 'user_sub', 'email')):
        raise ValueError(
            "payload must carry 'jobId', 'userSub' and 'email' (optionally wrapped in 'input')"
        )
    return build


def parse_extract_payload(payload) -> dict:
    """Pull one extraction batch's identity, pages and deadline from the payload."""
    payload = _as_dict(payload)

    request = {
        'job_id': payload.get('jobId'),
        'user_sub': payload.get('userSub'),
        'email': payload.get('email'),
        'page_ids': [str(page_id) for page_id in (payload.get('pageIds') or [])],
        'deadline_epoch': int(payload.get('deadlineEpoch') or 0),
    }

    if not all(request[field] for field in ('job_id', 'user_sub', 'email', 'page_ids')):
        raise ValueError(
            "an extract payload must carry 'jobId', 'userSub', 'email' and 'pageIds'"
        )
    return request


# One token per email for the life of the container. A warm microVM is handed several
# extract batches in a row and the whole secret was being fetched for each of them,
# ahead of any model work. A token cannot change inside a build, and a container that
# outlives one only pays the fetch again for an email it has not seen.
_TOKEN_CACHE: dict = {}


def _resolve_token(email: str):
    """Read the caller's Claude subscription token from the shared secret.

    The secret maps each email to a {token, updatedAt} entry, the shape the profile
    endpoint writes. A build consumes the caller's own subscription, so a missing
    entry is a clear, recoverable failure rather than a fallback to a shared
    credential. A miss is not cached, so saving a token on the profile page and
    starting again works without waiting for the container to go.
    """
    if email in _TOKEN_CACHE:
        return _TOKEN_CACHE[email]

    import boto3

    client = boto3.client('secretsmanager', region_name=REGION)
    raw = client.get_secret_value(SecretId=CLAUDE_TOKENS_SECRET)['SecretString']
    entry = json.loads(raw).get(email) or {}
    token = entry.get('token')
    if token:
        _TOKEN_CACHE[email] = token
    return token


# The two halves of CONSOLIDATE, each a role with its own charter and its own tools,
# and the label its events carry in the trail. Designing both halves in one turn was
# the longest single stretch in a build, and they share almost nothing: one is about
# roles and merges, the other about direction and inverses.
CONSOLIDATE_HALVES = (
    (TYPES_ROLE, 'types'),
    (PREDICATES_ROLE, 'predicates'),
)


def _compose_task_prompt(ctx: RunContext, title: str, half: str) -> str:
    """One CONSOLIDATE half's opening instruction."""
    return (
        f"Run the {half} half of the CONSOLIDATE stage of this ontology build. Every page "
        'has been extracted and verified already, and the raw vocabulary they produced is '
        f"waiting for you. Design the canonical {half} and commit them.\n\n"
        f"Build id: {ctx.job_id}\n"
        f"Title: {title or '(untitled)'}\n"
    )


@app.entrypoint
async def invoke(payload) -> dict:
    """Route to the mode the caller asked for.

    `build` is accepted and handed to a background task, so the caller is never held
    open for the length of a build. `extract` is answered synchronously: its caller is
    a Step Functions Map branch whose whole purpose is to wait, and it must never take
    the background path — that path ends in the job-row backstop, and a thousand
    concurrent batches would each try to mark the build failed.
    """
    mode = _as_dict(payload).get('mode') or 'build'

    if mode == 'extract':
        return await run_extract(parse_extract_payload(payload))

    build = parse_payload(payload)
    task = asyncio.create_task(_run_guarded(build))
    _BACKGROUND_TASKS.add(task)
    task.add_done_callback(_BACKGROUND_TASKS.discard)
    return {'status': 'accepted', 'jobId': build['job_id']}


def _compose_extract_prompt(pages: list) -> str:
    """The batch's opening instruction: these pages, in this order, and no others.

    The text is handed over rather than fetched. It is already in hand by the time the
    model runs, so a read tool would only have bought a turn and a round trip per page.
    """
    listed = '\n\n'.join(
        f"### {page['page_id']}\n"
        f"Document: {page['doc_title']} (page {page['page_number']})\n\n"
        f"{page['text']}"
        for page in pages
    )
    return (
        f"Extract the following {len(pages)} page(s), one at a time. Record what you "
        'extracted from each page before moving to the next.\n\n'
        f"{listed}\n"
    )


# What a rate limit looks like in the text the SDK surfaces, either as an exception or
# as an error result. There is no structured signal to read instead: ResultMessage
# reports how a run ended, not why the API refused it. So this is a heuristic, and it
# is only ever allowed to choose a backoff length and a log line. What is actually true
# about a batch is `pending`, and that is computed from the pages the tool wrote.
_THROTTLE_SIGNATURES = ('rate limit', 'rate_limit', '429', 'overloaded', 'usage limit')


def _looks_throttled(text: str) -> bool:
    lowered = (text or '').lower()
    return any(signature in lowered for signature in _THROTTLE_SIGNATURES)


async def run_extract(request: dict) -> dict:
    """Run one batch of EXTRACT and report the pages that were actually recorded.

    What comes back is `ctx.recorded_pages`, written by the tool, never the model's
    closing summary: a batch that claims a page it did not record is exactly what the
    anchor verifier exists to catch, and the sweep pass would silently believe it.

    Every page is written to S3 the moment it is finished, so a batch cut short by its
    deadline leaves its finished work behind and the sweep collects the rest.

    Nothing in here raises. The entrypoint's return value is the calling Map branch's
    answer, so an escaping exception becomes an opaque AgentCore 500 that the branch
    cannot tell from a rate limit and cannot act on. A failure is reported as data.
    """
    job_id, page_ids = request['job_id'], request['page_ids']
    deadline = request['deadline_epoch']

    token = _resolve_token(request['email'])
    if not token:
        return {
            'jobId': job_id,
            'status': 'failed',
            'recorded': [],
            'pending': page_ids,
            'error': 'the account has no Claude token',
        }

    workspace = f"{WORKSPACE_ROOT}/{job_id}-x-{page_ids[0]}"
    os.makedirs(f"{workspace}/.claude", exist_ok=True)

    ctx = RunContext(
        job_id,
        request['user_sub'],
        request['email'],
        [],
        page_ids=page_ids,
        silver_bucket=SILVER_BUCKET_NAME,
        gold_bucket=GOLD_BUCKET_NAME,
        region=REGION,
    )

    found = await asyncio.to_thread(extract_tools.prime_batch, ctx, page_ids)
    unknown = [page_id for page_id in page_ids if page_id not in found]
    if unknown:
        print(f"[ontology] {job_id}: {len(unknown)} page(s) not in the manifest", flush=True)

    print(f"[ontology] {job_id}: extracting {len(found)} page(s)", flush=True)
    truncated = False
    failure = ''
    try:
        if found:
            options = build_extract_options(ctx, _PROMPTS, token, workspace)
            pages = [extract_tools.batch_page(ctx, page_id) for page_id in found]
            messages = query(prompt=_compose_extract_prompt(pages), options=options)
            try:
                async for message in messages:
                    if isinstance(message, ResultMessage) and message.is_error:
                        failure = f"{message.subtype}: {message.result or ''}"
                    if deadline and time.time() >= deadline:
                        truncated = True
                        break
            finally:
                # The generator owns a `claude` subprocess; breaking out of the loop
                # without closing it would leave one behind on every truncated batch,
                # and a warm microVM is reused.
                closer = getattr(messages, 'aclose', None)
                if closer is not None:
                    await closer()
    except Exception as error:  # noqa: BLE001 - the batch boundary must catch everything
        print(traceback.format_exc(), flush=True)
        failure = f"{type(error).__name__}: {error}"
    finally:
        extract_tools.release_batch(ctx)

    recorded = sorted(ctx.recorded_pages)
    pending = [page_id for page_id in page_ids if page_id not in ctx.recorded_pages]
    throttled = bool(pending) and _looks_throttled(failure)
    print(
        f"[ontology] {job_id}: recorded {len(recorded)} of {len(page_ids)} page(s)"
        f"{' (deadline reached)' if truncated else ''}"
        f"{' (rate limited)' if throttled else ''}",
        flush=True,
    )
    result = {
        'jobId': job_id,
        'status': 'ok' if not pending else 'partial',
        'recorded': recorded,
        'pending': pending,
        'truncated': truncated,
        'throttled': throttled,
    }
    if failure:
        result['error'] = failure
    return result


async def _run_guarded(build: dict) -> None:
    """Run CONSOLIDATE, keeping /ping busy and never letting a failure go silent.

    Two things have to hold however the run ends. An unhandled failure is recorded
    with a stated reason, so a crash surfaces as a stopped build rather than one that
    merely stops updating. And `agentStatus` is always written — the state machine
    polls for exactly that attribute, so a run that simply stopped would otherwise
    leave it waiting until its own ceiling.

    The backstop is scoped to `agentStatus` and deliberately not to `status`. The
    agent no longer marks a build terminal; EMIT does, in a Lambda, minutes after this
    process has exited.
    """
    ping_task_id = app.add_async_task('ontology')
    store = RunStore(JOB_TABLE, build['job_id'], REGION)
    try:
        reason = await execute_build(build, store)
    except Exception as error:  # noqa: BLE001 - the build boundary must catch everything
        print(traceback.format_exc(), flush=True)
        reason = f"{type(error).__name__}: {error}"
        store.append_event({'type': 'status', 'content': 'failed', 'subtype': 'build_failed'})
    finally:
        app.complete_async_task(ping_task_id)

    # Outside the finally so a failure here can never leave /ping reporting
    # HealthyBusy, and in its own guard because this is the last thing standing
    # between a stopped run and a state machine that polls for two hours.
    try:
        if store.ensure_agent_terminal(
            reason or 'CONSOLIDATE stopped before it committed a schema.'
        ):
            print(
                f"[ontology] build {build['job_id']} ended without a schema: {reason}",
                flush=True,
            )
    except Exception:  # noqa: BLE001 - nothing above this to catch it
        print(traceback.format_exc(), flush=True)


def _schema_committed(ctx: RunContext) -> bool:
    """Both consolidation artifacts exist. Not the model's word for it."""
    return all(
        artifacts.exists(artifacts.resolve(ctx.run_prefix, name))
        for name in ('consolidate/maps.json', 'consolidate/schema.json')
    )


async def _run_consolidate_half(
    role: str, half: str, ctx: RunContext, build: dict, token: str, store: RunStore,
) -> str:
    """Run one half of CONSOLIDATE and return its last message.

    Each half gets its own workspace. The two `claude` subprocesses run at the same
    time and `HOME` and `CLAUDE_CONFIG_DIR` are per-workspace, so sharing one would
    have them writing over each other's CLI state.

    Both halves write the one trail, which is safe because `append_event` never awaits
    and so cannot be interleaved mid-entry by the other task. What it cannot do is say
    which half spoke, so every event is labelled on the way in.
    """
    workspace = f"{WORKSPACE_ROOT}/{build['job_id']}-{half}"
    os.makedirs(f"{workspace}/.claude", exist_ok=True)

    options = build_consolidate_options(role, ctx, _PROMPTS, token, workspace)
    mapper = StreamMapper()
    last_message = ''

    async for message in query(
        prompt=_compose_task_prompt(ctx, build['title'], half), options=options
    ):
        for event in mapper.consume(message):
            store.append_event({**event, 'content': f"{half}: {event.get('content', '')}"})
            if event['type'] == 'message':
                last_message = event['content']

    return last_message


async def execute_build(build: dict, store: RunStore) -> str:
    """Run CONSOLIDATE to completion. Returns a failure reason, or '' if none is known.

    The two halves are designed concurrently and each commits only its own part file.
    Neither writes the schema: `merge_consolidation` does, once both parts are in, so
    the artifacts the verdict rests on cannot exist from a half-finished design.
    """
    token = _resolve_token(build['email'])
    if not token:
        store.append_event({'type': 'status', 'content': 'failed', 'subtype': 'missing_token'})
        return (
            'This build cannot start because the account has no Claude token. '
            'Save one on the profile page and start the build again.'
        )

    job_id = build['job_id']
    ctx = RunContext(
        job_id,
        build['user_sub'],
        build['email'],
        [],
        silver_bucket=SILVER_BUCKET_NAME,
        gold_bucket=GOLD_BUCKET_NAME,
        region=REGION,
    )

    print(f"[ontology] consolidating build {job_id}", flush=True)

    # Primed once, on the shared context, so two concurrent halves do not both race
    # through the memo and read the same vocabulary object twice.
    await asyncio.to_thread(prime_vocab, ctx)

    outcomes = await asyncio.gather(
        *(
            _run_consolidate_half(role, half, ctx, build, token, store)
            for role, half in CONSOLIDATE_HALVES
        ),
        return_exceptions=True,
    )
    store.flush()

    last_message = ''
    for (_role, half), outcome in zip(CONSOLIDATE_HALVES, outcomes):
        if isinstance(outcome, BaseException):
            print(f"[ontology] {job_id}: the {half} half failed", flush=True)
            print(''.join(traceback.format_exception(outcome)), flush=True)
            ctx.failure_reason = ctx.failure_reason or (
                f"The {half} half of CONSOLIDATE stopped: "
                f"{type(outcome).__name__}: {outcome}"
            )
        elif outcome:
            last_message = outcome

    try:
        await asyncio.to_thread(merge_consolidation, ctx)
    except Exception as error:  # noqa: BLE001 - a half that never committed lands here
        print(traceback.format_exc(), flush=True)
        ctx.failure_reason = ctx.failure_reason or f"{type(error).__name__}: {error}"

    # The verdict is the artifacts, not the transcript. A run that talked its way to a
    # confident summary without writing a schema has not consolidated anything.
    if _schema_committed(ctx):
        store.set_agent_status(models.AGENT_CONSOLIDATED)
        print(f"[ontology] build {job_id} consolidated", flush=True)
        return ''

    print(f"[ontology] build {job_id} finished without a schema", flush=True)
    return ctx.failure_reason or last_message


if __name__ == '__main__':
    app.run()
