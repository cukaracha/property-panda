"""S3 run-prefix I/O helpers for the ontology pipeline.

Every stage derives all of its inputs and outputs from a single `run_prefix`
(`s3://{TEMP_BUCKET}/ontology/{jobId}/`), so the stages never thread large state
through Step Functions — they read/write deterministic keys under that prefix and
pass only small control payloads. This module is the one place that knows how to
turn a run prefix + relative path into a bucket/key and read/write JSON, JSONL,
CSV, and text there.

The CSV and JSONL writers stream. A corpus of ten thousand pages produces a chunks
file of tens of megabytes, and building it whole in memory before encoding it peaks
at twice its size inside a Lambda; parts are uploaded as they fill instead, and a
file small enough to fit in one part is still written with a single PutObject. The
matching readers yield a line at a time for the same reason.
"""

import codecs
import csv
import io
import json

import boto3
from botocore.exceptions import ClientError

_s3 = boto3.client("s3")

# S3 requires at least 5 MiB per part except the last. Above that the size is only a
# memory ceiling, so this is the largest buffer worth holding for the smallest number
# of round trips.
PART_BYTES = 8 * 1024 * 1024


def split_uri(s3_uri: str):
    """Split an s3://bucket/key URI into (bucket, key)."""
    if not s3_uri.startswith("s3://"):
        raise ValueError(f"Invalid S3 URI: {s3_uri}")
    path = s3_uri[len("s3://") :]
    bucket, _, key = path.partition("/")
    return bucket, key


def resolve(run_prefix: str, rel_path: str) -> str:
    """Join a relative path onto the run prefix, returning a full s3:// URI."""
    base = run_prefix if run_prefix.endswith("/") else run_prefix + "/"
    return base + rel_path.lstrip("/")


def read_bytes(s3_uri: str) -> bytes:
    bucket, key = split_uri(s3_uri)
    return _s3.get_object(Bucket=bucket, Key=key)["Body"].read()


def read_text(s3_uri: str) -> str:
    return read_bytes(s3_uri).decode("utf-8")


def read_json(s3_uri: str):
    return json.loads(read_bytes(s3_uri))


def read_lines(s3_uri: str):
    """Yield each non-blank line of an object, decoded, without buffering the whole body."""
    bucket, key = split_uri(s3_uri)
    body = _s3.get_object(Bucket=bucket, Key=key)["Body"]
    for line in codecs.getreader("utf-8")(body):
        if line.strip():
            yield line


def iter_jsonl(s3_uri: str):
    """Yield each record of a JSONL object one at a time."""
    for line in read_lines(s3_uri):
        yield json.loads(line)


def read_jsonl(s3_uri: str):
    """Read a JSONL object into a list of dicts (blank lines skipped)."""
    return list(iter_jsonl(s3_uri))


def write_bytes(s3_uri: str, body: bytes, content_type: str = "application/octet-stream") -> str:
    bucket, key = split_uri(s3_uri)
    _s3.put_object(Bucket=bucket, Key=key, Body=body, ContentType=content_type)
    return s3_uri


def write_text(s3_uri: str, text: str, content_type: str = "text/plain") -> str:
    return write_bytes(s3_uri, text.encode("utf-8"), content_type)


def write_json(s3_uri: str, data, content_type: str = "application/json") -> str:
    return write_bytes(s3_uri, json.dumps(data, default=str).encode("utf-8"), content_type)


class _StreamingWriter:
    """Upload text to one key as it is produced, buffering only a part at a time.

    A single PutObject is used when everything fits in one part, so a small file costs
    the same three-round-trip multipart dance it always did: nothing. A part is only
    started once the buffer has passed the minimum S3 accepts.
    """

    def __init__(self, s3_uri: str, content_type: str) -> None:
        self.uri = s3_uri
        self.bucket, self.key = split_uri(s3_uri)
        self.content_type = content_type
        self.buffer = io.StringIO()
        self.upload_id = None
        self.parts = []

    def write(self, text: str) -> None:
        self.buffer.write(text)
        if self.buffer.tell() >= PART_BYTES:
            self._flush()

    def _flush(self) -> None:
        body = self.buffer.getvalue()
        if not body:
            return
        if self.upload_id is None:
            self.upload_id = _s3.create_multipart_upload(
                Bucket=self.bucket, Key=self.key, ContentType=self.content_type
            )["UploadId"]
        part = _s3.upload_part(
            Bucket=self.bucket,
            Key=self.key,
            UploadId=self.upload_id,
            PartNumber=len(self.parts) + 1,
            Body=body.encode("utf-8"),
        )
        self.parts.append({"ETag": part["ETag"], "PartNumber": len(self.parts) + 1})
        self.buffer.seek(0)
        self.buffer.truncate(0)

    def close(self) -> str:
        if self.upload_id is None:
            return write_text(self.uri, self.buffer.getvalue(), self.content_type)
        try:
            self._flush()
            _s3.complete_multipart_upload(
                Bucket=self.bucket,
                Key=self.key,
                UploadId=self.upload_id,
                MultipartUpload={"Parts": self.parts},
            )
        except Exception:
            # An abandoned upload is billed until it is aborted, and a build that
            # failed here would otherwise leave one behind on every retry.
            _s3.abort_multipart_upload(
                Bucket=self.bucket, Key=self.key, UploadId=self.upload_id
            )
            raise
        return self.uri


def write_jsonl(s3_uri: str, rows) -> str:
    """Stream an iterable of records to a JSONL object, one line each."""
    writer = _StreamingWriter(s3_uri, "application/x-ndjson")
    for row in rows:
        writer.write(json.dumps(row, default=str) + "\n")
    return writer.close()


class CsvWriter:
    """A CSV object written row by row, for a producer that cannot hand over a list.

    Segmentation writes its pages and chunks as it cuts them, so it never holds the
    whole corpus; `write_csv` is the same thing for a caller that already has an
    iterable.
    """

    def __init__(self, s3_uri: str, fieldnames) -> None:
        self._out = _StreamingWriter(s3_uri, "text/csv")
        self._line = io.StringIO()
        self._formatter = csv.DictWriter(
            self._line, fieldnames=fieldnames, extrasaction="ignore"
        )
        self._formatter.writeheader()

    def write_row(self, row: dict) -> None:
        self._formatter.writerow(row)
        self._out.write(self._line.getvalue())
        self._line.seek(0)
        self._line.truncate(0)

    def close(self) -> str:
        self._out.write(self._line.getvalue())
        return self._out.close()


def write_csv(s3_uri: str, fieldnames, rows) -> str:
    """Stream an iterable of dicts to a CSV object."""
    writer = CsvWriter(s3_uri, fieldnames)
    for row in rows:
        writer.write_row(row)
    return writer.close()


def list_keys(s3_uri_prefix: str):
    """List every full s3:// URI under a prefix (paginated)."""
    bucket, prefix = split_uri(s3_uri_prefix)
    paginator = _s3.get_paginator("list_objects_v2")
    uris = []
    for page in paginator.paginate(Bucket=bucket, Prefix=prefix):
        for obj in page.get("Contents", []):
            uris.append(f"s3://{bucket}/{obj['Key']}")
    return uris


def exists(s3_uri: str) -> bool:
    """True if the object is there. Only a 404 counts as absent.

    A permissions error or a throttle used to be indistinguishable from a missing
    object here, and this now gates the check that decides whether a build is allowed
    to be marked terminal, so anything other than "not found" is raised.
    """
    bucket, key = split_uri(s3_uri)
    try:
        _s3.head_object(Bucket=bucket, Key=key)
        return True
    except ClientError as error:
        if error.response.get("Error", {}).get("Code") in ("404", "NoSuchKey", "NotFound"):
            return False
        raise
