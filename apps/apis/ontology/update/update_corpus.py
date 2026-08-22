"""
Derive Ontology Lambda.

Derives a new ontology from an existing one, over either a changed set of documents
or the same one:

    POST /ontology/builds/{jobId}/corpus  -> add or remove documents
    POST /ontology/builds/{jobId}/redrive -> retry what a partial build lost

Both return 202 with the NEW build's jobId; the frontend polls get_build_status
exactly as it does for a fresh build.

One Lambda serves both because a redrive IS a corpus update that keeps every
document and adds none. carry_forward copies over the markdown and the elements that
do exist and hands whatever never converted back to CONVERT, and plan_extract fans
out only the pages with no element file, so deriving over the same corpus retries
exactly what was lost and re-earns nothing that was not. Splitting them would be two
routes into the same two hundred lines.

An update does not mutate the source ontology. It stays listed, openable and
unchanged, and the caller gets a second build alongside it. That is what makes
removing a document free: a document the user dropped is simply not carried over,
so nothing has to be deleted and nothing can be half-deleted.

The saving comes from the state machine's first stage. Documents the user kept have
their bronze object, their converted markdown and their extracted elements copied
into the new prefix by control/carry_forward.py, so CONVERT runs only over what was
added and PLAN_EXTRACT leaves the carried pages out of the fan-out. Extraction runs
on the caller's own Claude subscription and is the whole cost of a build, so this is
the difference between paying for the new documents and paying for the corpus again.

Two lists of documents are therefore in play and they are deliberately different.
The job row's docKeys is the whole new corpus, because SEGMENT reads it to resolve
each document back to the filename the user uploaded. The execution's docKeys is
only what has to be converted. Confusing the two either re-converts the whole corpus
or loses every carried document's title.

Tenancy is pinned the same way as everywhere else in this domain: the sub and email
come from the verified Cognito claim, the source build must be one the caller may
read, and every added key is checked to sit under the caller's own prefix.

"May read" is wider than "owns", because deriving is how a published ontology is
edited. The source is read under ITS owner's prefix and everything written lands
under the caller's, so the new version belongs to whoever built it and the original
is untouched. Two people editing the same shared ontology therefore produce two
versions rather than a conflict. Only a redrive stays owner-only: finishing a run
that stopped is not editing.
"""

import json
import os
import time
import uuid

import boto3
from aws_utils import auth_context, lambda_utils, s3_utils, secrets_utils

_dynamodb = boto3.resource("dynamodb")
_sfn = boto3.client("stepfunctions")

BRONZE_BUCKET_NAME = os.environ["BRONZE_BUCKET_NAME"]
SILVER_BUCKET_NAME = os.environ["SILVER_BUCKET_NAME"]
GOLD_BUCKET_NAME = os.environ["GOLD_BUCKET_NAME"]
JOB_TABLE = os.environ["JOB_TABLE"]
STATE_MACHINE_ARN = os.environ["STATE_MACHINE_ARN"]
CLAUDE_TOKENS_SECRET = os.environ["CLAUDE_TOKENS_SECRET"]

# Matches start_build: the ceiling is the execution input, not the pipeline.
MAX_DOCUMENTS = 500
MAX_NAME_CHARS = 200

# A redrive only makes sense for a build that stopped with work left undone. Spelled
# out here rather than imported: this Lambda ships as a single file, with no share of
# the agent's shared package.
REDRIVABLE_STATUSES = ("partial", "failed")

# The one value the visibility attribute ever takes; its absence is the private case.
VISIBILITY_PUBLISHED = "published"


def _validate_build_id(build_id):
    """A buildId is a plain uuid the browser minted, never a client-supplied path."""
    try:
        uuid.UUID(str(build_id))
    except (ValueError, AttributeError, TypeError):
        raise ValueError("buildId must be a valid build id")


def _validate_added(add_doc_keys, user_sub, build_id):
    """Every added document must be an object this caller uploaded under the new build."""
    if not isinstance(add_doc_keys, list):
        raise ValueError("addDocKeys must be an array")

    expected = s3_utils.user_prefix(user_sub, build_id)
    for key in add_doc_keys:
        if not isinstance(key, str) or ".." in key or not key.startswith(expected):
            raise ValueError("each added document must be one you uploaded for this update")


def _validate_kept(keep_doc_keys, source_item):
    """Every kept document must be one the source build actually holds.

    Checked against the row rather than against S3 so a key that was never part of
    this ontology cannot be smuggled in, even one the caller owns.
    """
    if not isinstance(keep_doc_keys, list):
        raise ValueError("keepDocKeys must be an array")

    source_keys = set(source_item.get("docKeys") or [])
    for key in keep_doc_keys:
        if key not in source_keys:
            raise ValueError("each kept document must be one already in this ontology")


def has_token(email: str) -> bool:
    """True when this user has saved a Claude token on the profile page."""
    tokens = secrets_utils.get_secret_json(CLAUDE_TOKENS_SECRET)
    return bool((tokens.get(email) or {}).get("token"))


def _copy_prior_schema(owner_sub: str, user_sub: str, source_job_id: str,
                       build_id: str) -> None:
    """Pin the source build's schema into the new run prefix so CONSOLIDATE extends it.

    Copied here rather than in carry_forward so an ontology that never emitted a
    schema is refused now, as a 400 the user can act on, instead of failing the
    build minutes later.

    Two subs, deliberately. The source is read under whoever built it, because a
    published ontology stays where it was written; the copy lands under the caller,
    because the derived build is theirs.
    """
    source_key = s3_utils.user_prefix(owner_sub, source_job_id) + "schema.json"
    if not s3_utils.is_file_exists(GOLD_BUCKET_NAME, source_key):
        raise ValueError(
            "This ontology has no schema to reuse yet. Build it again without reusing "
            "the schema."
        )

    schema = json.loads(s3_utils.get_s3_object_bytes(GOLD_BUCKET_NAME, source_key))
    schema["self_uri"] = f"s3://{GOLD_BUCKET_NAME}/{source_key}"
    s3_utils.put_json_object(
        GOLD_BUCKET_NAME,
        s3_utils.user_prefix(user_sub, build_id) + "input/prior_schema.json",
        schema,
    )


def _redrive_args(source_item: dict) -> dict:
    """The corpus update that a redrive is: keep everything, add nothing.

    The schema is reused only if the source actually emitted one. A build that
    stopped before EMIT never wrote schema.json, and insisting on it would refuse the
    builds that most need redriving.
    """
    source_key = (
        s3_utils.user_prefix(source_item["userId"], source_item["jobId"]) + "schema.json"
    )
    return {
        "keep_doc_keys": list(source_item.get("docKeys") or []),
        "extend_schema": s3_utils.is_file_exists(GOLD_BUCKET_NAME, source_key),
    }


def _carried_names(source_item: dict, keep_doc_keys: list) -> list:
    """The filenames of the kept documents, in the order they were kept.

    Bronze object names are opaque uuids, so the source row is the only place the
    names the user recognises exist. A key with no recorded name falls back to its
    own basename rather than being dropped.
    """
    source_keys = list(source_item.get("docKeys") or [])
    source_names = list(source_item.get("docNames") or [])
    by_key = {key: source_names[i] for i, key in enumerate(source_keys) if i < len(source_names)}
    return [by_key.get(key) or key.rsplit("/", 1)[-1] for key in keep_doc_keys]


def _added_names(add_doc_names, add_doc_keys) -> list:
    """Original filenames of the added documents, positionally matched to their keys."""
    names = add_doc_names if isinstance(add_doc_names, list) else []
    return [
        (str(names[i]).strip()[:MAX_NAME_CHARS] if i < len(names) and names[i] else
         key.rsplit("/", 1)[-1])
        for i, key in enumerate(add_doc_keys)
    ]


def _rebase(doc_keys: list, owner_sub: str, user_sub: str, source_job_id: str,
            build_id: str) -> list:
    """Point kept documents at the new build's prefix, where carry_forward copies them.

    The object names are preserved by that copy, which is what keeps each document's
    page ids identical to the source build's and so lets its extracted elements be
    reused rather than re-earned. The prefix flips from the source's owner to the
    caller, which is exactly what makes a build derived from someone else's published
    ontology self-contained rather than a pointer back into their prefix.
    """
    source_prefix = s3_utils.user_prefix(owner_sub, source_job_id)
    target_prefix = s3_utils.user_prefix(user_sub, build_id)
    return [target_prefix + key[len(source_prefix):] for key in doc_keys]


def _start_execution(job_id, user_sub, add_doc_keys, source_job_id, source_user_sub,
                     keep_doc_keys):
    """Start the convert state machine over the added documents only.

    carryFrom is what turns the machine's first state from a no-op into the copy that
    makes this an update rather than a rebuild. The kept keys are the SOURCE build's,
    because that is where carry_forward reads them from, and sourceUserSub is whose
    prefix that is: for a build derived from a published ontology it is not the
    caller's, and every other stage reads the caller's own row for its own layout.
    """
    _sfn.start_execution(
        stateMachineArn=STATE_MACHINE_ARN,
        name=job_id,
        input=json.dumps({
            "jobId": job_id,
            "docKeys": add_doc_keys,
            "inputBucket": BRONZE_BUCKET_NAME,
            "outputS3Prefix": f"s3://{SILVER_BUCKET_NAME}/{s3_utils.user_prefix(user_sub, job_id)}",
            "carryFrom": {
                "sourceJobId": source_job_id,
                "sourceUserSub": source_user_sub,
                "docKeys": keep_doc_keys,
            },
        }),
    )


def main(
    auth,
    source_job_id: str,
    build_id: str,
    add_doc_keys: list,
    add_doc_names: list = None,
    keep_doc_keys: list = None,
    title: str = "",
    extend_schema: bool = True,
    redrive: bool = False,
):
    """Create the derived job row and start the convert state machine.

    Returns None when the caller may not read the source build, which the handler
    turns into a 404 rather than a 403 so a jobId cannot be probed.
    """
    _validate_build_id(build_id)
    if str(build_id) == str(source_job_id):
        raise ValueError("an update must be a new build")

    source_item = _dynamodb.Table(JOB_TABLE).get_item(
        Key={"jobId": source_job_id}).get("Item")
    if not source_item:
        return None
    # Its owner, or anyone once it is published. Deriving is how a shared ontology is
    # edited: the new version belongs to whoever built it and the source is untouched,
    # so two people editing at once produce two versions rather than a conflict.
    owner_sub = source_item.get("userId") or ""
    if owner_sub != auth.user_id and source_item.get("visibility") != VISIBILITY_PUBLISHED:
        return None

    if redrive:
        # Completing a build means finishing the run that stopped, which is the
        # owner's to finish. Anyone else derives a new version through the corpus
        # route instead.
        if owner_sub != auth.user_id:
            return None
        if source_item.get("status") not in REDRIVABLE_STATUSES:
            raise ValueError("only an ontology that stopped short can be completed")
        args = _redrive_args(source_item)
        add_doc_keys = []
        add_doc_names = []
        keep_doc_keys = args["keep_doc_keys"]
        extend_schema = args["extend_schema"]

    add_doc_keys = list(add_doc_keys or [])
    keep_doc_keys = list(keep_doc_keys or [])
    _validate_added(add_doc_keys, auth.user_id, build_id)
    _validate_kept(keep_doc_keys, source_item)

    if not add_doc_keys and not keep_doc_keys:
        raise ValueError("an ontology needs at least one document")
    if len(add_doc_keys) + len(keep_doc_keys) > MAX_DOCUMENTS:
        raise ValueError(f"a build takes at most {MAX_DOCUMENTS} documents")

    if not has_token(auth.email):
        raise PermissionError(
            "Save your Claude subscription token on the profile page before starting a build."
        )

    job_id = str(build_id)
    now = int(time.time())

    if extend_schema:
        _copy_prior_schema(owner_sub, auth.user_id, source_job_id, job_id)

    # The whole new corpus, kept documents first and rebased onto this build's own
    # prefix. Not the same list the execution below is given.
    item = {
        "jobId": job_id,
        "userId": auth.user_id,
        "email": auth.email,
        "title": (title or "").strip()[:120] or source_item.get("title") or "Untitled ontology",
        "status": "processing",
        "stage": "CARRY_FORWARD",
        "progress": {"done": 0, "total": 0},
        # Only the added documents enter CONVERT. carry_forward widens this if a
        # carried document turns out never to have converted and has to be retried.
        "convertProgress": {"done": 0, "failed": 0, "total": len(add_doc_keys)},
        "docKeys": _rebase(keep_doc_keys, owner_sub, auth.user_id, source_job_id, job_id)
                   + add_doc_keys,
        "docNames": _carried_names(source_item, keep_doc_keys)
                    + _added_names(add_doc_names, add_doc_keys),
        "sourceJobId": source_job_id,
        "createdAt": now,
        "updatedAt": now,
    }
    if extend_schema:
        item["priorJobId"] = source_job_id
    if redrive:
        # Distinct from sourceJobId, which every derived build carries. This says the
        # corpus did not change, so the library can show a retry as a retry rather
        # than as a second ontology over the same documents.
        item["redriveOf"] = source_job_id
    if source_item.get("visibility") == VISIBILITY_PUBLISHED:
        # A new version of a shared ontology is shared too, so the people looking at
        # it see the version that was just built rather than the one it replaced. It
        # belongs to whoever derived it, who can unpublish it.
        item["visibility"] = VISIBILITY_PUBLISHED
        item["publishedAt"] = now
    _dynamodb.Table(JOB_TABLE).put_item(Item=item)

    try:
        _start_execution(job_id, auth.user_id, add_doc_keys, source_job_id, owner_sub,
                         keep_doc_keys)
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

        source_job_id = (event.get("pathParameters") or {}).get("jobId")
        if not source_job_id:
            return lambda_utils.bad_request("jobId is required")

        # The two routes share this Lambda, so the path is what says which one was
        # taken. A redrive takes no corpus from the request at all: reading one would
        # let a retry quietly change the documents it is retrying.
        redrive = str(event.get("resource") or "").endswith("/redrive")

        body = json.loads(event.get("body", "{}"))
        result = main(
            auth,
            source_job_id,
            body.get("buildId"),
            body.get("addDocKeys"),
            body.get("addDocNames"),
            body.get("keepDocKeys"),
            body.get("title", ""),
            bool(body.get("extendSchema", True)),
            redrive,
        )
        if result is None:
            return lambda_utils.not_found("Job not found")
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
        print(f"Error deriving ontology build: {str(e)}")
        return lambda_utils.server_error(str(e))
