"""
Start Ontology Build Lambda.

Validates the requested bronze documents, seeds a job row owned by the caller, and
starts the convert state machine. That machine converts every document to markdown
in silver and then hands the build to the agent runtime, so nothing here waits.
Returns 202 immediately; the frontend polls get_build_status until terminal.

The agent runs on the caller's own Claude subscription, so this refuses up front
when no token is saved rather than letting the build fail minutes later with a
cryptic reason. It also pins the tenancy: the sub and email come from the verified
Cognito claim, docKeys must sit under that user's own bronze prefix, and the
runtime derives every read and write path from the sub it is handed here — no part
of the layout is taken from the request.

If a priorJobId is supplied, that build's emitted schema.json is copied into
{runPrefix}input/prior_schema.json so CONSOLIDATE extends it instead of building a
fresh schema — keeping node_ids stable across rebuilds over the same domain. The
prior build is resolved under the caller's own prefix, so it can only ever be one
of their own.
"""

import json
import os
import time
import uuid

import boto3
from aws_utils import auth_context, lambda_utils, s3_utils, secrets_utils

from shared import artifacts

_dynamodb = boto3.resource("dynamodb")
_sfn = boto3.client("stepfunctions")

BRONZE_BUCKET_NAME = os.environ["BRONZE_BUCKET_NAME"]
SILVER_BUCKET_NAME = os.environ["SILVER_BUCKET_NAME"]
GOLD_BUCKET_NAME = os.environ["GOLD_BUCKET_NAME"]
JOB_TABLE = os.environ["JOB_TABLE"]
STATE_MACHINE_ARN = os.environ["STATE_MACHINE_ARN"]
CLAUDE_TOKENS_SECRET = os.environ["CLAUDE_TOKENS_SECRET"]

# The ceiling is the execution input, not the pipeline: every fan-out below is a
# Distributed Map. Five hundred bronze keys is about 50 KB, comfortably inside the
# 256 KiB Step Functions accepts. Going higher means handing the keys over as an S3
# pointer rather than as state.
MAX_DOCUMENTS = 500
MAX_NAME_CHARS = 200


def _validate_build_id(build_id):
    """A buildId is a plain uuid the browser minted — never a client-supplied path."""
    try:
        uuid.UUID(str(build_id))
    except (ValueError, AttributeError, TypeError):
        raise ValueError("buildId must be a valid build id")


def _validate(doc_keys, user_sub, build_id):
    """Every document must be an object this caller uploaded under this build's prefix."""
    if not isinstance(doc_keys, list) or not doc_keys:
        raise ValueError("docKeys must be a non-empty array")
    if len(doc_keys) > MAX_DOCUMENTS:
        raise ValueError(f"a build takes at most {MAX_DOCUMENTS} documents")

    expected = s3_utils.user_prefix(user_sub, build_id)
    for key in doc_keys:
        if not isinstance(key, str) or ".." in key or not key.startswith(expected):
            raise ValueError("each docKey must be a document you uploaded for this build")


def has_token(email: str) -> bool:
    """True when this user has saved a Claude token on the profile page."""
    tokens = secrets_utils.get_secret_json(CLAUDE_TOKENS_SECRET)
    return bool((tokens.get(email) or {}).get("token"))


def _run_prefix(user_sub: str, build_id: str) -> str:
    return f"s3://{GOLD_BUCKET_NAME}/{s3_utils.user_prefix(user_sub, build_id)}"


def _copy_prior_schema(prior_job_id, user_sub, run_prefix):
    """Pin a prior build's schema.json into the run prefix so CONSOLIDATE can extend it."""
    prior_uri = f"{_run_prefix(user_sub, prior_job_id)}schema.json"
    if not artifacts.exists(prior_uri):
        raise ValueError("prior schema not found for the supplied priorJobId")
    prior_schema = artifacts.read_json(prior_uri)
    prior_schema["self_uri"] = prior_uri
    artifacts.write_json(artifacts.resolve(run_prefix, "input/prior_schema.json"), prior_schema)


def _document_names(doc_names, doc_keys):
    """Original filenames, positionally matched to docKeys.

    Bronze object names are opaque uuids by design, so the names the user recognises
    exist only in the browser. They are recorded here so a failed conversion can be
    reported as "scan.pdf" rather than as a uuid.
    """
    names = doc_names if isinstance(doc_names, list) else []
    return [
        (str(names[i]).strip()[:MAX_NAME_CHARS] if i < len(names) and names[i] else
         key.rsplit("/", 1)[-1])
        for i, key in enumerate(doc_keys)
    ]


def _start_execution(job_id, user_sub, doc_keys):
    """Start the convert state machine, which hands the build on to the agent.

    The execution name is the job id, so a retried request cannot start a second
    conversion pass over the same build. Both lake paths are derived here from the
    verified sub — the state machine takes no bucket or prefix from the request.
    """
    _sfn.start_execution(
        stateMachineArn=STATE_MACHINE_ARN,
        name=job_id,
        input=json.dumps({
            "jobId": job_id,
            "docKeys": doc_keys,
            "inputBucket": BRONZE_BUCKET_NAME,
            "outputS3Prefix": f"s3://{SILVER_BUCKET_NAME}/{s3_utils.user_prefix(user_sub, job_id)}",
        }),
    )


def main(
    auth,
    build_id: str,
    doc_keys: list,
    doc_names: list = None,
    title: str = "",
    prior_job_id: str = None,
) -> dict:
    """Create the job row and start the convert state machine."""
    _validate_build_id(build_id)
    _validate(doc_keys, auth.user_id, build_id)
    if prior_job_id is not None:
        _validate_build_id(prior_job_id)

    if not has_token(auth.email):
        raise PermissionError(
            "Save your Claude subscription token on the profile page before starting a build."
        )

    # The browser minted the buildId and uploaded under it, so the build id and the
    # job id are one value — which is what makes the bronze prefix the caller wrote
    # to the same prefix the agent reads from.
    job_id = str(build_id)
    run_prefix = _run_prefix(auth.user_id, job_id)
    now = int(time.time())

    if prior_job_id:
        _copy_prior_schema(prior_job_id, auth.user_id, run_prefix)

    item = {
        "jobId": job_id,
        "userId": auth.user_id,
        "email": auth.email,
        "title": (title or "").strip()[:120] or "Untitled ontology",
        "status": "processing",
        "stage": "CONVERT",
        "progress": {"done": 0, "total": 0},
        # Seeded here because the Convert Map bumps it from inside its own branches
        # and a DynamoDB update cannot create the map it is writing into. Every
        # document enters the Map on an ordinary build, so the denominator is the
        # whole corpus.
        "convertProgress": {"done": 0, "failed": 0, "total": len(doc_keys)},
        "docKeys": doc_keys,
        "docNames": _document_names(doc_names, doc_keys),
        "createdAt": now,
        "updatedAt": now,
    }
    if prior_job_id:
        item["priorJobId"] = prior_job_id
    _dynamodb.Table(JOB_TABLE).put_item(Item=item)

    try:
        _start_execution(job_id, auth.user_id, doc_keys)
    except Exception:
        # Nothing is running, so leaving the row would show the user a build that
        # never advances. Drop it and let the error surface.
        _dynamodb.Table(JOB_TABLE).delete_item(Key={"jobId": job_id})
        raise

    return {"jobId": job_id}


def lambda_handler(event, context):
    options_response = lambda_utils.handle_options(event)
    if options_response:
        return options_response

    try:
        auth = auth_context.get_auth_context(event)
        if not auth.email:
            return lambda_utils.bad_request("No email claim on the signed-in user.")

        body = json.loads(event.get("body", "{}"))
        result = main(
            auth,
            body.get("buildId"),
            body.get("docKeys"),
            body.get("docNames"),
            body.get("title", ""),
            body.get("priorJobId"),
        )
        return lambda_utils.success_response(result, status_code=202)

    except ValueError as e:
        return lambda_utils.bad_request(str(e))
    except PermissionError as e:
        return lambda_utils.bad_request(str(e))
    except json.JSONDecodeError as e:
        return lambda_utils.bad_request(f"Invalid JSON in request body: {str(e)}")
    except auth_context.AuthContextError as e:
        return lambda_utils.unauthorized(str(e))
    except Exception as e:
        print(f"Error starting ontology build: {str(e)}")
        return lambda_utils.server_error(str(e))
