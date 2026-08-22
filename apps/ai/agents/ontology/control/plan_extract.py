"""
Plan Ontology Extraction Lambda.

Decides which pages still need extracting, and writes that list where a Distributed
Map's ItemReader can stream it. Invoked only by Step Functions, once before the
extraction fan-out and again after every pass.

The list is projected rather than read straight off the page manifest, and that buys
three things. The manifest carries every page's chunk boundaries, which at ten
thousand pages is megabytes of state no extraction branch needs. One Map state can
then serve both the initial fan-out and every sweep, because each pass reads a fresh
projection. And because the diff is taken against the elements that actually exist,
a re-run picks up exactly what is missing instead of extracting the corpus twice.

It also owns two things the loop around it cannot express. It records what is still
missing on the job row, because the sweep is allowed to give up and the stage that
marks the build terminal has no other way to tell a whole corpus from most of one. And
it returns how long to wait before the next sweep, because the arithmetic belongs in
Python where it can be read and tested rather than in ASL intrinsics.

Identity is read from the job row rather than carried through the execution input:
the sub every read and write path derives from is the one the start Lambda wrote from
a verified Cognito claim.
"""

import os
import time

import boto3

from shared import artifacts

_dynamodb = boto3.resource("dynamodb")

JOB_TABLE = os.environ["JOB_TABLE"]
GOLD_BUCKET_NAME = os.environ["GOLD_BUCKET_NAME"]

# Sweeps after the first pass. A page that has failed three separate invocations is
# not going to extract on the fourth, and the build is better off smaller than stuck.
MAX_PASSES = 3

# How long the state machine waits before the next sweep, widening each pass. Going
# straight back into a full-concurrency fan-out is the worst possible response to
# being rate limited, which is the likeliest reason a pass leaves pages behind. The
# ramp is computed rather than tabulated so it stays right if MAX_PASSES ever moves.
SWEEP_BACKOFF_STEP_SECONDS = 10
SWEEP_BACKOFF_MAX_SECONDS = 60

# Enough page ids on the row to see what went wrong, not enough to threaten the 400 KB
# DynamoDB item ceiling: ten thousand of them would be about 70 KB. The count is what
# decides the build's terminal status, so the list is diagnostic only.
MAX_RECORDED_PENDING = 100


def _run_prefix(user_sub: str, job_id: str) -> str:
    return f"s3://{GOLD_BUCKET_NAME}/users/{user_sub}/{job_id}/"


def _recorded_pages(run_prefix: str) -> set:
    """Every page id that already has an element file."""
    return {
        uri.rsplit("/", 1)[-1][: -len(".json")]
        for uri in artifacts.list_keys(artifacts.resolve(run_prefix, "elements/"))
        if uri.endswith(".json")
    }


def _pending_pages(run_prefix: str) -> tuple:
    """(everyPageId, pageIdsWithNoElementYet), in manifest order."""
    manifest = artifacts.read_json(artifacts.resolve(run_prefix, "pages/manifest.json"))
    recorded = _recorded_pages(run_prefix)
    page_ids = [entry["pageId"] for entry in manifest]
    return page_ids, [page_id for page_id in page_ids if page_id not in recorded]


def _set_stage(job_id: str) -> None:
    _dynamodb.Table(JOB_TABLE).update_item(
        Key={"jobId": job_id},
        UpdateExpression="SET stage = :stage, updatedAt = :now",
        ExpressionAttributeValues={":stage": "EXTRACT", ":now": int(time.time())},
    )


def _record_unextracted(job_id: str, pending: list) -> None:
    """Leave what is still missing on the row, every pass.

    The sweep can run out of passes with pages still pending, and when it does the
    state machine simply carries on into CONSOLIDATE: a smaller graph beats a dead
    build. But the stage that marks the build terminal has no other way to know that
    happened, and a build that quietly dropped half its corpus must not report
    success. Written on every pass rather than only the last, so the value is always
    the current truth however the loop ends.
    """
    _dynamodb.Table(JOB_TABLE).update_item(
        Key={"jobId": job_id},
        UpdateExpression="SET unextracted = :unextracted, updatedAt = :now",
        ExpressionAttributeValues={
            ":unextracted": {
                "count": len(pending),
                "pageIds": list(pending[:MAX_RECORDED_PENDING]),
            },
            ":now": int(time.time()),
        },
    )


def _next_wait_seconds(pass_index: int) -> int:
    return min(
        (pass_index + 1) * SWEEP_BACKOFF_STEP_SECONDS, SWEEP_BACKOFF_MAX_SECONDS
    )


def main(job_id: str, pass_index: int) -> dict:
    item = _dynamodb.Table(JOB_TABLE).get_item(Key={"jobId": job_id}).get("Item")
    if not item:
        raise ValueError(f"no ontology job row for {job_id}")

    run_prefix = _run_prefix(item["userId"], job_id)
    page_ids, pending = _pending_pages(run_prefix)

    if pass_index == 0:
        _set_stage(job_id)

    _record_unextracted(job_id, pending)

    pending_key = f"users/{item['userId']}/{job_id}/extract/pending-{pass_index}.json"
    artifacts.write_json(f"s3://{GOLD_BUCKET_NAME}/{pending_key}", pending)

    # No identity is returned. Every branch reads the sub and the email off the job
    # row itself, so nothing in the Map's data plane can influence whose prefix a
    # batch touches or whose subscription it spends.
    return {
        "jobId": job_id,
        "pass": pass_index,
        "passesLeft": max(MAX_PASSES - pass_index, 0),
        "pendingBucket": GOLD_BUCKET_NAME,
        "pendingKey": pending_key,
        "pendingCount": len(pending),
        "total": len(page_ids),
        "nextWaitSeconds": _next_wait_seconds(pass_index),
    }


def lambda_handler(event, context):
    job_id = event.get("jobId")
    return main(job_id, int(event.get("pass") or 0))
