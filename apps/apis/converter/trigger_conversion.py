"""
Trigger Markdown Conversion Lambda.

Validates the request, mints a jobId, writes a 'queued' job row, enqueues the job
on the SQS FIFO queue (MessageGroupId = jobId), and returns 202 immediately. The
container worker Lambda (apps/ai/tools/markdown_converter) does the actual work
and updates the job row; the frontend polls get_conversion_status until terminal.

Two callers, two layouts. The converter page uploads to the temp bucket and takes
the default temp-bucket output prefix. The ontology agent passes inputBucket +
outputS3Prefix so a document read from bronze converts straight into silver under
the owner's users/{sub}/{buildId}/ prefix; both are structurally validated against
the lake buckets so a caller cannot redirect a conversion anywhere else.
"""

import json
import os
import time
import uuid

import boto3
from aws_utils import lambda_utils

_dynamodb = boto3.resource('dynamodb')
_sqs = boto3.client('sqs')

TEMP_BUCKET_NAME = os.environ['TEMP_BUCKET_NAME']
BRONZE_BUCKET_NAME = os.environ.get('BRONZE_BUCKET_NAME', '')
SILVER_BUCKET_NAME = os.environ.get('SILVER_BUCKET_NAME', '')
JOB_TABLE = os.environ['JOB_TABLE']
JOB_QUEUE_URL = os.environ['JOB_QUEUE_URL']
JOB_TTL_SECONDS = 24 * 3600


def _resolve_input_bucket(input_bucket: str) -> str:
    """Only the temp bucket (converter page) or bronze (ontology agent) may be read."""
    if not input_bucket:
        return TEMP_BUCKET_NAME
    if input_bucket == TEMP_BUCKET_NAME or (BRONZE_BUCKET_NAME and input_bucket == BRONZE_BUCKET_NAME):
        return input_bucket
    raise ValueError('inputBucket must be the temp or bronze bucket')


def _resolve_output_prefix(output_s3_prefix: str, job_id: str) -> str:
    """Default to the temp bucket; a supplied prefix must be a silver user prefix."""
    if not output_s3_prefix:
        # Outputs live under assets/ so the temp-data download endpoint (which
        # constrains keys to assets/) can mint presigned URLs for them.
        return f"s3://{TEMP_BUCKET_NAME}/assets/converted/{job_id}/"

    expected = f"s3://{SILVER_BUCKET_NAME}/users/"
    if not SILVER_BUCKET_NAME or not output_s3_prefix.startswith(expected):
        raise ValueError('outputS3Prefix must be a users/ prefix in the silver bucket')
    if '..' in output_s3_prefix or not output_s3_prefix.endswith('/'):
        raise ValueError('outputS3Prefix must be a well-formed prefix ending in /')

    return output_s3_prefix


def main(key: str, input_bucket: str = None, output_s3_prefix: str = None) -> dict:
    """Create a queued job for the uploaded asset and enqueue it for the worker."""
    job_id = str(uuid.uuid4())
    input_s3_uri = f"s3://{_resolve_input_bucket(input_bucket)}/{key}"
    output_s3_prefix = _resolve_output_prefix(output_s3_prefix, job_id)
    now = int(time.time())

    _dynamodb.Table(JOB_TABLE).put_item(
        Item={
            'jobId': job_id,
            'status': 'queued',
            'inputKey': key,
            'createdAt': now,
            'updatedAt': now,
            'ttl': now + JOB_TTL_SECONDS,
        }
    )

    _sqs.send_message(
        QueueUrl=JOB_QUEUE_URL,
        MessageBody=json.dumps(
            {
                'jobId': job_id,
                'input_s3_uri': input_s3_uri,
                'output_s3_prefix': output_s3_prefix,
            }
        ),
        MessageGroupId=job_id,
    )

    return {'jobId': job_id}


def lambda_handler(event, context):
    options_response = lambda_utils.handle_options(event)
    if options_response:
        return options_response

    try:
        body = json.loads(event.get('body', '{}'))
        key = body.get('key')
        input_bucket = body.get('inputBucket')
        output_s3_prefix = body.get('outputS3Prefix')

        if not key:
            return lambda_utils.bad_request('Missing key in request body')
        if '..' in key:
            return lambda_utils.bad_request('key must not contain path traversal')
        # Temp-bucket sources live under assets/; bronze sources under users/.
        if not key.startswith(('assets/', 'users/')):
            return lambda_utils.bad_request(
                'key must be an uploaded asset under assets/ (temp) or users/ (lake)'
            )

        return lambda_utils.success_response(
            main(key, input_bucket, output_s3_prefix), status_code=202
        )

    except ValueError as e:
        return lambda_utils.bad_request(str(e))
    except json.JSONDecodeError as e:
        return lambda_utils.bad_request(f'Invalid JSON in request body: {str(e)}')
    except Exception as e:
        print(f"Error triggering conversion: {str(e)}")
        return lambda_utils.server_error(str(e))
