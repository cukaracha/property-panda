"""
KB ingestion trigger.

One-shot Lambda invoked by Terraform (aws_lambda_invocation) during apply, once per
data source, whenever that source's seed documents change. Bedrock does not auto-sync an
S3 data source, so this starts an ingestion job to (re)index the uploaded lessons. Fire and
forget — StartIngestionJob returns 202 Accepted, so it returns without waiting for indexing
to finish.

To avoid a ConflictException on back-to-back applies, it first checks the live ingestion
jobs and, if one is already running for the data source, returns that instead of starting
another. When several data sources are synced at once (the Terraform for_each fires them in
parallel), a start can also hit a transient KB-level ConflictException; in that case it
briefly retries the start until Bedrock accepts the job.

Invocation event: {knowledge_base_id, data_source_id}.
"""

import time

import boto3
from botocore.exceptions import ClientError

_bedrock_agent = boto3.client('bedrock-agent')

ACTIVE_JOB_STATES = ('STARTING', 'IN_PROGRESS')
RETRY_INTERVAL_SECONDS = 5
SAFETY_MARGIN_MS = 15_000


def find_active_job(knowledge_base_id, data_source_id):
    resp = _bedrock_agent.list_ingestion_jobs(
        knowledgeBaseId=knowledge_base_id,
        dataSourceId=data_source_id,
        sortBy={'attribute': 'STARTED_AT', 'order': 'DESCENDING'},
        maxResults=5,
    )
    for job in resp.get('ingestionJobSummaries', []):
        if job['status'] in ACTIVE_JOB_STATES:
            return job
    return None


def main(knowledge_base_id, data_source_id, context=None):
    existing = find_active_job(knowledge_base_id, data_source_id)
    if existing:
        return {'ingestionJobId': existing['ingestionJobId'], 'status': existing['status'], 'alreadyRunning': True}

    while True:
        try:
            job = _bedrock_agent.start_ingestion_job(
                knowledgeBaseId=knowledge_base_id,
                dataSourceId=data_source_id,
            )['ingestionJob']
            return {'ingestionJobId': job['ingestionJobId'], 'status': job['status'], 'alreadyRunning': False}
        except ClientError as e:
            if e.response['Error']['Code'] != 'ConflictException':
                raise
            # A job for THIS source is already running — benign; ingestion is
            # incremental, so it will pick up the new files. Return it.
            active = find_active_job(knowledge_base_id, data_source_id)
            if active:
                return {'ingestionJobId': active['ingestionJobId'], 'status': active['status'], 'alreadyRunning': True}
            # Transient KB-level contention from a sibling data source's start
            # (the for_each race). Retry the start briefly, then return.
            time_left = context.get_remaining_time_in_millis() if context else 0
            if time_left <= SAFETY_MARGIN_MS:
                raise
            time.sleep(RETRY_INTERVAL_SECONDS)


def lambda_handler(event, context):
    return main(event['knowledge_base_id'], event['data_source_id'], context)
