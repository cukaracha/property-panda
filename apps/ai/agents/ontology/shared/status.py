"""Ontology job status writes against the DynamoDB jobs table.

One row per build job (PK jobId). The control Lambdas own every field the frontend
stepper reads: the start Lambda seeds the row, each stage advances `stage` at its
boundary, and EMIT marks the terminal status. Attribute names are aliased because
`status`, `stage`, and `error` are DynamoDB reserved words.

What is left here is the one write the agent runtime makes on the hot path: the
atomic bump of `progress.done` from every extract branch. It is an ADD rather than a
read-modify-write precisely because a few dozen branches make it concurrently, with
no barrier Lambda in between.
"""

import os
import time

import boto3

_dynamodb = boto3.resource("dynamodb")

JOB_TABLE = os.environ["JOB_TABLE"]


def _table():
    return _dynamodb.Table(JOB_TABLE)


def increment_done(job_id, n=1):
    """Atomically bump progress.done — called concurrently by every extract branch."""
    _table().update_item(
        Key={"jobId": job_id},
        UpdateExpression=(
            "SET progress.done = if_not_exists(progress.done, :zero) + :n, updatedAt = :now"
        ),
        ExpressionAttributeValues={":n": int(n), ":zero": 0, ":now": int(time.time())},
    )


def get(job_id):
    return _table().get_item(Key={"jobId": job_id}).get("Item")
