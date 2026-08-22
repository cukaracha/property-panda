"""
Start Ontology Agent Lambda.

Hands CONSOLIDATE to the agent runtime, which accepts and runs it in the background.
Invoked only by Step Functions, on the graph branch, once extraction has settled and
its output has been compacted into the vocabulary the stage reads.

It returns as soon as the runtime accepts. The state machine then polls `agentStatus`
on the job row rather than holding anything open, because CONSOLIDATE's duration is
not bounded by anything a Lambda timeout could sensibly cover.

Nothing about the corpus is passed. The agent derives every path from the sub on the
job row — written from a verified Cognito claim — so nothing in the state machine's
data plane can influence which user's prefix it touches, and the vocabulary it reads
is already sitting under that prefix.
"""

import json
import os
import time

import boto3

from shared import models

_dynamodb = boto3.resource("dynamodb")
_agentcore = boto3.client("bedrock-agentcore")

JOB_TABLE = os.environ["JOB_TABLE"]
AGENT_RUNTIME_ARN = os.environ["AGENT_RUNTIME_ARN"]


def _fail(job_id: str, reason: str) -> None:
    _dynamodb.Table(JOB_TABLE).update_item(
        Key={"jobId": job_id},
        UpdateExpression="SET #s = :s, #e = :e, updatedAt = :now",
        ExpressionAttributeNames={"#s": "status", "#e": "error"},
        ExpressionAttributeValues={
            ":s": models.STATUS_FAILED,
            ":e": reason,
            ":now": int(time.time()),
        },
    )


def _invoke_agent(job_id: str, item: dict) -> None:
    """Hand CONSOLIDATE to the AgentCore runtime; it accepts and returns immediately."""
    _agentcore.invoke_agent_runtime(
        agentRuntimeArn=AGENT_RUNTIME_ARN,
        runtimeSessionId=job_id,
        payload=json.dumps(
            {
                "mode": "build",
                "jobId": job_id,
                "userSub": item["userId"],
                "email": item["email"],
                "title": item.get("title", ""),
            }
        ).encode("utf-8"),
    )


def main(job_id: str) -> dict:
    """Advance the stage and hand the build to the agent."""
    item = _dynamodb.Table(JOB_TABLE).get_item(Key={"jobId": job_id}).get("Item")
    if not item:
        raise ValueError(f"no ontology job row for {job_id}")

    _dynamodb.Table(JOB_TABLE).update_item(
        Key={"jobId": job_id},
        UpdateExpression="SET stage = :stage, updatedAt = :now",
        ExpressionAttributeValues={":stage": "CONSOLIDATE", ":now": int(time.time())},
    )
    _invoke_agent(job_id, item)

    return {"jobId": job_id, "started": True}


def lambda_handler(event, context):
    job_id = event.get("jobId")
    try:
        return main(job_id)
    except Exception as error:
        # The agent's own backstop never gets to run if the agent is never invoked,
        # so this is the last chance to stop the row sitting on `processing` forever.
        # The error is re-raised so the branch's Catch reaches fail_build.
        print(f"Error starting ontology agent for {job_id}: {str(error)}")
        if job_id:
            try:
                _fail(job_id, f"The build could not be handed to the agent: {str(error)}")
            except Exception as fail_error:
                print(f"Could not mark {job_id} failed: {str(fail_error)}")
        raise
