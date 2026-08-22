"""
Await Conversion Review Lambda.

The build's one human-in-the-loop gate. Invoked only by Step Functions, through
`.waitForTaskToken`, after Segment has run on a build that lost at least one document
to conversion. It records the task token on the job row and returns; the execution
then sits in that state until the review endpoint sends the token back.

The gate is placed after Segment rather than straight after the Convert Map so that it
opens with everything the user needs to answer it already written: `failedDocs` and
`failedDocKeys` name what was lost, `convert` tallies what was produced, and `progress`
says how many pages the corpus came to. Segmentation is deterministic and takes seconds,
so gating after it costs nothing and gates the part that is actually expensive, which is
everything inside BuildAndIndex.

Nothing here decides anything. The three answers are the review endpoint's to send, and
this stage's only job is to make the token reachable. That is why a failed write is
raised rather than swallowed: a token nobody can read would leave the execution parked
for a day and the build stuck on a status no request could clear.

Identity is not read or checked here. The endpoint that resumes the execution is the one
that authorizes the caller, and it does that against the same job row this writes to.
"""

import os
import time

import boto3

from shared import models

_dynamodb = boto3.resource("dynamodb")

JOB_TABLE = os.environ["JOB_TABLE"]


def _open_review(job_id: str, task_token: str) -> None:
    """Park the build on the gate, with the token that reopens it.

    Conditional on the build still being in flight. A build that reached a terminal
    status while this ran has already told the user something, and quietly moving it
    back to a waiting state would replace a finished answer with a question.
    """
    _dynamodb.Table(JOB_TABLE).update_item(
        Key={"jobId": job_id},
        UpdateExpression=(
            "SET #s = :awaiting, reviewToken = :token, reviewOpenedAt = :now, "
            "updatedAt = :now"
        ),
        ConditionExpression="attribute_not_exists(#s) OR #s = :processing",
        ExpressionAttributeNames={"#s": "status"},
        ExpressionAttributeValues={
            ":awaiting": models.STATUS_AWAITING_REVIEW,
            ":processing": models.STATUS_PROCESSING,
            ":token": task_token,
            ":now": int(time.time()),
        },
    )


def main(job_id: str, task_token: str) -> dict:
    """Record the token the review endpoint will send back."""
    if not job_id:
        raise ValueError("jobId is required")
    if not task_token:
        raise ValueError("taskToken is required")

    _open_review(job_id, task_token)
    return {"jobId": job_id}


def lambda_handler(event, context):
    job_id = event.get("jobId")
    try:
        return main(job_id, event.get("taskToken"))
    except Exception as error:
        # Raised so the state machine's Catch reaches fail_build. The alternative is
        # worse than a failed build: the execution would wait out the gate's whole
        # timeout on a token that was never stored.
        print(f"Error opening conversion review for ontology build {job_id}: {str(error)}")
        raise
