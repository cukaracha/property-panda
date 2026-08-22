"""
Markdown Converter Worker (SQS-triggered, container image Lambda).

Consumes conversion jobs from the SQS FIFO queue: for each job it marks the
DynamoDB job row 'processing', runs the shared main() orchestration (S3 file in →
markdown out), then records 'succeeded' (with the output S3 URIs) or 'failed'
(with the error). This reuses the same converters/ + clients/ as the original
synchronous service — only the entrypoint changed from a Flask server to this
SQS handler.

On failure the row is marked 'failed' and the exception is re-raised so the SQS
message is retried and, after maxReceiveCount, lands in the DLQ. A job that
overruns the Lambda timeout leaves its row 'processing' until the table TTL
reaps it (see README for the practical media-length ceiling).
"""

import json
import os
import time

import boto3

from clients import budget
from main import main

_dynamodb = boto3.resource('dynamodb')

JOB_TABLE = os.environ['JOB_TABLE']
# Headroom for the final S3 writes + the status update before the Lambda times out.
DEADLINE_MARGIN_SECONDS = 30


def update_status(job_id, status, **fields):
    """Update the job row's status (+ optional fields) and updatedAt timestamp.

    Every attribute name is aliased via ExpressionAttributeNames because several are
    DynamoDB reserved words (`status`, and `error` on the failure path).
    """
    table = _dynamodb.Table(JOB_TABLE)
    attrs = {'status': status, 'updatedAt': int(time.time()), **fields}
    set_parts = []
    names = {}
    values = {}
    for i, (key, value) in enumerate(attrs.items()):
        set_parts.append(f'#n{i} = :v{i}')
        names[f'#n{i}'] = key
        values[f':v{i}'] = value
    table.update_item(
        Key={'jobId': job_id},
        UpdateExpression='SET ' + ', '.join(set_parts),
        ExpressionAttributeNames=names,
        ExpressionAttributeValues=values,
    )


def process_job(job, context):
    """Run one conversion job end to end, recording its terminal status."""
    job_id = job['jobId']
    input_s3_uri = job['input_s3_uri']
    output_s3_prefix = job['output_s3_prefix']

    if context is not None:
        budget.set_deadline(
            context.get_remaining_time_in_millis() / 1000 - DEADLINE_MARGIN_SECONDS
        )

    update_status(job_id, 'processing')
    try:
        result = main(input_s3_uri, output_s3_prefix)
        update_status(job_id, 'succeeded', outputs=result.get('outputs', []))
    except Exception as e:
        print(f"Job {job_id} failed: {e}")
        update_status(job_id, 'failed', error=str(e))
        raise  # retry, then DLQ after maxReceiveCount


def lambda_handler(event, context):
    for record in event.get('Records', []):
        job = json.loads(record['body'])
        process_job(job, context)
    return {'statusCode': 200}
