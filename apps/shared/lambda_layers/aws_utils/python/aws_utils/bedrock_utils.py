import json
import os
import time
from concurrent.futures import ThreadPoolExecutor

import boto3
from botocore.exceptions import ClientError

# Claude models on Bedrock, tried in order on throttling — shared by analyze_image
# (vision) and converse_text (text). The markdown converter keeps its own separate
# MODELS list. Verify each id is enabled (Model access) in the deploy region.
MODELS = [
    "global.anthropic.claude-sonnet-4-6",
    "global.anthropic.claude-sonnet-4-5",
    "global.anthropic.claude-haiku-4-5-20251001-v1:0",
]
# Titan Text Embeddings v2 — 1024-dim, cosine, normalized.
EMBED_MODEL = "amazon.titan-embed-text-v2:0"
EMBED_DIMENSIONS = 1024
EMBED_MAX_WORKERS = 8  # per-Lambda embed threads (fanned across Titan invoke_model calls)
REGION = os.environ.get("AWS_REGION", "us-east-1")
MAX_PASSES = 8  # bounds total backoff within the worker's 15-min Lambda timeout

_bedrock = boto3.client("bedrock-runtime", region_name=REGION)


class APILimitExceededError(Exception):
    """Raised when every model stays throttled after all backoff passes."""


def _converse(model_id: str, image_bytes: bytes, instructions: str) -> str:
    response = _bedrock.converse(
        modelId=model_id,
        messages=[{
            "role": "user",
            "content": [
                {"text": instructions},
                {"image": {"format": "jpeg", "source": {"bytes": image_bytes}}},
            ],
        }],
    )
    return response["output"]["message"]["content"][0]["text"]


def analyze_image(image_bytes: bytes, instructions: str) -> str:
    """Describe an image with Claude via Bedrock Converse.

    On ThrottlingException, immediately try the next model in MODELS. When a full
    pass is throttled, back off (10s, 20s, ... capped at 60s) and retry the pass.
    """
    for attempt in range(1, MAX_PASSES + 1):
        for model_id in MODELS:
            try:
                return _converse(model_id, image_bytes, instructions)
            except ClientError as e:
                if e.response["Error"]["Code"] != "ThrottlingException":
                    raise
                print(f"Throttled on {model_id}; trying next model.")
        if attempt < MAX_PASSES:
            backoff = min(60, 10 * attempt)
            print(f"All models throttled (pass {attempt}); backing off {backoff}s.")
            time.sleep(backoff)
    raise APILimitExceededError("All Claude models throttled after backoff. Aborting.")


# ---------------------------------------------------------------------------
# Text LLM + embeddings — used by the web_search tool and the markdown converter.
# boto3-only (the layer's zero-dep rule); the container stages COPY this package
# into their image, the zip stages attach the layer, so this is the single source
# of truth for Bedrock access on the app's own account. The ontology agent
# deliberately does NOT use this: it runs text generation on the caller's Claude
# subscription and carries its own embeddings-only module.
# ---------------------------------------------------------------------------
def _converse_text(model_id: str, prompt: str, system: str, max_tokens: int, temperature: float) -> str:
    kwargs = {
        "modelId": model_id,
        "messages": [{"role": "user", "content": [{"text": prompt}]}],
        "inferenceConfig": {"maxTokens": max_tokens, "temperature": temperature},
    }
    if system:
        kwargs["system"] = [{"text": system}]
    response = _bedrock.converse(**kwargs)
    return response["output"]["message"]["content"][0]["text"]


def converse_text(prompt, system=None, max_tokens=4096, temperature=0.0):
    """Run a text-only Converse prompt with the same model-failover/backoff as analyze_image.

    On ThrottlingException, immediately try the next model in MODELS; when a full
    pass is throttled, back off (10s, 20s, ... capped at 60s) and retry.
    """
    for attempt in range(1, MAX_PASSES + 1):
        for model_id in MODELS:
            try:
                return _converse_text(model_id, prompt, system, max_tokens, temperature)
            except ClientError as e:
                if e.response["Error"]["Code"] != "ThrottlingException":
                    raise
                print(f"Throttled on {model_id}; trying next model.")
        if attempt < MAX_PASSES:
            backoff = min(60, 10 * attempt)
            print(f"All models throttled (pass {attempt}); backing off {backoff}s.")
            time.sleep(backoff)
    raise APILimitExceededError("All Claude models throttled after backoff. Aborting.")


def _strip_code_fence(text: str) -> str:
    """Strip a leading/trailing ```json ... ``` fence the model sometimes adds."""
    stripped = text.strip()
    if stripped.startswith("```"):
        stripped = stripped.split("\n", 1)[-1] if "\n" in stripped else stripped
        if stripped.endswith("```"):
            stripped = stripped[: stripped.rfind("```")]
    return stripped.strip()


def extract_json(prompt, system=None, max_tokens=4096, temperature=0.0, retries=2):
    """Converse and parse the reply as JSON, re-prompting on a JSONDecodeError.

    Returns the parsed object/list. Raises the last JSONDecodeError if the model
    never returns valid JSON within `retries` re-prompts.
    """
    ask = prompt
    last_error = None
    for _ in range(retries + 1):
        raw = converse_text(ask, system=system, max_tokens=max_tokens, temperature=temperature)
        try:
            return json.loads(_strip_code_fence(raw))
        except json.JSONDecodeError as e:
            last_error = e
            ask = (
                f"{prompt}\n\nYour previous reply was not valid JSON ({e}). "
                "Reply with ONLY the JSON value, no prose, no code fence."
            )
    raise last_error


def embed_texts(texts, max_workers=EMBED_MAX_WORKERS):
    """Embed a list of strings with Titan Text Embeddings v2 (1024-dim, normalized).

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
            print(f"Embed throttled (pass {attempt}); backing off {backoff}s.")
            time.sleep(backoff)
    raise APILimitExceededError("Titan embeddings throttled after backoff. Aborting.")
