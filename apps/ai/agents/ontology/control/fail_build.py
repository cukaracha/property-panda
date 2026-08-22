"""
Fail Ontology Build Lambda.

The graph branch's single exit for anything that went wrong. Invoked only by Step
Functions, from every Catch on that branch and from the two states that give up on
CONSOLIDATE.

The write is conditional on the row not already being terminal. Several stages fail
the row themselves with a reason far more useful than a state machine error object,
and the branch's Catch fires afterwards; overwriting there would replace "none of the
uploaded documents could be converted" with a Lambda exception name.

It never raises. Its own caller has nowhere left to escalate to, and the state that
follows it is a Succeed: a Parallel cancels its sibling the moment a branch fails, so
a throw here would abandon the page index half written.
"""

import os
import time

import boto3

from shared import models

_dynamodb = boto3.resource("dynamodb")

JOB_TABLE = os.environ["JOB_TABLE"]

MAX_REASON_CHARS = 900


def _reason(error) -> str:
    """A short human reason from a Step Functions error object."""
    if isinstance(error, str) and error.strip():
        return error.strip()[:MAX_REASON_CHARS]
    if isinstance(error, dict):
        cause = str(error.get("Cause") or "").strip()
        name = str(error.get("Error") or "").strip()
        for candidate in (cause, name):
            if candidate:
                return candidate[:MAX_REASON_CHARS]
    return "The build stopped before it produced an ontology."


def main(job_id: str, error) -> dict:
    reason = _reason(error)
    try:
        _dynamodb.Table(JOB_TABLE).update_item(
            Key={"jobId": job_id},
            UpdateExpression="SET #s = :s, #e = :e, updatedAt = :now",
            ConditionExpression=(
                "attribute_not_exists(#s) OR NOT #s IN (:succeeded, :failed, :partial)"
            ),
            ExpressionAttributeNames={"#s": "status", "#e": "error"},
            ExpressionAttributeValues={
                ":s": models.STATUS_FAILED,
                ":e": reason,
                ":now": int(time.time()),
                ":succeeded": models.STATUS_SUCCEEDED,
                ":failed": models.STATUS_FAILED,
                ":partial": models.STATUS_PARTIAL,
            },
        )
        return {"jobId": job_id, "status": models.STATUS_FAILED, "error": reason}
    except _dynamodb.meta.client.exceptions.ConditionalCheckFailedException:
        # A stage already recorded a terminal status with a better reason than this.
        return {"jobId": job_id, "status": "already terminal", "error": reason}


def lambda_handler(event, context):
    job_id = event.get("jobId")
    try:
        return main(job_id, event.get("error"))
    except Exception as error:
        # Never raised onward: the state after this one is a Succeed, because a
        # failing branch would cancel the hydration running beside it.
        print(f"Could not mark ontology build {job_id} failed: {str(error)}")
        return {"jobId": job_id, "status": "unrecorded", "error": str(error)}
