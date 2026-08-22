"""Delete one ontology build and everything it created.

Fronts DELETE /ontology/builds/{jobId}. Marks the job row `deleting`, hands the
teardown to the purge worker and returns 202 straight away — a large build leaves
thousands of objects across three lake buckets, the map-results tree and the page
index, which is far past API Gateway's 29 second ceiling.

Ownership is checked against the job row before anything is touched, and a build
the caller does not own is reported as 404 rather than 403, matching the read
endpoints so a jobId cannot be probed for existence.

Deleting a row already in `deleting` or `deleteFailed` simply re-runs the worker.
Every step of the purge is idempotent, so this doubles as the retry path.
"""

import json
import os
import time

import boto3
from aws_utils import auth_context, lambda_utils


_dynamodb = boto3.resource('dynamodb')
_lambda_client = boto3.client('lambda')

JOB_TABLE = os.environ['JOB_TABLE']
PURGE_FUNCTION_NAME = os.environ['PURGE_FUNCTION_NAME']

STATUS_DELETING = 'deleting'


def main(job_id, user_sub):
    """Mark the caller's own build for deletion, or None if it is not theirs."""
    table = _dynamodb.Table(JOB_TABLE)

    item = table.get_item(Key={'jobId': job_id}).get('Item')
    if not item or item.get('userId') != user_sub:
        return None

    # REMOVE clears the previous failure so a retry does not keep showing it.
    table.update_item(
        Key={'jobId': job_id},
        UpdateExpression='SET #s = :s, updatedAt = :now REMOVE deleteError',
        ExpressionAttributeNames={'#s': 'status'},
        ExpressionAttributeValues={':s': STATUS_DELETING, ':now': int(time.time())},
    )

    # Event invocation: the worker outlives this request by design.
    _lambda_client.invoke(
        FunctionName=PURGE_FUNCTION_NAME,
        InvocationType='Event',
        Payload=json.dumps({'jobId': job_id, 'userSub': user_sub}).encode('utf-8'),
    )

    return {'jobId': job_id, 'status': STATUS_DELETING}


def lambda_handler(event, context):
    options_response = lambda_utils.handle_options(event)
    if options_response:
        return options_response

    try:
        auth = auth_context.get_auth_context(event)

        path_params = event.get('pathParameters') or {}
        job_id = path_params.get('jobId')
        if not job_id:
            return lambda_utils.bad_request('jobId path parameter is required')

        result = main(job_id, auth.user_id)
        if result is None:
            return lambda_utils.not_found('Job not found')

        return lambda_utils.success_response(result, status_code=202)

    except auth_context.AuthContextError as e:
        return lambda_utils.unauthorized(str(e))
    except Exception as e:
        print(f"Error deleting ontology build: {str(e)}")
        return lambda_utils.server_error(str(e))
