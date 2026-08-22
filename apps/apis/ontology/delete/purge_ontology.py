"""Tear down every resource one ontology build created.

The worker behind DELETE /ontology/builds/{jobId}. Not an API endpoint: it is
invoked asynchronously by delete_ontology.py and answers to nobody, so it neither
handles OPTIONS nor formats a response.

Six groups, cleared in this order:

  1. the convert execution, whose name IS the jobId, stopped if it is still running
  2. users/{sub}/{jobId}/ in the bronze, silver and gold lake buckets
  3. the build's Distributed Map results under gold's map-results/ tree
  4. its windows in the shared page index, addressed by the {jobId}# key prefix
  5. its chat history on the ontology chat memory
  6. the job row itself, last, so a failure anywhere above leaves the build visible

Every step tolerates "already gone", which is what makes the whole worker safe to
re-run: a failed purge parks the row at `deleteFailed` and the panel re-arms its
delete button, so the retry path is simply another invocation.
"""

import os
import re
import time

import boto3
from botocore.exceptions import ClientError
from aws_utils import s3_utils


_dynamodb = boto3.resource('dynamodb')
_s3 = boto3.client('s3')
_s3vectors = boto3.client('s3vectors')
_sfn = boto3.client('stepfunctions')
_agentcore = boto3.client('bedrock-agentcore')

JOB_TABLE = os.environ['JOB_TABLE']
BRONZE_BUCKET_NAME = os.environ['BRONZE_BUCKET_NAME']
SILVER_BUCKET_NAME = os.environ['SILVER_BUCKET_NAME']
GOLD_BUCKET_NAME = os.environ['GOLD_BUCKET_NAME']
VECTOR_BUCKET = os.environ['VECTOR_BUCKET']
VECTOR_INDEX = os.environ['VECTOR_INDEX']
STATE_MACHINE_ARN = os.environ['STATE_MACHINE_ARN']
MEMORY_ID = os.environ['MEMORY_ID']

STATUS_DELETE_FAILED = 'deleteFailed'

# The two ResultWriter destinations in convert.asl.json. Each build owns a subtree
# named after its execution somewhere under these, at a depth AWS owns, so the
# roots are walked rather than the paths hardcoded.
MAP_RESULT_ROOTS = ('map-results/extract/', 'map-results/hydrate/')
MAP_RESULT_MAX_DEPTH = 3

# S3 Vectors accepts up to 500 keys per DeleteVectors call.
DELETE_BATCH = 500

# Valid characters for AgentCore Memory IDs. Kept byte-for-byte in lock-step with
# the ontology chat agent's sanitize_id (apps/ai/agents/ontology_chat/memory.py)
# and the read endpoints, so the actor purged here is the one the agent stored
# events under.
_ID_PATTERN = re.compile(r'[^a-zA-Z0-9\-_/:]')


def sanitize_id(value, default='default'):
    if not value:
        return default

    sanitized = _ID_PATTERN.sub('_', value)

    if sanitized and not sanitized[0].isalnum():
        sanitized = 'u' + sanitized

    return sanitized or default


def _stop_execution(job_id):
    """Abort the build if it is still running. start_build names the execution
    after the job, which is the only reason it can be addressed at all."""
    execution_arn = (
        f"{STATE_MACHINE_ARN.replace(':stateMachine:', ':execution:')}:{job_id}"
    )

    try:
        status = _sfn.describe_execution(executionArn=execution_arn)['status']
    except ClientError as e:
        if e.response['Error']['Code'] != 'ExecutionDoesNotExist':
            raise
        # Nothing was ever started under this id, or it has already aged out.
        return

    if status == 'RUNNING':
        _sfn.stop_execution(
            executionArn=execution_arn,
            error='OntologyDeleted',
            cause='The build was deleted by its owner.',
        )
        print(f"Stopped execution {execution_arn}")


def _delete_lake_objects(job_id, user_sub):
    """Clear the build's own prefix in all three lake buckets."""
    prefix = s3_utils.user_prefix(user_sub, job_id)
    for bucket in (BRONZE_BUCKET_NAME, SILVER_BUCKET_NAME, GOLD_BUCKET_NAME):
        s3_utils.delete_s3_prefix(bucket, prefix)


def _find_job_prefixes(root, job_id):
    """Common prefixes under root whose final segment is the job id.

    Walked with Delimiter rather than matched against a fixed path because the
    levels between the ResultWriter prefix and the execution name belong to Step
    Functions. Descending only into what has not already matched keeps this to a
    handful of list calls.
    """
    found = []
    frontier = [root]

    for _ in range(MAP_RESULT_MAX_DEPTH):
        if not frontier:
            break

        children = []
        for prefix in frontier:
            paginator = _s3.get_paginator('list_objects_v2')
            for page in paginator.paginate(
                Bucket=GOLD_BUCKET_NAME, Prefix=prefix, Delimiter='/'
            ):
                for entry in page.get('CommonPrefixes', []):
                    child = entry['Prefix']
                    if child.rstrip('/').rsplit('/', 1)[-1] == job_id:
                        found.append(child)
                    else:
                        children.append(child)

        frontier = children

    return found


def _delete_map_results(job_id):
    """Clear the build's Distributed Map results out of gold.

    The whole {jobId}/ subtree goes, not one map run: EXTRACT fans out a page per
    branch and the sweep loop re-enters it until nothing is pending, so one build
    leaves several map runs behind.
    """
    for root in MAP_RESULT_ROOTS:
        for prefix in _find_job_prefixes(root, job_id):
            s3_utils.delete_s3_prefix(GOLD_BUCKET_NAME, prefix)


def _delete_vectors(job_id):
    """Drop the build's windows from the shared page index.

    ListVectors takes no metadata filter, so the buildId the windows carry is no
    help here and the key prefix is the only handle. That is exactly why
    hydrate_index puts the build id in the key as well as the metadata.
    """
    key_prefix = f"{job_id}#"
    deleted = 0
    batch = []
    next_token = None

    while True:
        params = {
            'vectorBucketName': VECTOR_BUCKET,
            'indexName': VECTOR_INDEX,
            'maxResults': 500,
            'returnData': False,
            'returnMetadata': False,
        }
        if next_token:
            params['nextToken'] = next_token

        try:
            response = _s3vectors.list_vectors(**params)
        except ClientError as e:
            if e.response['Error']['Code'] != 'NotFoundException':
                raise
            # The index has never been written to.
            return

        for vector in response.get('vectors', []):
            key = vector.get('key', '')
            if not key.startswith(key_prefix):
                continue
            batch.append(key)
            if len(batch) == DELETE_BATCH:
                _s3vectors.delete_vectors(
                    vectorBucketName=VECTOR_BUCKET, indexName=VECTOR_INDEX, keys=batch)
                deleted += len(batch)
                batch = []

        next_token = response.get('nextToken')
        if not next_token:
            break

    if batch:
        _s3vectors.delete_vectors(
            vectorBucketName=VECTOR_BUCKET, indexName=VECTOR_INDEX, keys=batch)
        deleted += len(batch)

    print(f"Deleted {deleted} vector(s) for build {job_id}")


def _delete_chat_memory(job_id, user_sub):
    """Erase every conversation held about this build.

    Each half of the actor is sanitized separately and joined, never
    sanitize("{sub}/{build}"), matching how the agent wrote it.
    """
    actor_id = f"{sanitize_id(user_sub, 'anonymous')}/{sanitize_id(job_id, 'default')}"

    try:
        sessions = _list_all(
            _agentcore.list_sessions,
            'sessionSummaries',
            memoryId=MEMORY_ID,
            actorId=actor_id,
        )
    except ClientError as e:
        if e.response['Error']['Code'] != 'ResourceNotFoundException':
            raise
        # Nobody ever asked this build a question, so Memory has no such actor.
        return

    deleted = 0
    for session in sessions:
        session_id = session.get('sessionId')
        if not session_id:
            continue

        events = _list_all(
            _agentcore.list_events,
            'events',
            memoryId=MEMORY_ID,
            sessionId=session_id,
            actorId=actor_id,
        )
        for event in events:
            _agentcore.delete_event(
                memoryId=MEMORY_ID,
                sessionId=session_id,
                actorId=actor_id,
                eventId=event['eventId'],
            )
            deleted += 1

    print(f"Deleted {deleted} memory event(s) for build {job_id}")


def _list_all(operation, result_key, **params):
    """Drain a paginated AgentCore data-plane call."""
    items = []
    next_token = None

    while True:
        page_params = dict(params, maxResults=100)
        if next_token:
            page_params['nextToken'] = next_token

        response = operation(**page_params)
        items.extend(response.get(result_key, []))

        next_token = response.get('nextToken')
        if not next_token:
            return items


def _mark_failed(job_id, message):
    """Park the row so the panel can show what went wrong and offer a retry."""
    try:
        _dynamodb.Table(JOB_TABLE).update_item(
            Key={'jobId': job_id},
            UpdateExpression='SET #s = :s, deleteError = :e, updatedAt = :now',
            ExpressionAttributeNames={'#s': 'status'},
            ExpressionAttributeValues={
                ':s': STATUS_DELETE_FAILED,
                ':e': message[:500],
                ':now': int(time.time()),
            },
        )
    except Exception as e:
        print(f"Could not mark {job_id} as {STATUS_DELETE_FAILED}: {str(e)}")


def main(job_id, user_sub):
    """Purge one build, then drop its row."""
    if not job_id or not user_sub:
        raise ValueError('jobId and userSub are required')

    try:
        _stop_execution(job_id)
        _delete_lake_objects(job_id, user_sub)
        _delete_map_results(job_id)
        _delete_vectors(job_id)
        _delete_chat_memory(job_id, user_sub)

        # Last: while the row exists the build is still listed, which is what makes
        # a half-finished purge visible instead of silently orphaning objects.
        _dynamodb.Table(JOB_TABLE).delete_item(Key={'jobId': job_id})

    except Exception as e:
        _mark_failed(job_id, str(e))
        raise

    return {'jobId': job_id, 'status': 'deleted'}


def lambda_handler(event, context):
    job_id = event.get('jobId')
    user_sub = event.get('userSub')

    try:
        return main(job_id, user_sub)
    except Exception as e:
        print(f"Error purging ontology build {job_id}: {str(e)}")
        raise
