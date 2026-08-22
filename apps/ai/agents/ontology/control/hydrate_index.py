"""
Hydrate Ontology Page Index Lambda.

Embeds the build's pages into the shared S3 Vectors index so a finished ontology can
be searched. Invoked only by Step Functions, on the branch that runs concurrently
with the agent: the graph and the index are built from the same pages but neither
waits on the other.

The windows written here are NOT the extraction chunks. Extraction chunks tile their
page with no overlap so an evidence anchor's char offset resolves to exactly one
chunk. Retrieval wants the opposite: overlapping windows, so a fact that straddles a
boundary is whole in at least one of them. Both are cut from the same page text and
their ids never collide (`…c000` for extraction, `…r000` for retrieval).

Three modes, all driven by the state machine. `hydrate` writes one batch of pages,
`finalize` marks the index ready once every batch has landed, and `fail` records that
it did not. A hydration failure never fails the build: the graph is independently
valid and the ontology is still worth reading, it just cannot be searched yet.

A batch's windows are embedded in one call rather than one call per page. Titan
embeds a single input per request, so the layer fans the list across a thread pool:
handing it one page at a time left most of that pool idle for the whole batch.
"""

import os
import time

import boto3
from aws_utils import bedrock_utils

from shared import artifacts, chunking, models

_dynamodb = boto3.resource("dynamodb")
_s3vectors = boto3.client("s3vectors")

JOB_TABLE = os.environ["JOB_TABLE"]
GOLD_BUCKET_NAME = os.environ["GOLD_BUCKET_NAME"]
VECTOR_BUCKET = os.environ["VECTOR_BUCKET"]
VECTOR_INDEX = os.environ["VECTOR_INDEX"]

# Bedrock's FIXED_SIZE default, expressed in the characters this pipeline measures
# in: 300 tokens at 4 chars per token, overlapping by 20%.
WINDOW_TOKENS = 300
OVERLAP_RATIO = 0.2
WINDOW_CHARS = WINDOW_TOKENS * chunking.CHARS_PER_TOKEN
OVERLAP_CHARS = int(WINDOW_CHARS * OVERLAP_RATIO)

# S3 Vectors accepts up to 500 vectors per PutVectors call.
PUT_BATCH = 200


def window_page(text: str):
    """Cut a page into overlapping retrieval windows: [{text, char_start, char_end}].

    Each window ends on a paragraph, line, or sentence boundary where one is
    available, then the next window starts OVERLAP_CHARS before that end. Stepping
    back from the boundary rather than forward by a fixed stride is what guarantees
    coverage: a window that snapped short cannot leave a gap behind it.
    """
    text = text or ""
    if not text.strip():
        return []
    windows, start, length = [], 0, len(text)
    while start < length:
        end = min(start + WINDOW_CHARS, length)
        if end < length:
            end = chunking._boundary(text, end, start + WINDOW_CHARS // 2)
        piece = text[start:end]
        if piece.strip():
            windows.append({"text": piece, "char_start": start, "char_end": end})
        if end >= length:
            break
        start = max(start + 1, end - OVERLAP_CHARS)
    return windows


def _run_prefix(user_sub: str, job_id: str) -> str:
    return f"s3://{GOLD_BUCKET_NAME}/users/{user_sub}/{job_id}/"


def _read_page(run_prefix: str, page_id: str):
    return artifacts.read_json(artifacts.resolve(run_prefix, f"pages/{page_id}.json"))


def _vectors_for_batch(job_id: str, user_sub: str, pages: list) -> list:
    """Window every page in the batch, embed the lot in one call, shape for PutVectors."""
    windowed = [(page, window_page(page.get("text", ""))) for page in pages]
    texts = [window["text"] for _page, windows in windowed for window in windows]
    if not texts:
        return []

    embeddings = iter(bedrock_utils.embed_texts(texts))
    vectors = []
    for page, windows in windowed:
        page_id = page["page_id"]
        for idx, window in enumerate(windows):
            vectors.append(
                {
                    # The index is shared by every build, so the build id is part of
                    # the key as well as the filter — two builds over the same corpus
                    # produce the same page ids.
                    "key": f"{job_id}#{page_id}r{idx:03d}",
                    "data": {"float32": next(embeddings)},
                    "metadata": {
                        "buildId": job_id,
                        "userSub": user_sub,
                        "pageId": page_id,
                        "docId": page.get("doc_id", ""),
                        "docTitle": page.get("doc_title", ""),
                        "text": window["text"],
                    },
                }
            )
    return vectors


def _put(vectors: list) -> None:
    for start in range(0, len(vectors), PUT_BATCH):
        _s3vectors.put_vectors(
            vectorBucketName=VECTOR_BUCKET,
            indexName=VECTOR_INDEX,
            vectors=vectors[start:start + PUT_BATCH],
        )


def _set_index_status(job_id: str, index_status: str) -> None:
    _dynamodb.Table(JOB_TABLE).update_item(
        Key={"jobId": job_id},
        UpdateExpression="SET indexStatus = :i, updatedAt = :now",
        ExpressionAttributeValues={":i": index_status, ":now": int(time.time())},
    )


def hydrate(job_id: str, page_ids: list) -> dict:
    """Embed and store one batch of pages."""
    item = _dynamodb.Table(JOB_TABLE).get_item(Key={"jobId": job_id}).get("Item")
    if not item:
        raise ValueError(f"no ontology job row for {job_id}")

    # From the job row, never from the payload: the sub that decides which prefix is
    # read is the one the start Lambda wrote from a verified Cognito claim.
    user_sub = item["userId"]
    run_prefix = _run_prefix(user_sub, job_id)

    pages = [_read_page(run_prefix, page_id) for page_id in page_ids or []]
    vectors = _vectors_for_batch(job_id, user_sub, pages)
    _put(vectors)

    return {"jobId": job_id, "pages": len(pages), "vectors": len(vectors)}


def main(mode: str, job_id: str, page_ids: list) -> dict:
    if not job_id:
        raise ValueError("jobId is required")

    if mode == "finalize":
        _set_index_status(job_id, models.INDEX_READY)
        return {"jobId": job_id, "indexStatus": models.INDEX_READY}

    if mode == "fail":
        _set_index_status(job_id, models.INDEX_FAILED)
        return {"jobId": job_id, "indexStatus": models.INDEX_FAILED}

    return hydrate(job_id, page_ids)


def _batch(event: dict) -> tuple:
    """(mode, jobId, pageIds) however the caller shaped the request.

    A hydrate batch arrives from a Distributed Map's ItemBatcher as
    `{"BatchInput": {...}, "Items": [manifestEntry, ...]}`, so the mode and job id sit
    behind BatchInput and the pages are manifest entries. The finalize and fail modes
    are invoked directly and arrive flat.
    """
    batch_input = event.get("BatchInput") or {}
    mode = batch_input.get("mode") or event.get("mode") or "hydrate"
    job_id = batch_input.get("jobId") or event.get("jobId")

    page_ids = list(event.get("pageIds") or [])
    for item in event.get("Items") or []:
        if isinstance(item, str):
            page_ids.append(item)
        elif isinstance(item, dict) and item.get("pageId"):
            page_ids.append(str(item["pageId"]))
    return mode, job_id, page_ids


def lambda_handler(event, context):
    mode, job_id, page_ids = _batch(event)
    try:
        return main(mode, job_id, page_ids)
    except Exception as error:
        print(f"Error hydrating ontology index for {job_id} ({mode}): {str(error)}")
        # Raised so the Map's Catch marks the index failed. The build itself is
        # untouched: an ontology that cannot be searched is still an ontology.
        raise
