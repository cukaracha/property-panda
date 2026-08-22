"""
Emit Ontology Build Lambda.

Writes the flat outputs into the owner's gold prefix and marks the build terminal.
Invoked only by Step Functions, as the last state of the graph branch. This is the
only place in the pipeline that records a successful terminal status.

The status is decided, never chosen: `partial` if any document failed to convert or
any page failed to extract, `succeeded` only when neither happened. Both verdicts are
settled long before this runs and both are read off the job row rather than out of a
payload. The segment Lambda writes `failedDocs` and the plan Lambda writes
`unextracted` precisely so the stage that marks the build terminal can see them. The
extraction sweep is allowed to give up with pages still pending, so without that second
term a build that dropped half its corpus would report success.

Finalizing is refused unless all seven outputs exist. Two of them (`pages.csv` and
`chunks.csv`) were written back at SEGMENT, so this is a genuine check across the
whole build rather than of the writes a few lines above.

Identity is read from the job row rather than carried through the execution input.
"""

import os
import time

import boto3

from shared import artifacts, emission, models

_dynamodb = boto3.resource("dynamodb")

JOB_TABLE = os.environ["JOB_TABLE"]
GOLD_BUCKET_NAME = os.environ["GOLD_BUCKET_NAME"]


def _mark_terminal(job_id: str, terminal: str, outputs: list) -> None:
    _dynamodb.Table(JOB_TABLE).update_item(
        Key={"jobId": job_id},
        UpdateExpression=(
            "SET stage = :stage, #s = :status, outputs = :outputs, "
            "completedAt = :now, updatedAt = :now"
        ),
        ExpressionAttributeNames={"#s": "status"},
        ExpressionAttributeValues={
            ":stage": "EMIT",
            ":status": terminal,
            ":outputs": outputs,
            ":now": int(time.time()),
        },
    )


def main(job_id: str) -> dict:
    item = _dynamodb.Table(JOB_TABLE).get_item(Key={"jobId": job_id}).get("Item")
    if not item:
        raise ValueError(f"no ontology job row for {job_id}")

    run_prefix = f"s3://{GOLD_BUCKET_NAME}/users/{item['userId']}/{job_id}/"
    result = emission.emit(run_prefix)

    outputs = emission.output_uris(run_prefix)
    missing = [uri for uri in outputs if not artifacts.exists(uri)]
    if missing:
        raise ValueError(f"cannot finalize: {len(missing)} output(s) were never written")

    failed = list(item.get("failedDocs") or [])
    unextracted = int((item.get("unextracted") or {}).get("count") or 0)
    terminal = (
        models.STATUS_PARTIAL if failed or unextracted else models.STATUS_SUCCEEDED
    )
    _mark_terminal(job_id, terminal, outputs)

    return {
        "jobId": job_id,
        "status": terminal,
        "failedDocuments": failed,
        "unextractedPages": unextracted,
        "nodes": result["nodes"],
        "edges": result["edges"],
        "pages": result["pages"],
    }


def lambda_handler(event, context):
    job_id = event.get("jobId")
    try:
        return main(job_id)
    except Exception as error:
        print(f"Error emitting ontology build {job_id}: {str(error)}")
        # Raised so the branch's Catch reaches fail_build. A build that wrote no
        # outputs must not be left reporting success.
        raise
