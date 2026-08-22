"""
Compact Ontology Elements Lambda.

One pass over the extracted elements that replaces five. Invoked only by Step
Functions, once extraction has settled and before the agent is handed CONSOLIDATE.

The stages that follow all want the whole corpus and each used to walk every
`elements/{page_id}.json` object to get it: three times inside CONSOLIDATE, once in
CANONICALIZE and once in EMIT. At ten thousand pages that is fifty thousand round
trips for information that does not change once extraction is done, and it made the
cost of designing a schema grow with the corpus even though the vocabulary itself
does not.

So it is derived once here, into three objects:

  elements/index.jsonl    every element record, streamable in one GET
  consolidate/vocab.json  the raw type and predicate vocabulary, already aggregated
  extract/counts.json     the corpus-wide extraction counters telemetry reports

The per-page objects are kept. They are the idempotent write unit an extract retry
overwrites, and everything written here is derived from them and regenerable.

Identity is read from the job row rather than carried through the execution input.
"""

import os

import boto3

from shared import artifacts, elements, emission, vocab

_dynamodb = boto3.resource("dynamodb")

JOB_TABLE = os.environ["JOB_TABLE"]
GOLD_BUCKET_NAME = os.environ["GOLD_BUCKET_NAME"]


def _run_prefix(user_sub: str, job_id: str) -> str:
    return f"s3://{GOLD_BUCKET_NAME}/users/{user_sub}/{job_id}/"


def compact(run_prefix: str) -> dict:
    """Stream the per-page elements once, writing all three derived artifacts."""
    totals = vocab.new_totals()
    counts = dict.fromkeys(emission.COUNT_FIELDS, 0)
    pages = 0

    def indexed():
        nonlocal pages
        for element in elements.stream_objects(run_prefix):
            pages += 1
            vocab.add(totals, element)
            elements.add_counts(counts, element)
            yield element

    artifacts.write_jsonl(elements.index_uri(run_prefix), indexed())
    artifacts.write_json(artifacts.resolve(run_prefix, vocab.VOCAB_NAME),
                         vocab.to_artifact(totals))
    artifacts.write_json(artifacts.resolve(run_prefix, emission.COUNTS_NAME), counts)

    return {"pages": pages, "counts": counts}


def main(job_id: str) -> dict:
    item = _dynamodb.Table(JOB_TABLE).get_item(Key={"jobId": job_id}).get("Item")
    if not item:
        raise ValueError(f"no ontology job row for {job_id}")

    result = compact(_run_prefix(item["userId"], job_id))
    return {"jobId": job_id, "extractedPages": result["pages"], "counts": result["counts"]}


def lambda_handler(event, context):
    return main(event.get("jobId"))
