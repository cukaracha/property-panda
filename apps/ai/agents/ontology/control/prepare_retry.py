"""
Prepare Conversion Retry Lambda.

Invoked only by Step Functions, when the review gate is answered with "retry". It hands
the execution back to the Convert Map over just the documents the user asked to try
again, which is what makes a retry cost the failures and nothing else.

The review endpoint has already applied the user's decision to the job row: documents
that were dropped are gone from docKeys, replacements have been appended, and the set to
convert again is recorded as reviewRetryKeys. Every failed document is accounted for
there, so nothing that failed can survive into a later stage unreported.

This stage returns the four fields the Convert Map's ItemSelector reads, rebuilt exactly
as the start Lambda builds them. Segment discards the execution input on its way past
(its OutputPath is its own payload), so looping back to Convert means constructing that
input again rather than recovering it. Both lake paths are derived from the sub on the
job row, so a retry cannot be pointed at a prefix the build does not own.

The counters are reset to the retry set rather than left as they were, because the
stepper reads them as a live denominator: leaving 134 there while 5 documents convert
would show a build stalled at the start of a stage it had nearly finished.
"""

import os
import time

import boto3
from aws_utils import s3_utils

from shared import models

_dynamodb = boto3.resource("dynamodb")

JOB_TABLE = os.environ["JOB_TABLE"]
BRONZE_BUCKET_NAME = os.environ["BRONZE_BUCKET_NAME"]
SILVER_BUCKET_NAME = os.environ["SILVER_BUCKET_NAME"]


def _start_retry(job_id: str, retried: int) -> None:
    """Put the build back in flight over the retry set, and count the round.

    `failedDocKeys` is cleared rather than kept: the Convert Map appends to it as
    documents fail, so a list left in place would stack this round's failures on top of
    the previous round's. `failedDocs` is left alone until Segment rewrites it, so the
    build can still name what it lost while it is converting again.

    `reviewRounds` is what the endpoint checks its ceiling against. It is counted here
    rather than there so the number reflects rounds that actually ran.
    """
    _dynamodb.Table(JOB_TABLE).update_item(
        Key={"jobId": job_id},
        UpdateExpression=(
            "SET #s = :processing, stage = :stage, convertProgress = :progress, "
            "reviewRounds = if_not_exists(reviewRounds, :zero) + :one, updatedAt = :now "
            "REMOVE failedDocKeys, reviewToken, reviewRetryKeys"
        ),
        ExpressionAttributeNames={"#s": "status"},
        ExpressionAttributeValues={
            ":processing": models.STATUS_PROCESSING,
            ":stage": "CONVERT",
            ":progress": {"done": 0, "failed": 0, "total": int(retried)},
            ":zero": 0,
            ":one": 1,
            ":now": int(time.time()),
        },
    )


def main(job_id: str) -> dict:
    """Reset the conversion counters and hand the retry set back to the Convert Map."""
    if not job_id:
        raise ValueError("jobId is required")

    item = _dynamodb.Table(JOB_TABLE).get_item(Key={"jobId": job_id}).get("Item")
    if not item:
        raise ValueError(f"no ontology job row for {job_id}")

    doc_keys = list(item.get("reviewRetryKeys") or [])
    if not doc_keys:
        raise ValueError("the conversion review was answered with a retry but no documents")

    user_sub = item["userId"]
    _start_retry(job_id, len(doc_keys))

    return {
        "jobId": job_id,
        "docKeys": doc_keys,
        "inputBucket": BRONZE_BUCKET_NAME,
        "outputS3Prefix": (
            f"s3://{SILVER_BUCKET_NAME}/{s3_utils.user_prefix(user_sub, job_id)}"
        ),
    }


def lambda_handler(event, context):
    job_id = event.get("jobId")
    try:
        return main(job_id)
    except Exception as error:
        # Raised so the state machine's Catch reaches fail_build. A retry that cannot
        # be set up must stop the build rather than fall through to BuildAndIndex, which
        # would extract a corpus the user had just asked to change.
        print(f"Error preparing a conversion retry for ontology build {job_id}: {str(error)}")
        raise
