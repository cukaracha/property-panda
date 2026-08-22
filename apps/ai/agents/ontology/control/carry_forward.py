"""
Carry Forward Ontology Artifacts Lambda.

The first state of the convert state machine, and a no-op for an ordinary build.
Invoked only by Step Functions.

A corpus update does not mutate an ontology, it derives a new one over a changed
document set. This is the stage that makes that cheap: for every document the user
kept, it copies the source build's bronze object, its converted silver markdown,
and its extracted elements into the new build's prefixes. CONVERT then runs only
over the documents that were actually added, and PLAN_EXTRACT sees the carried
elements already present and leaves those pages out of the fan-out. Extraction is
the whole cost of a build, so what survives this copy is what the user does not pay
for twice.

Every copy is server side, so no document body passes through this function, and
the bronze object's name is preserved. That last part is load bearing: `doc_id` is
the bronze basename, page ids are numbered within their own document behind
`segmentation.doc_slug(doc_id)`, and so a carried document re-segments to exactly
the page ids it had before. Rename the object and every carried element file would
point at pages that no longer exist.

Elements are re-keyed rather than copied straight across, because a source build
made before page ids became document-scoped numbers its pages `p00001` across the
whole corpus. The source manifest says which document each of its pages came from
and in what order, which is all that is needed to compute what that page will be
called this time. When the source already uses document-scoped ids the mapping is
the identity and the re-key costs nothing, so one path serves both.

Identity is read from the job row rather than carried through the execution input,
for the same reason every other stage does it: the sub is the one the start Lambda
wrote from a verified Cognito claim. The one exception is the SOURCE build's sub,
which arrives on carryFrom, because a new version of a published ontology is derived
from a build somebody else owns. That value is not a permission: the update Lambda
has already decided the caller may read the source, and this stage only copies out of
the prefix that decision named and into the caller's own.
"""

import os
import time

import boto3
from aws_utils import s3_utils

from shared import artifacts, segmentation

_dynamodb = boto3.resource("dynamodb")

JOB_TABLE = os.environ["JOB_TABLE"]
BRONZE_BUCKET_NAME = os.environ["BRONZE_BUCKET_NAME"]
SILVER_BUCKET_NAME = os.environ["SILVER_BUCKET_NAME"]
GOLD_BUCKET_NAME = os.environ["GOLD_BUCKET_NAME"]


def _doc_id(bronze_key: str) -> str:
    """The converter-derived document key for a bronze object.

    The converter names its markdown after the bronze object's base name, and
    segmentation derives `doc_id` from that name, so this is the same join key both
    of them use.
    """
    return bronze_key.rsplit("/", 1)[-1].rsplit(".", 1)[0]


def _copy_documents(source_user_sub: str, user_sub: str, source_job_id: str,
                    job_id: str, doc_keys: list) -> dict:
    """Copy each carried document's bronze object and converted markdown.

    Bronze keeps the derived build self-contained: deleting the source ontology
    purges its whole prefix, and a build that pointed back into it would lose its
    own sources. Silver is what lets CONVERT skip these documents entirely.

    A document the source build never managed to convert has no markdown to copy,
    so its new bronze key is returned as unconverted and handed to CONVERT instead.
    Dropping it silently would give the derived build a smaller corpus than the user
    chose while still reporting success.
    """
    source_prefix = s3_utils.user_prefix(source_user_sub, source_job_id)
    target_prefix = s3_utils.user_prefix(user_sub, job_id)

    bronze_pairs = []
    target_key_by_doc = {}
    for key in doc_keys:
        name = key.rsplit("/", 1)[-1]
        bronze_pairs.append((source_prefix + name, target_prefix + name))
        target_key_by_doc[_doc_id(key)] = target_prefix + name

    s3_utils.copy_s3_objects(BRONZE_BUCKET_NAME, BRONZE_BUCKET_NAME, bronze_pairs)

    # Listed rather than derived: one document becomes one markdown file, or a
    # hundred paged ones, or a transcript, and only the converter knows which.
    silver_pairs = []
    converted = set()
    for key in s3_utils.list_s3_files(SILVER_BUCKET_NAME, source_prefix, ".md"):
        doc_id = segmentation.doc_name(key)
        if doc_id not in target_key_by_doc:
            continue
        converted.add(doc_id)
        silver_pairs.append((key, target_prefix + key.rsplit("/", 1)[-1]))

    s3_utils.copy_s3_objects(SILVER_BUCKET_NAME, SILVER_BUCKET_NAME, silver_pairs)

    return {
        "documents": len(bronze_pairs),
        "markdown": len(silver_pairs),
        "converted": converted,
        "unconverted": [
            target_key for doc_id, target_key in target_key_by_doc.items()
            if doc_id not in converted
        ],
    }


def _page_id_map(source_run_prefix: str, doc_ids) -> dict:
    """{sourcePageId: targetPageId} for every carried document's pages.

    The manifest is written in document order with each document's pages
    contiguous, so the position of a page within its own document is its number
    this time round. That is exactly what `segmentation.segment` will assign when
    it re-cuts the same markdown, which is what makes the carried elements line up.
    """
    manifest = artifacts.read_json(artifacts.resolve(source_run_prefix, "pages/manifest.json"))

    mapping = {}
    counters = {}
    for entry in manifest:
        doc_id = entry.get("doc")
        if doc_id not in doc_ids:
            continue
        counters[doc_id] = counters.get(doc_id, 0) + 1
        mapping[entry["pageId"]] = f"{segmentation.doc_slug(doc_id)}p{counters[doc_id]:04d}"
    return mapping


def _copy_elements(source_run_prefix: str, run_prefix: str, page_ids: dict) -> int:
    """Re-key and copy every carried page's extracted elements.

    Read and rewritten rather than server-side copied, because the page id is not
    only the object's name: it is the record's own `page_id` and the prefix of every
    `chunk_id` evidence anchor inside it. Substituting the id as a token covers all
    of them, and page ids are unique strings that appear nowhere else in the record.

    A page with no element file is skipped. It was never extracted in the source
    build, so PLAN_EXTRACT will pick it up as pending, which is the right answer.
    """
    recorded = {
        uri.rsplit("/", 1)[-1][: -len(".json")]
        for uri in artifacts.list_keys(artifacts.resolve(source_run_prefix, "elements/"))
        if uri.endswith(".json")
    }

    copied = 0
    for source_page_id, target_page_id in page_ids.items():
        if source_page_id not in recorded:
            continue
        body = artifacts.read_text(
            artifacts.resolve(source_run_prefix, f"elements/{source_page_id}.json"))
        if source_page_id != target_page_id:
            body = body.replace(source_page_id, target_page_id)
        artifacts.write_text(
            artifacts.resolve(run_prefix, f"elements/{target_page_id}.json"),
            body,
            "application/json",
        )
        copied += 1

    return copied


def _set_stage(job_id: str, retried: int) -> None:
    """Advance to CONVERT, widening its denominator by the documents handed back to it.

    The update Lambda seeded the conversion counter with the added documents only,
    because that is all it knew would be converted. A carried document with no
    markdown is appended to the Map's input below, so it enters CONVERT too and will
    bump the counter the state machine keeps. Counting it here is what stops the
    stepper reading past its own total.
    """
    _dynamodb.Table(JOB_TABLE).update_item(
        Key={"jobId": job_id},
        UpdateExpression=(
            "SET stage = :stage, updatedAt = :now, "
            "convertProgress.#total = if_not_exists(convertProgress.#total, :zero) + :retried"
        ),
        ExpressionAttributeNames={"#total": "total"},
        ExpressionAttributeValues={
            ":stage": "CONVERT",
            ":now": int(time.time()),
            ":zero": 0,
            ":retried": int(retried),
        },
    )


def main(event: dict) -> dict:
    """Carry a source build's reusable artifacts over, then hand the input on."""
    carry_from = event.get("carryFrom") or {}
    source_job_id = carry_from.get("sourceJobId")
    doc_keys = list(carry_from.get("docKeys") or [])

    # An ordinary build has nothing to carry, and must reach Convert with its input
    # exactly as the start Lambda wrote it.
    if not source_job_id or not doc_keys:
        return event

    job_id = event.get("jobId")
    if not job_id:
        raise ValueError("jobId is required")

    item = _dynamodb.Table(JOB_TABLE).get_item(Key={"jobId": job_id}).get("Item")
    if not item:
        raise ValueError(f"no ontology job row for {job_id}")

    user_sub = item["userId"]
    # Whose prefix the source build's artifacts sit under. The same sub for an
    # ordinary update, and the publisher's when this build is a new version of an
    # ontology someone else shared: publishing moves nothing, so a shared build is
    # read where it was written. Defaulted to this build's own owner so an execution
    # started before this field existed still carries forward correctly.
    source_user_sub = carry_from.get("sourceUserSub") or user_sub

    source_gold = s3_utils.user_prefix(source_user_sub, source_job_id)
    source_run_prefix = f"s3://{GOLD_BUCKET_NAME}/{source_gold}"
    run_prefix = f"s3://{GOLD_BUCKET_NAME}/{s3_utils.user_prefix(user_sub, job_id)}"

    copied = _copy_documents(source_user_sub, user_sub, source_job_id, job_id, doc_keys)
    page_ids = _page_id_map(source_run_prefix, copied["converted"])
    elements = _copy_elements(source_run_prefix, run_prefix, page_ids)

    print(
        f"{job_id}: carried {copied['documents']} document(s), "
        f"{copied['markdown']} markdown file(s) and {elements} extracted page(s) "
        f"from {source_job_id}"
    )
    _set_stage(job_id, len(copied["unconverted"]))

    # Convert runs over whatever is left here, so a carried document that never
    # converted gets another attempt alongside the newly uploaded ones.
    event["docKeys"] = list(event.get("docKeys") or []) + copied["unconverted"]
    return event


def lambda_handler(event, context):
    job_id = event.get("jobId")
    try:
        return main(event)
    except Exception as error:
        # Raised so the state machine's Catch reaches fail_build, which is the one
        # place that decides what a stopped build says to the user. A build whose
        # sources never arrived must not go on to report an empty corpus as success.
        print(f"Error carrying forward into ontology build {job_id}: {str(error)}")
        raise
