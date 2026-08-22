"""
Get Conversion Status Lambda.

Returns the current status (and outputs / error) of a conversion job by jobId.
The frontend polls this until a terminal status (succeeded / failed).
"""

import os

import boto3
from aws_utils import lambda_utils

_dynamodb = boto3.resource('dynamodb')

JOB_TABLE = os.environ['JOB_TABLE']


def main(job_id: str):
    """Return the job's status view, or None if the job does not exist."""
    item = _dynamodb.Table(JOB_TABLE).get_item(Key={'jobId': job_id}).get('Item')
    if not item:
        return None
    return {
        'jobId': item['jobId'],
        'status': item.get('status'),
        'outputs': item.get('outputs', []),
        'error': item.get('error'),
    }


def lambda_handler(event, context):
    options_response = lambda_utils.handle_options(event)
    if options_response:
        return options_response

    try:
        query_params = event.get('queryStringParameters') or {}
        job_id = query_params.get('jobId')

        if not job_id:
            return lambda_utils.bad_request('Missing jobId query parameter')

        result = main(job_id)
        if result is None:
            return lambda_utils.not_found('Job not found')

        return lambda_utils.success_response(result)

    except Exception as e:
        print(f"Error getting conversion status: {str(e)}")
        return lambda_utils.server_error(str(e))
