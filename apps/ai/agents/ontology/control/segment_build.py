"""
Segment Ontology Build Lambda.

The fan-in between the convert state machine and everything that reads pages.
Invoked only by Step Functions, once every document in the build has reached a
terminal conversion state, with the per-document results of the Convert Map.

It turns those results into the two things the rest of the build needs — the
markdown that exists, and the documents that will never exist — and then segments
the markdown into pages and chunks under the build's gold prefix. Segmentation runs
here rather than as an agent role because it is wholly deterministic, and because
both branches that follow depend on it: the agent extracts from pages, and the page
index hydrates from the same pages.

The converted markdown is discovered by listing the build's own silver prefix rather
than read out of the Map's results. A hundred-page document converts to a hundred
output keys, so carrying them back through the execution would put megabytes into a
state payload capped at 256 KiB. The Map therefore returns only each document's
outcome, and the failures are the only part of it that is read here.

If not a single document converted there is nothing to build an ontology from, so
the job is failed here and an empty result is returned. The branches downstream see
no markdown and no pages and do nothing, which keeps the failure on the job row
rather than in a failed execution.

Identity is read from the job row rather than carried through the execution input:
the sub every read and write path derives from is the one the start Lambda wrote
from a verified Cognito claim.
"""

import os
import time

import boto3

from shared import artifacts, models, segmentation

_dynamodb = boto3.resource("dynamodb")

JOB_TABLE = os.environ["JOB_TABLE"]
GOLD_BUCKET_NAME = os.environ["GOLD_BUCKET_NAME"]


def _failed_keys(convert_results: list) -> list:
    """The bronze keys of the documents that reached a terminal failure."""
    return [
        result.get("docKey")
        for result in convert_results or []
        if isinstance(result, dict)
        and result.get("status") != "succeeded"
        and result.get("docKey")
    ]


def _convert_tally(item: dict, convert_results: list, failed_keys: list) -> dict:
    """What the Convert Map did, now that every document has reached a terminal state.

    `attempted` is the documents that actually entered the Map. For a derived build
    that is only what was added, plus any carried document that had never converted,
    because everything else arrived with its markdown already copied. Reporting
    `attempted` as the corpus would therefore show a twenty document ontology as
    having converted two, so the documents that never needed converting are counted
    separately as `carried`.
    """
    total = len(item.get("docKeys") or [])
    attempted = len([result for result in convert_results or [] if isinstance(result, dict)])
    return {
        "total": total,
        "attempted": attempted,
        "succeeded": attempted - len(failed_keys),
        "failed": len(failed_keys),
        "carried": max(total - attempted, 0),
    }


def _markdown_keys(output_prefix: str) -> list:
    """Every markdown object the converter wrote for this build, in key order.

    The prefix is this build's own silver prefix, derived by the start Lambda from a
    verified Cognito claim, so listing it can only ever surface this build's output.
    """
    if not output_prefix:
        raise ValueError("outputS3Prefix is required")
    return sorted(uri for uri in artifacts.list_keys(output_prefix) if uri.endswith(".md"))


def _document_names(item: dict, doc_keys: list) -> list:
    """Resolve bronze keys back to the filenames the user recognises.

    Bronze object names are opaque uuids by design, so the original filenames are
    carried on the job row, positionally matched to docKeys. A key with no recorded
    name falls back to its own basename rather than being dropped.
    """
    all_keys = list(item.get("docKeys", []))
    names = list(item.get("docNames", []))
    by_key = {key: names[i] for i, key in enumerate(all_keys) if i < len(names)}
    return [by_key.get(key) or key.rsplit("/", 1)[-1] for key in doc_keys]


def _doc_titles(item: dict) -> dict:
    """Map each converter-derived document key to the filename that was uploaded.

    The converter names its markdown after the bronze object, which is a uuid, so
    without this every citation would show the user an id they have never seen. The
    join is on the bronze key's base name, which is exactly what the converter's
    output key is built from.
    """
    keys = list(item.get("docKeys", []))
    names = list(item.get("docNames", []))
    titles = {}
    for i, key in enumerate(keys):
        base = key.rsplit("/", 1)[-1].rsplit(".", 1)[0]
        if base and i < len(names) and names[i]:
            titles[base] = names[i]
    return titles


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


def _record_converted(job_id: str, failed_docs: list, failed_keys: list, convert: dict) -> None:
    """Record what conversion produced, before anything downstream can stop the build.

    `failedDocs` is written to the row because the row is the only place the stage
    that marks the build terminal can read it from. It used to travel in the agent's
    invocation payload, which no longer reaches the state that decides between
    `succeeded` and `partial`.

    `failedDocKeys` is the same set named the way the review gate has to act on it. The
    Convert Map appends to it live so a long conversion can say what it is losing while
    it runs, but concurrent branches lose appends the same way they lose counter
    increments, so that list is a preview. This overwrites it with the set the fan-in
    actually observed.

    `convert` is the tally the build report reads. All three are written here rather
    than alongside the segmentation result so that a build where nothing converted,
    which is failed a few lines below and never reaches segmentation, can still say
    which documents were lost.
    """
    _dynamodb.Table(JOB_TABLE).update_item(
        Key={"jobId": job_id},
        UpdateExpression=(
            "SET failedDocs = :failedDocs, failedDocKeys = :failedDocKeys, "
            "#convert = :convert, updatedAt = :now"
        ),
        ExpressionAttributeNames={"#convert": "convert"},
        ExpressionAttributeValues={
            ":failedDocs": list(failed_docs),
            ":failedDocKeys": list(failed_keys),
            ":convert": {key: int(value) for key, value in convert.items()},
            ":now": int(time.time()),
        },
    )


def _record_segmented(job_id: str, total_pages: int) -> None:
    """Advance the stage, set the extraction denominator, and open the index.

    `indexStatus` is a second, independent completion signal: the graph and the page
    index finish at different times and either can fail without the other, so the
    frontend has to be able to tell "the ontology is built" from "it is searchable".
    """
    _dynamodb.Table(JOB_TABLE).update_item(
        Key={"jobId": job_id},
        UpdateExpression=(
            "SET stage = :stage, progress = :progress, "
            "indexStatus = :indexStatus, updatedAt = :now"
        ),
        ExpressionAttributeValues={
            ":stage": "SEGMENT",
            ":progress": {"done": 0, "total": int(total_pages)},
            ":indexStatus": models.INDEX_PENDING,
            ":now": int(time.time()),
        },
    )


def main(job_id: str, output_prefix: str, convert_results: list) -> dict:
    """Segment the converted build, or fail it if nothing converted."""
    item = _dynamodb.Table(JOB_TABLE).get_item(Key={"jobId": job_id}).get("Item")
    if not item:
        raise ValueError(f"no ontology job row for {job_id}")

    markdown_keys = _markdown_keys(output_prefix)
    failed_keys = _failed_keys(convert_results)
    failed_docs = _document_names(item, failed_keys)
    _record_converted(
        job_id, failed_docs, failed_keys, _convert_tally(item, convert_results, failed_keys)
    )

    # Step Functions cannot split an s3:// URI, so the manifest's location is returned
    # as a bucket and a key for the ItemReader that fans extraction out.
    manifest_key = f"users/{item['userId']}/{job_id}/pages/manifest.json"

    # Deliberately five small fields. Everything else a later stage needs is on the
    # job row or under the run prefix, and a corpus of ten thousand pages would put
    # megabytes of keys into a state payload capped at 256 KiB.
    #
    # `failedCount` is what opens the review gate, and it is paired with `pages` there:
    # a build where nothing converted is already failed below and returns this empty
    # result, so pausing on the failure count alone would strand a dead build waiting
    # for an answer that could not help it.
    empty = {
        "jobId": job_id,
        "manifestBucket": GOLD_BUCKET_NAME,
        "manifestKey": manifest_key,
        "pages": 0,
        "failedCount": len(failed_keys),
    }

    if not markdown_keys:
        _fail(
            job_id,
            "None of the uploaded documents could be converted to markdown, so there "
            "was nothing to build an ontology from.",
        )
        return empty

    run_prefix = f"s3://{GOLD_BUCKET_NAME}/users/{item['userId']}/{job_id}/"
    manifest = segmentation.segment(run_prefix, markdown_keys, _doc_titles(item))
    if not manifest:
        _fail(
            job_id,
            "Every document converted, but none of them held any readable text, so "
            "there was nothing to build an ontology from.",
        )
        return empty

    _record_segmented(job_id, len(manifest))

    return {
        "jobId": job_id,
        "manifestBucket": GOLD_BUCKET_NAME,
        "manifestKey": manifest_key,
        "pages": len(manifest),
        "failedCount": len(failed_keys),
    }


def lambda_handler(event, context):
    job_id = event.get("jobId")
    try:
        return main(job_id, event.get("outputS3Prefix"), event.get("convertResults"))
    except Exception as error:
        # The agent's own backstop never gets to run if the agent is never invoked,
        # so this is the last chance to stop the row sitting on `processing` forever.
        # The error is re-raised so the execution fails too.
        print(f"Error segmenting ontology build {job_id}: {str(error)}")
        if job_id:
            try:
                _fail(job_id, f"The converted documents could not be segmented: {str(error)}")
            except Exception as fail_error:
                print(f"Could not mark {job_id} failed: {str(fail_error)}")
        raise
