"""
Review Ontology Conversion Lambda.

Answers the one gate in the build pipeline:

    POST /ontology/builds/{jobId}/review  {"action": "continue" | "stop" | "retry", ...}

A build that lost documents to conversion stops after Segment and waits, holding a Step
Functions task token on its job row. This is what sends that token back, so the whole
job here is to turn one of three answers into a resumed execution:

    continue -> build the ontology from what converted, which is what the pipeline
                used to do on its own
    stop     -> end the build now, before the hours that extraction costs
    retry    -> convert a set of documents again, optionally with replacements
                uploaded in place of the ones that would not convert

Only `retry` changes anything. It rewrites `docKeys` and `docNames` to the corpus the
user chose and records the set to convert again, because the state machine reads both
off the row rather than out of the request: the token carries the decision, not the data.

Every failed document has to be accounted for on a retry, as either retried or dropped.
Leaving one in the corpus but out of the retry means it never enters the Convert Map
again, so the fan-in never sees it fail and the finished ontology reports a document it
does not have. Refusing a partial answer is what keeps the failure record honest.

The round ceiling is enforced here rather than in the state machine on purpose. A refusal
here leaves the gate open and the token unspent, so a user who has exhausted their
retries can still continue or stop; failing the retry inside the execution would take
those choices away along with it.

Reviewing is the owner's alone, and a build the caller does not own is reported as 404
rather than 403, matching every other route in this domain so a jobId cannot be probed
for existence. Publishing does not widen this: a shared ontology can be read and built
on, but only whoever started a run can steer it.
"""

import json
import os
import time

import boto3
from aws_utils import auth_context, lambda_utils, s3_utils

_dynamodb = boto3.resource("dynamodb")
_sfn = boto3.client("stepfunctions")

JOB_TABLE = os.environ["JOB_TABLE"]

STATUS_AWAITING_REVIEW = "awaitingReview"

ACTIONS = ("continue", "stop", "retry")

# Matches start_build: the ceiling is the execution input, not the pipeline.
MAX_DOCUMENTS = 500
MAX_NAME_CHARS = 200

# How many times one build may be sent back through conversion. A retry is driven by a
# person, so this is not a throttle; it is a backstop against a build that converts,
# fails, and is retried in a loop until the execution's own budget runs out.
MAX_REVIEW_ROUNDS = 5

STOP_REASON = (
    "The build was stopped at the conversion review. The documents that did convert "
    "were kept, so completing this build retries only what is missing."
)


def _clean_names(doc_names, doc_keys) -> list:
    """Original filenames, positionally matched to docKeys, as start_build records them."""
    names = doc_names if isinstance(doc_names, list) else []
    return [
        (str(names[i]).strip()[:MAX_NAME_CHARS] if i < len(names) and names[i]
         else key.rsplit("/", 1)[-1])
        for i, key in enumerate(doc_keys)
    ]


def _validate_replacements(add_doc_keys: list, owner_sub: str, job_id: str) -> None:
    """Every replacement must be an object the owner uploaded under this build's prefix."""
    expected = s3_utils.user_prefix(owner_sub, job_id)
    for key in add_doc_keys:
        if not isinstance(key, str) or ".." in key or not key.startswith(expected):
            raise ValueError("each replacement must be a document you uploaded for this build")


def _retry_set(item: dict, retry_doc_keys: list, drop_doc_keys: list, add_doc_keys: list) -> dict:
    """The corpus and the conversion set a retry leaves behind.

    The failed documents must partition exactly into retried and dropped. A replacement
    is both at once from this side: the document it stands in for is dropped and the new
    upload joins the set to convert.
    """
    failed = list(item.get("failedDocKeys") or [])
    if not failed:
        raise ValueError("this build has no failed documents to retry")

    retried, dropped = set(retry_doc_keys), set(drop_doc_keys)
    if retried & dropped:
        raise ValueError("a document cannot be both retried and dropped")
    unknown = (retried | dropped) - set(failed)
    if unknown:
        raise ValueError("only the documents that failed to convert can be retried or dropped")
    unanswered = set(failed) - retried - dropped
    if unanswered:
        raise ValueError(
            "every document that failed to convert has to be retried or dropped, "
            f"and {len(unanswered)} still {'has' if len(unanswered) == 1 else 'have'} neither"
        )

    convert_again = list(retry_doc_keys) + list(add_doc_keys)
    if not convert_again:
        raise ValueError("a retry needs at least one document to convert again")

    doc_keys = list(item.get("docKeys") or [])
    doc_names = list(item.get("docNames") or [])
    kept = [(key, doc_names[i] if i < len(doc_names) else "") for i, key in enumerate(doc_keys)
            if key not in dropped]
    if len(kept) + len(add_doc_keys) > MAX_DOCUMENTS:
        raise ValueError(f"a build takes at most {MAX_DOCUMENTS} documents")

    return {
        "docKeys": [key for key, _ in kept] + list(add_doc_keys),
        "docNames": [name for _, name in kept],
        "convertAgain": convert_again,
    }


def _record_retry(job_id: str, corpus: dict, add_doc_names: list, add_doc_keys: list) -> None:
    """Write the chosen corpus and the set to convert, before the token is spent.

    In this order because prepare_retry reads reviewRetryKeys the moment the execution
    resumes. A token sent against a row that has not been written yet would restart
    conversion over whatever the previous round left behind.
    """
    doc_names = corpus["docNames"] + _clean_names(add_doc_names, add_doc_keys)
    _dynamodb.Table(JOB_TABLE).update_item(
        Key={"jobId": job_id},
        UpdateExpression=(
            "SET docKeys = :docKeys, docNames = :docNames, "
            "reviewRetryKeys = :retry, updatedAt = :now"
        ),
        ExpressionAttributeValues={
            ":docKeys": corpus["docKeys"],
            ":docNames": doc_names,
            ":retry": corpus["convertAgain"],
            ":now": int(time.time()),
        },
    )


def _close_review(job_id: str) -> None:
    """Drop the spent token, so the gate cannot be answered twice."""
    _dynamodb.Table(JOB_TABLE).update_item(
        Key={"jobId": job_id},
        UpdateExpression="SET updatedAt = :now REMOVE reviewToken",
        ExpressionAttributeValues={":now": int(time.time())},
    )


def main(job_id: str, user_sub: str, body: dict):
    """Resume the paused build, or None if it is not the caller's."""
    item = _dynamodb.Table(JOB_TABLE).get_item(Key={"jobId": job_id}).get("Item")
    if not item or item.get("userId") != user_sub:
        return None

    action = str(body.get("action") or "").strip()
    if action not in ACTIONS:
        raise ValueError(f"action must be one of {', '.join(ACTIONS)}")

    token = item.get("reviewToken")
    if item.get("status") != STATUS_AWAITING_REVIEW or not token:
        raise LookupError("this build is not waiting for a conversion review")

    doc_keys = list(item.get("docKeys") or [])
    if action == "retry":
        rounds = int(item.get("reviewRounds") or 0)
        if rounds >= MAX_REVIEW_ROUNDS:
            raise ValueError(
                f"this build has already retried conversion {MAX_REVIEW_ROUNDS} times, "
                "so it can only be built without the failed documents or stopped"
            )
        add_doc_keys = list(body.get("addDocKeys") or [])
        _validate_replacements(add_doc_keys, item["userId"], job_id)
        corpus = _retry_set(
            item,
            list(body.get("retryDocKeys") or []),
            list(body.get("dropDocKeys") or []),
            add_doc_keys,
        )
        _record_retry(job_id, corpus, body.get("addDocNames"), add_doc_keys)
        doc_keys = corpus["docKeys"]

    if action == "stop":
        _sfn.send_task_failure(taskToken=token, error="StoppedByReviewer", cause=STOP_REASON)
    else:
        _sfn.send_task_success(taskToken=token, output=json.dumps({"action": action}))

    # After the send, so a token that could not be delivered is still on the row for the
    # user to answer again rather than stranding the execution.
    _close_review(job_id)

    return {"jobId": job_id, "action": action, "docCount": len(doc_keys)}


def lambda_handler(event, context):
    options_response = lambda_utils.handle_options(event)
    if options_response:
        return options_response

    try:
        auth = auth_context.get_auth_context(event)

        job_id = (event.get("pathParameters") or {}).get("jobId")
        if not job_id:
            return lambda_utils.bad_request("jobId is required")

        result = main(job_id, auth.user_id, json.loads(event.get("body") or "{}"))
        if result is None:
            return lambda_utils.not_found("Job not found")
        return lambda_utils.success_response(result)

    except LookupError as e:
        return lambda_utils.error_response(409, str(e), "Conflict")
    except (
        _sfn.exceptions.TaskDoesNotExist,
        _sfn.exceptions.TaskTimedOut,
        _sfn.exceptions.InvalidToken,
    ):
        # The gate was already answered, or it waited out its day. Either way the row is
        # about to say so, and this is not the caller's mistake to be told off for.
        return lambda_utils.error_response(
            409, "This build is no longer waiting for a conversion review", "Conflict"
        )
    except ValueError as e:
        return lambda_utils.bad_request(str(e))
    except json.JSONDecodeError as e:
        return lambda_utils.bad_request(f"Invalid JSON in request body: {str(e)}")
    except auth_context.AuthContextError as e:
        return lambda_utils.unauthorized(str(e))
    except Exception as e:
        print(f"Error reviewing ontology build conversion: {str(e)}")
        return lambda_utils.server_error(str(e))
