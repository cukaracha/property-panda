"""
Get Ontology Build Outputs Lambda.

Presigns every gold output of one finished build and returns them as a map keyed
by artifact name (GET /ontology/builds/{jobId}/outputs), so the frontend fetches
nodes.csv, edges.csv, chunks.csv, pages.csv, schema.json and telemetry.json
without ever handling a raw S3 key.

This exists so the ontology page stops going through the generic download-url
endpoint. Access is checked against the job row before anything is presigned, and a
build the caller may not read is reported as 404 rather than 403 — matching
get_build_status, so a jobId cannot be probed for existence.

The keys are built from the build's OWNER, not from the caller. Publishing an
ontology moves nothing: its artifacts stay where the build that made them wrote them,
so a reader who is not the owner is presigned the owner's objects. Deriving the
prefix from the caller instead would presign a prefix that does not exist and hand
back an ontology with no outputs at all.
"""

import os

import boto3
from aws_utils import auth_context, lambda_utils, s3_utils

from shared import models

_dynamodb = boto3.resource("dynamodb")

JOB_TABLE = os.environ["JOB_TABLE"]
GOLD_BUCKET_NAME = os.environ["GOLD_BUCKET_NAME"]

# The six flat artifacts the ontology page renders.
OUTPUT_NAMES = ("nodes.csv", "edges.csv", "chunks.csv", "pages.csv",
                "schema.json", "telemetry.json")


def main(job_id: str, user_sub: str):
    """Presign one build's outputs, or None if the caller may not read it."""
    item = _dynamodb.Table(JOB_TABLE).get_item(Key={"jobId": job_id}).get("Item")
    if not models.can_read(item, user_sub):
        return None

    prefix = s3_utils.user_prefix(models.owner_of(item), job_id)
    outputs = {}
    for name in OUTPUT_NAMES:
        key = prefix + name
        if not s3_utils.is_file_exists(GOLD_BUCKET_NAME, key):
            continue
        outputs[name] = s3_utils.generate_presigned_download_url(
            GOLD_BUCKET_NAME, key)["presignedUrl"]

    return {"jobId": job_id, "status": item.get("status"), "outputs": outputs}


def lambda_handler(event, context):
    options_response = lambda_utils.handle_options(event)
    if options_response:
        return options_response

    try:
        auth = auth_context.get_auth_context(event)
        path_params = event.get("pathParameters") or {}
        job_id = path_params.get("jobId")

        if not job_id:
            return lambda_utils.bad_request("Missing jobId in the path")

        result = main(job_id, auth.user_id)
        if result is None:
            return lambda_utils.not_found("Job not found")

        return lambda_utils.success_response(result)

    except auth_context.AuthContextError as e:
        return lambda_utils.unauthorized(str(e))
    except Exception as e:
        print(f"Error getting ontology build outputs: {str(e)}")
        return lambda_utils.server_error(str(e))
