"""
Get Ontology Build Status Lambda.

Returns the current status of a build job by jobId — the coarse stage, the live
conversion and extraction progress counters, the per-stage tallies the build report
reads, the gold output S3 URIs (when terminal), the agent's recent activity trail,
and any error. The frontend polls this until a terminal status (succeeded / failed /
partial).

The two stages that can lose work report it in the same shape: how many units were
attempted, how many finished, and which ones did not. That is what lets a `partial`
build say which step it lost work in rather than only that it lost some.

A build that lost documents to conversion stops before extraction and reports
`awaitingReview`, which is not terminal: the review endpoint resumes it. Everything that
gate needs is here, because the frontend has no other source for it — `failedDocKeys`
names the documents to answer for and `reviewRounds` says how many retries are left. The
failure keys are returned rather than only their filenames because a key is the handle a
retry or a replacement is submitted under, and the corpus is here to resolve one to the
other.

`indexStatus` is reported alongside `status` and is deliberately independent of it.
The graph and the page index are built by two concurrent branches, so an ontology
can be finished and not yet searchable, and hydration can fail without invalidating
anything the user is looking at.

A job the caller may not read is reported as 404, not 403: a jobId is a uuid, and
answering "that exists but is not yours" would turn this endpoint into a way to
probe for other users' builds. A published ontology is readable by anyone, so the
view carries `visibility` and `isOwner` and the frontend offers only what the caller
is actually allowed to do with it.
"""

import os

import boto3
from aws_utils import auth_context, lambda_utils

from shared import models

_dynamodb = boto3.resource("dynamodb")

JOB_TABLE = os.environ["JOB_TABLE"]

# Enough recent activity for the UI to show what the build is doing without
# growing the polled payload without bound.
TRAIL_TAIL = 20


def _counts(source: dict, *names) -> dict:
    """Named counters off the row as plain ints.

    DynamoDB hands numbers back as Decimal and the response helper serializes those
    with `str`, so a counter read straight off the row would reach the frontend as
    "8" rather than 8. That is harmless for a progress bar built by interpolation and
    wrong for anything that compares or adds, which is what these are for.
    """
    return {name: int((source or {}).get(name) or 0) for name in names}


def _extract_metrics(item: dict) -> dict:
    """How many pages were extracted and how many were given up on.

    `extracted` is derived by subtraction rather than read off `progress.done`.
    That counter is bumped once per extract branch, and a page picked up again by a
    later sweep is counted twice, so it is a progress bar and not a tally.
    `unextracted` is recomputed by plan_extract on every pass from the element files
    that actually exist, which makes it the honest figure.
    """
    progress = item.get("progress") or {}
    unextracted = item.get("unextracted") or {}
    total = int(progress.get("total") or 0)
    failed = int(unextracted.get("count") or 0)
    return {
        "total": total,
        "extracted": max(total - failed, 0),
        "failed": failed,
        # Already capped by plan_extract, so a build that extracted nothing does not
        # put every page id it has into a payload the frontend polls.
        "pageIds": list(unextracted.get("pageIds") or []),
    }


def main(job_id: str, user_sub: str):
    """Return the job's status view, or None if it does not exist or may not be read."""
    item = _dynamodb.Table(JOB_TABLE).get_item(Key={"jobId": job_id}).get("Item")
    if not models.can_read(item, user_sub):
        return None
    return {
        "jobId": item["jobId"],
        "title": item.get("title"),
        # Absent on a private build. Reported alongside isOwner because publishing,
        # deleting and redriving are the owner's alone, while reading is not.
        "visibility": item.get("visibility"),
        "isOwner": models.owner_of(item) == user_sub,
        "ownerEmail": item.get("email"),
        "status": item.get("status"),
        "indexStatus": item.get("indexStatus"),
        "stage": item.get("stage"),
        "progress": item.get("progress", {"done": 0, "total": 0}),
        # The conversion counter the Convert Map bumps live, and the tally the fan-in
        # writes once every document is terminal. Both are reported because the first
        # is the only thing that moves while CONVERT runs and the second is the only
        # one that separates a document that was carried over from one that converted.
        "convertProgress": _counts(item.get("convertProgress"), "done", "failed", "total"),
        "convert": (
            _counts(item["convert"], "total", "attempted", "succeeded", "failed", "carried")
            if item.get("convert")
            else None
        ),
        "extract": _extract_metrics(item),
        "outputs": item.get("outputs", []),
        "docNames": item.get("docNames", []),
        # Positionally matched to docNames, and the handle a corpus update names its
        # kept documents by. Returned here rather than from list_builds because a
        # library of a hundred builds would carry megabytes of keys nobody reads.
        "docKeys": item.get("docKeys", []),
        # The build this one was derived from by a corpus update, absent on an
        # ordinary build. It is what tells the frontend a run began with
        # CARRY_FORWARD, so the stepper does not credit a stage that never ran.
        "sourceJobId": item.get("sourceJobId"),
        "failedDocs": item.get("failedDocs", []),
        # The same documents named the way the review gate acts on them. Returned as
        # keys rather than joined to names here because the frontend already holds
        # docKeys and docNames positionally matched, and a key is the only handle a
        # retry or a replacement can be submitted under.
        "failedDocKeys": item.get("failedDocKeys", []),
        # How many times this build has already been sent back through conversion, so
        # the review panel can stop offering a retry once the ceiling is reached.
        "reviewRounds": int(item.get("reviewRounds") or 0),
        # Set when this build was derived to complete another that stopped short, so
        # the library can show a retry as a retry rather than as a second ontology
        # over the same documents.
        "redriveOf": item.get("redriveOf"),
        "trail": (item.get("trail") or [])[-TRAIL_TAIL:],
        "error": item.get("error"),
    }


def lambda_handler(event, context):
    options_response = lambda_utils.handle_options(event)
    if options_response:
        return options_response

    try:
        auth = auth_context.get_auth_context(event)
        query_params = event.get("queryStringParameters") or {}
        job_id = query_params.get("jobId")

        if not job_id:
            return lambda_utils.bad_request("Missing jobId query parameter")

        result = main(job_id, auth.user_id)
        if result is None:
            return lambda_utils.not_found("Job not found")

        return lambda_utils.success_response(result)

    except auth_context.AuthContextError as e:
        return lambda_utils.unauthorized(str(e))
    except Exception as e:
        print(f"Error getting ontology build status: {str(e)}")
        return lambda_utils.server_error(str(e))
