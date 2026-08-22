import os
import time
import boto3
from botocore.exceptions import ClientError

# Vision-capable Claude models on Bedrock, tried in order on throttling.
# Both ids verified ACTIVE in the deploy region (us-east-1); Sonnet 4.6 matches
# the chat agent.
MODELS = [
    "global.anthropic.claude-sonnet-4-6",
    "global.anthropic.claude-haiku-4-5-20251001-v1:0",
]
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
