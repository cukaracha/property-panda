import os
import json
import tempfile
from dataclasses import dataclass
from typing import Dict, List, Union
from concurrent.futures import ThreadPoolExecutor, as_completed

from clients.s3_utils import parse_s3_uri, get_s3_object_bytes, put_object
from clients import secrets
from converters import convert as dispatch_convert, get_file_category, AV_EXTENSIONS


@dataclass
class Source:
    bucket: str
    key: str
    filename: str       # "lecture.pdf"
    base_name: str      # "lecture"
    extension: str      # "pdf"
    file_category: str  # "document" | "image" | "audio_video"


@dataclass
class Config:
    prompts: dict


def main(input_s3_uri: str, output_s3_prefix: str) -> dict:
    """Workflow orchestrator — 5 sequential steps."""

    # Step 1: Parse input and determine file type
    source = parse_input(input_s3_uri)

    # Step 2: Load configuration (API keys from Secrets Manager, prompts)
    config = load_config()

    # Step 3: Retrieve source data from S3
    source_data = retrieve_source(source)

    # Step 4: Convert to markdown
    markdown_result = dispatch_convert(source_data, source, config)

    # Step 5: Write output markdown to S3
    output_uris = write_output(markdown_result, output_s3_prefix, source)

    return {"outputs": output_uris}


def parse_input(input_s3_uri: str) -> Source:
    """Step 1: Parse S3 URI and determine file type."""
    bucket, key = parse_s3_uri(input_s3_uri)

    filename = key.rsplit('/', 1)[-1] if '/' in key else key
    base_name, _, ext = filename.rpartition('.')
    extension = ext.lower()

    if not extension:
        raise ValueError(f"Cannot determine file type for: {key}")

    file_category = get_file_category(extension)

    print(f"Parsed input: bucket={bucket}, key={key}, ext={extension}, category={file_category}")

    return Source(
        bucket=bucket,
        key=key,
        filename=filename,
        base_name=base_name,
        extension=extension,
        file_category=file_category
    )


def load_config() -> Config:
    """Step 2: Load API keys and prompt templates."""
    # Retrieve API keys from Secrets Manager
    secret_arn = os.environ.get('SECRET_ARN')
    if secret_arn:
        secrets.set_env_from_secret(secret_arn)
    else:
        print("WARNING: SECRET_ARN not set, using existing environment variables")

    # Load prompts
    prompts_path = os.path.join(os.path.dirname(__file__), 'prompts.json')
    with open(prompts_path, 'r') as f:
        prompts = json.load(f)

    return Config(prompts=prompts)


def retrieve_source(source: Source) -> Union[bytes, None]:
    """Step 3: Retrieve source data from S3. Returns None for AV files."""
    if source.extension in AV_EXTENSIONS:
        # Transcribe reads directly from S3
        print(f"Audio/video file — Transcribe will read from S3 directly")
        return None

    print(f"Downloading file from S3: s3://{source.bucket}/{source.key}")
    file_bytes = get_s3_object_bytes(source.bucket, source.key)
    print(f"File size: {len(file_bytes)} bytes")
    return file_bytes


def write_output(
    result: Union[str, Dict[int, str]],
    output_s3_prefix: str,
    source: Source
) -> List[str]:
    """Step 5: Write markdown output to S3 and return list of output S3 URIs."""
    out_bucket, out_prefix = parse_s3_uri(output_s3_prefix)

    # Ensure prefix ends with /
    if out_prefix and not out_prefix.endswith('/'):
        out_prefix += '/'

    output_uris = []

    if isinstance(result, str):
        # Single file output
        if source.file_category == "audio_video":
            output_key = f"{out_prefix}{source.base_name}-transcript.md"
        else:
            output_key = f"{out_prefix}{source.base_name}.md"

        put_object(out_bucket, output_key, result, 'text/markdown')
        output_uris.append(f"s3://{out_bucket}/{output_key}")

    elif isinstance(result, dict):
        # Multi-page output — write all pages concurrently
        def _write_page(identifier, markdown_content):
            if isinstance(identifier, int):
                key = f"{out_prefix}{source.base_name}-page-{identifier}.md"
            else:
                key = f"{out_prefix}{source.base_name}-{identifier}.md"
            put_object(out_bucket, key, markdown_content, 'text/markdown')
            return f"s3://{out_bucket}/{key}"

        with ThreadPoolExecutor(max_workers=min(len(result), 10)) as executor:
            futures = {
                executor.submit(_write_page, ident, content): ident
                for ident, content in result.items()
            }
            for future in as_completed(futures):
                output_uris.append(future.result())

        output_uris.sort()

    print(f"Uploaded {len(output_uris)} markdown file(s):")
    for uri in output_uris:
        print(f"  - {uri}")

    return output_uris
