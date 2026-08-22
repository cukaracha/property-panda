"""
Canonicalize Ontology Build Lambda.

Applies the committed schema to every verified element and writes the scored
node/edge graph. Invoked only by Step Functions, once the agent has reported a
consolidated schema.

There is no model input in this stage and never was: it is exact matching, content
hashing and arithmetic. It ran as a subagent only because it sat between two stages
that did need one, and a dispatch per stage cost a turn each way for a tool call that
decides nothing. The work itself is unchanged and lives in `shared/canonicalization`.

Identity is read from the job row rather than carried through the execution input.
"""

import os
import time

import boto3

from shared import canonicalization

_dynamodb = boto3.resource("dynamodb")

JOB_TABLE = os.environ["JOB_TABLE"]
GOLD_BUCKET_NAME = os.environ["GOLD_BUCKET_NAME"]


def _set_stage(job_id: str) -> None:
    _dynamodb.Table(JOB_TABLE).update_item(
        Key={"jobId": job_id},
        UpdateExpression="SET stage = :stage, updatedAt = :now",
        ExpressionAttributeValues={":stage": "CANONICALIZE", ":now": int(time.time())},
    )


def main(job_id: str) -> dict:
    item = _dynamodb.Table(JOB_TABLE).get_item(Key={"jobId": job_id}).get("Item")
    if not item:
        raise ValueError(f"no ontology job row for {job_id}")

    _set_stage(job_id)
    run_prefix = f"s3://{GOLD_BUCKET_NAME}/users/{item['userId']}/{job_id}/"
    return {"jobId": job_id, **canonicalization.build_graph(run_prefix)}


def lambda_handler(event, context):
    job_id = event.get("jobId")
    try:
        return main(job_id)
    except Exception as error:
        print(f"Error canonicalizing ontology build {job_id}: {str(error)}")
        # Raised so the branch's Catch reaches fail_build, which is the one place
        # that decides what a stopped build says to the user.
        raise
