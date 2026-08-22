"""
Publish Ontology Lambda.

Shares one finished ontology with every other user, or takes it back:

    POST   /ontology/builds/{jobId}/publish -> published
    DELETE /ontology/builds/{jobId}/publish -> private again

Nothing is copied and nothing moves. The build's documents, pages, extracted
elements and page vectors stay exactly where the run that produced them wrote them,
under `users/{ownerSub}/{jobId}/`, and every read path resolves that prefix from the
job row rather than from whoever is asking. So publishing is a single attribute on
one row, and the whole cost of sharing a thousand-page ontology is that write.

The attribute pair is what the by_visibility index is keyed on, and it is set and
removed together so the index stays sparse: a private build carries neither, which is
what lets the library list "everything published" as a query rather than a scan.

Publishing is the owner's alone, and a build the caller does not own is reported as
404 rather than 403, matching every other route in this domain so a jobId cannot be
probed for existence. Only a build that produced something can be published: sharing
one that is still running, or that was deleted out from under its readers, would put
an ontology in other people's libraries that they cannot open.
"""

import os
import time

import boto3
from aws_utils import auth_context, lambda_utils

_dynamodb = boto3.resource("dynamodb")

JOB_TABLE = os.environ["JOB_TABLE"]

VISIBILITY_PUBLISHED = "published"

# A build worth sharing is one that emitted a graph. `partial` counts: it lost some
# documents or pages and says so, and it is still an ontology.
PUBLISHABLE_STATUSES = ("succeeded", "partial")


def _publish(job_id: str) -> dict:
    """Set both index key attributes, so the build enters by_visibility."""
    now = int(time.time())
    _dynamodb.Table(JOB_TABLE).update_item(
        Key={"jobId": job_id},
        UpdateExpression=(
            "SET #visibility = :visibility, publishedAt = :now, updatedAt = :now"
        ),
        ExpressionAttributeNames={"#visibility": "visibility"},
        ExpressionAttributeValues={":visibility": VISIBILITY_PUBLISHED, ":now": now},
    )
    return {"jobId": job_id, "visibility": VISIBILITY_PUBLISHED, "publishedAt": now}


def _unpublish(job_id: str) -> dict:
    """Remove both, so the build leaves the index rather than sitting in it unshared."""
    _dynamodb.Table(JOB_TABLE).update_item(
        Key={"jobId": job_id},
        UpdateExpression="SET updatedAt = :now REMOVE #visibility, publishedAt",
        ExpressionAttributeNames={"#visibility": "visibility"},
        ExpressionAttributeValues={":now": int(time.time())},
    )
    return {"jobId": job_id, "visibility": None}


def main(job_id: str, user_sub: str, published: bool):
    """Publish or unpublish the caller's own build, or None if it is not theirs."""
    item = _dynamodb.Table(JOB_TABLE).get_item(Key={"jobId": job_id}).get("Item")
    if not item or item.get("userId") != user_sub:
        return None

    if published and item.get("status") not in PUBLISHABLE_STATUSES:
        raise ValueError("only a finished ontology can be shared")

    return _publish(job_id) if published else _unpublish(job_id)


def lambda_handler(event, context):
    options_response = lambda_utils.handle_options(event)
    if options_response:
        return options_response

    try:
        auth = auth_context.get_auth_context(event)

        job_id = (event.get("pathParameters") or {}).get("jobId")
        if not job_id:
            return lambda_utils.bad_request("jobId is required")

        # The method is the verb: POST shares, DELETE takes it back. No body either
        # way, so there is nothing to disagree with the request line.
        published = str(event.get("httpMethod") or "").upper() != "DELETE"

        result = main(job_id, auth.user_id, published)
        if result is None:
            return lambda_utils.not_found("Job not found")
        return lambda_utils.success_response(result)

    except ValueError as e:
        return lambda_utils.bad_request(str(e))
    except auth_context.AuthContextError as e:
        return lambda_utils.unauthorized(str(e))
    except Exception as e:
        print(f"Error changing ontology visibility: {str(e)}")
        return lambda_utils.server_error(str(e))
