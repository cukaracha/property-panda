"""
List Ontology Builds Lambda.

Returns the ontologies the signed-in user can open, newest first, for the frontend's
saved-ontologies panel (GET /ontology/builds). That is their own builds plus every
build anyone has published.

Both halves are queries, not scans. The caller's own come from the by_owner GSI on
their verified Cognito sub, so that query is scoped to one user — there is no filter
to forget and no way to page past your own partition into someone else's. The shared
half comes from by_visibility, which is sparse: a private build carries no
`visibility` attribute at all and so is not in that index, which is what makes
"everything published" a key condition rather than a filter over the whole table.

A build the caller owns and has published comes back from both queries, so the two
are merged on jobId with the owned copy winning.
"""

import os

import boto3
from aws_utils import auth_context, lambda_utils
from boto3.dynamodb.conditions import Key

from shared import models

_dynamodb = boto3.resource("dynamodb")

JOB_TABLE = os.environ["JOB_TABLE"]
OWNER_INDEX = "by_owner"
VISIBILITY_INDEX = "by_visibility"
MAX_BUILDS = 100


def _summary(item: dict, user_sub: str) -> dict:
    """One library entry, trimmed to what the panel actually renders."""
    return {
        "jobId": item["jobId"],
        "title": item.get("title"),
        "status": item.get("status"),
        # Independent of status: an ontology can be finished and not yet
        # searchable, so the panel has to be able to say which.
        "indexStatus": item.get("indexStatus"),
        # stage + progress let the panel's badge name the stage in flight
        # ("Extracting 7/12") instead of a flat "Building".
        "stage": item.get("stage"),
        "progress": item.get("progress"),
        # Only ever set alongside a deleteFailed status, so the panel can
        # say why the purge stopped and offer to run it again.
        "deleteError": item.get("deleteError"),
        # Set when this build was derived from another by a corpus update,
        # so the panel can mark it rather than listing two builds that
        # share a title and differ only by timestamp.
        "sourceJobId": item.get("sourceJobId"),
        # Set when it was derived to complete a build that stopped short, which
        # is a retry rather than a second ontology over the same documents.
        "redriveOf": item.get("redriveOf"),
        # What separates the caller's own section of the library from the shared
        # one, and what decides whether publishing and deleting are offered.
        "visibility": item.get("visibility"),
        "isOwner": models.owner_of(item) == user_sub,
        "ownerEmail": item.get("email"),
        "createdAt": int(item.get("createdAt", 0)),
        "docNames": item.get("docNames", []),
        "docCount": len(item.get("docKeys", [])),
    }


def _owned(user_sub: str) -> list:
    return _dynamodb.Table(JOB_TABLE).query(
        IndexName=OWNER_INDEX,
        KeyConditionExpression=Key("userId").eq(user_sub),
        ScanIndexForward=False,
        Limit=MAX_BUILDS,
    ).get("Items", [])


def _published() -> list:
    return _dynamodb.Table(JOB_TABLE).query(
        IndexName=VISIBILITY_INDEX,
        KeyConditionExpression=Key("visibility").eq(models.VISIBILITY_PUBLISHED),
        ScanIndexForward=False,
        Limit=MAX_BUILDS,
    ).get("Items", [])


def main(user_sub: str) -> dict:
    """Return everything the caller can open, newest first."""
    by_job = {item["jobId"]: item for item in _published()}
    # Second so an owned build that is also published keeps the owned copy. They are
    # the same row either way; this only makes the merge order deliberate.
    by_job.update({item["jobId"]: item for item in _owned(user_sub)})

    builds = sorted(
        (_summary(item, user_sub) for item in by_job.values()),
        key=lambda build: build["createdAt"],
        reverse=True,
    )
    return {"builds": builds}


def lambda_handler(event, context):
    options_response = lambda_utils.handle_options(event)
    if options_response:
        return options_response

    try:
        auth = auth_context.get_auth_context(event)
        return lambda_utils.success_response(main(auth.user_id))

    except auth_context.AuthContextError as e:
        return lambda_utils.unauthorized(str(e))
    except Exception as e:
        print(f"Error listing ontology builds: {str(e)}")
        return lambda_utils.server_error(str(e))
