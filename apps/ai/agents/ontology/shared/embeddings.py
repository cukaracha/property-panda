"""Titan v2 text embeddings — the one Bedrock call this agent still makes.

Every text-generation call in the ontology build runs on the caller's Claude
subscription through the Agent SDK. Embeddings are the exception: Anthropic has no
embeddings API, so CONSOLIDATE's clustering suggestions stay on Titan v2 (1024-dim,
normalized, cosine). That is now the agent's only use of it — the page index is
embedded by the hydrate Lambda, outside the runtime entirely, against the same model
so the two produce comparable vectors.

Deliberately narrower than the aws_utils layer's `bedrock_utils`: it carries only
the embedding path, and the runtime role's `bedrock:InvokeModel` is pinned to this
one model id. The absence of general text-model access is the point of the port,
so there is nothing here that could reach one.
"""

import json
import os
import time
from concurrent.futures import ThreadPoolExecutor

import boto3
from botocore.exceptions import ClientError

EMBED_MODEL = "amazon.titan-embed-text-v2:0"
EMBED_DIMENSIONS = 1024
EMBED_MAX_WORKERS = 8
MAX_PASSES = 8  # bounds total backoff
REGION = os.environ.get("AWS_REGION", "us-east-1")

_bedrock = boto3.client("bedrock-runtime", region_name=REGION)


class APILimitExceededError(Exception):
    """Raised when Titan stays throttled after all backoff passes."""


def embed_texts(texts, max_workers: int = EMBED_MAX_WORKERS):
    """Embed a list of strings with Titan Text Embeddings v2.

    Titan's invoke_model embeds one input per call, so the calls are fanned across a
    thread pool (each keeps its own throttling backoff). pool.map preserves order, so
    the returned vectors stay aligned to `texts`.
    """
    if not texts:
        return []
    with ThreadPoolExecutor(max_workers=min(max_workers, len(texts))) as pool:
        return list(pool.map(_embed_one, texts))


def _embed_one(text: str):
    body = json.dumps(
        {"inputText": text or " ", "dimensions": EMBED_DIMENSIONS, "normalize": True}
    )
    for attempt in range(1, MAX_PASSES + 1):
        try:
            response = _bedrock.invoke_model(modelId=EMBED_MODEL, body=body)
            return json.loads(response["body"].read())["embedding"]
        except ClientError as e:
            if e.response["Error"]["Code"] != "ThrottlingException":
                raise
            backoff = min(60, 10 * attempt)
            print(f"Embed throttled (pass {attempt}); backing off {backoff}s.", flush=True)
            time.sleep(backoff)
    raise APILimitExceededError("Titan embeddings throttled after backoff. Aborting.")
