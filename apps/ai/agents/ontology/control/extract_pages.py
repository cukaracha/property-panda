"""
Extract Ontology Pages Lambda.

One branch of the extraction Distributed Map. It holds no extraction logic at all: it
hands a batch of page ids to the ontology AgentCore runtime in `extract` mode and
waits for the answer. Extraction is by far the largest share of a build's model
spend, and the runtime is where the caller's own Claude subscription is resolved, so
keeping the work there is what stops the fan-out from moving that spend onto the
application's account.

Waiting is the point. The Map's concurrency is the fan-out, and a branch that
returned early would let the state machine believe pages were extracted before they
were.

A batch that fails comes back as a failure record rather than an exception. The Map
tolerates failed branches and a sweep pass re-plans whatever is still missing, so
raising would only buy a retry of work that is already partly done.

Two retries do happen here, both on the invocation's own remaining time. An AgentCore
throttle is absorbed before the runtime is ever reached. And a response that came back
with pages unrecorded is tried once more, with only those pages, because the ones it
did record are already written and re-sending them would extract them twice.

Identity is read from the job row rather than from the item stream, for the same
reason the start Lambda does it: the sub is the one written from a verified Cognito
claim, and the Map's data plane must not be able to influence it.
"""

import json
import os
import random
import time

import boto3
from botocore.config import Config
from botocore.exceptions import ClientError

_dynamodb = boto3.resource("dynamodb")

JOB_TABLE = os.environ["JOB_TABLE"]
AGENT_RUNTIME_ARN = os.environ["AGENT_RUNTIME_ARN"]

# Under the Lambda's own 900 s ceiling, so a slow batch comes back as a clean
# ReadTimeoutError with a return value rather than as a killed invocation with no
# logs. Retries are off because the call is minutes long: botocore must never decide
# on its own to send a second one.
_agentcore = boto3.client(
    "bedrock-agentcore",
    config=Config(read_timeout=840, connect_timeout=10, retries={"max_attempts": 0}),
)

# Left on the invocation's clock so the runtime stops generating and reports what it
# recorded, instead of being cut off mid-page with nothing returned.
DEADLINE_MARGIN_SECONDS = 60

THROTTLE_CODES = {"ThrottlingException", "TooManyRequestsException", "ServiceQuotaExceededException"}
THROTTLE_BACKOFF_SECONDS = (5, 15, 45)

# Twenty branches throttled by the same limit are throttled at the same instant, so a
# fixed backoff makes them retry as one herd and collide again. The jitter is what
# spreads them out.
JITTER_FRACTION = 0.5

# One in-branch retry of whatever the runtime did not record, and only that. The pages
# it did record are already written, so re-sending the whole list would extract them
# twice. Beyond one attempt the sweep is the better instrument: it re-plans against
# what actually exists and it waits first.
RETRY_BACKOFF_SECONDS = 5
THROTTLED_RETRY_BACKOFF_SECONDS = 30

# Enough of the invocation's clock left to be worth another try: a dense page runs to
# about a minute, and the deadline margin has to survive on top of that.
RETRY_MIN_REMAINING_SECONDS = 180


def _page_ids(event: dict) -> list:
    """The batch's page ids, however the Map shaped them.

    With an ItemBatcher the branch input is `{"BatchInput": …, "Items": [...]}`; the
    projected pending file is a flat array of ids, so the items are strings. A bare
    list is tolerated so the Lambda can be invoked directly.
    """
    items = event.get("Items") if isinstance(event, dict) else event
    if items is None:
        items = event.get("pageIds") if isinstance(event, dict) else None
    page_ids = []
    for item in items or []:
        if isinstance(item, str):
            page_ids.append(item)
        elif isinstance(item, dict) and item.get("pageId"):
            page_ids.append(str(item["pageId"]))
    return page_ids


def _job_id(event) -> str:
    if not isinstance(event, dict):
        return ""
    batch_input = event.get("BatchInput") or {}
    return batch_input.get("jobId") or event.get("jobId") or ""


def _session_id(job_id: str, page_ids: list) -> str:
    """A distinct session per batch, deterministic so a retry lands on the same one.

    The API requires at least 33 characters. A job id is a uuid and a page id is five
    digits behind a letter, so this clears it with room to spare.
    """
    return f"{job_id}-x-{page_ids[0]}-{len(page_ids)}"


def _invoke(job_id: str, item: dict, page_ids: list, deadline_epoch: int) -> dict:
    response = _agentcore.invoke_agent_runtime(
        agentRuntimeArn=AGENT_RUNTIME_ARN,
        runtimeSessionId=_session_id(job_id, page_ids),
        payload=json.dumps(
            {
                "mode": "extract",
                "jobId": job_id,
                "userSub": item["userId"],
                "email": item["email"],
                "pageIds": page_ids,
                "deadlineEpoch": deadline_epoch,
            }
        ).encode("utf-8"),
    )
    body = response["response"].read()
    return json.loads(body) if body else {}


def _remaining_seconds(context) -> float:
    return context.get_remaining_time_in_millis() / 1000 if context else 900


def _deadline(context) -> int:
    """When the runtime should stop and report, in epoch seconds."""
    remaining = _remaining_seconds(context)
    return int(time.time() + max(remaining - DEADLINE_MARGIN_SECONDS, 30))


def _sleep_with_jitter(seconds: float) -> None:
    time.sleep(seconds + random.uniform(0, seconds * JITTER_FRACTION))


def _invoke_with_throttle_retry(job_id: str, item: dict, page_ids: list, context) -> dict:
    """Invoke the runtime, absorbing an AgentCore throttle on the branch's own clock."""
    for attempt, backoff in enumerate((*THROTTLE_BACKOFF_SECONDS, None)):
        try:
            return _invoke(job_id, item, page_ids, _deadline(context))
        except ClientError as error:
            code = error.response.get("Error", {}).get("Code", "")
            if code not in THROTTLE_CODES or backoff is None:
                raise
            print(f"{job_id}: {code} on attempt {attempt + 1}, retrying in ~{backoff}s")
            _sleep_with_jitter(backoff)

    return {"jobId": job_id, "status": "failed", "recorded": [], "pending": page_ids}


def _merge(first: dict, second: dict, page_ids: list) -> dict:
    """Fold a retry's answer into the first attempt's, over the original page list."""
    recorded = sorted(set(first.get("recorded") or []) | set(second.get("recorded") or []))
    merged = dict(second)
    merged["recorded"] = recorded
    merged["pending"] = [page_id for page_id in page_ids if page_id not in set(recorded)]
    merged["status"] = "ok" if not merged["pending"] else "partial"
    return merged


def main(event: dict, context) -> dict:
    job_id = _job_id(event)
    page_ids = _page_ids(event)
    if not job_id:
        raise ValueError("jobId is required")
    if not page_ids:
        return {"jobId": job_id, "status": "ok", "recorded": [], "pending": []}

    item = _dynamodb.Table(JOB_TABLE).get_item(Key={"jobId": job_id}).get("Item")
    if not item:
        raise ValueError(f"no ontology job row for {job_id}")

    result = _invoke_with_throttle_retry(job_id, item, page_ids, context)

    # One more try at whatever came back unrecorded, whatever the reason. A page that
    # did not extract is worth a second attempt, and a rate limit and a bad page are
    # not reliably distinguishable from here, so the retry is cause-agnostic and only
    # the wait length reads the runtime's guess.
    pending = list(result.get("pending") or [])
    if pending and _remaining_seconds(context) > RETRY_MIN_REMAINING_SECONDS:
        backoff = (
            THROTTLED_RETRY_BACKOFF_SECONDS
            if result.get("throttled")
            else RETRY_BACKOFF_SECONDS
        )
        print(f"{job_id}: retrying {len(pending)} unrecorded page(s) in ~{backoff}s")
        _sleep_with_jitter(backoff)
        retry = _invoke_with_throttle_retry(job_id, item, pending, context)
        return _merge(result, retry, page_ids)

    return result


def lambda_handler(event, context):
    try:
        return main(event, context)
    except Exception as error:
        # Returned rather than raised: the Map tolerates failed branches and the
        # sweep re-plans whatever is still missing, so failing the branch would only
        # retry pages that were already partly extracted.
        page_ids = _page_ids(event)
        print(f"Error extracting {len(page_ids)} page(s): {type(error).__name__}: {str(error)}")
        return {
            "jobId": _job_id(event),
            "status": "failed",
            "recorded": [],
            "pending": page_ids,
            "error": f"{type(error).__name__}: {str(error)}",
        }
