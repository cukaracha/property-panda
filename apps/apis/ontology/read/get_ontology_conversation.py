"""Replay one past conversation about an ontology build.

Proxies the AgentCore Memory data-plane: lists the events of one session on the
ontology chat agent's memory, orders them, and returns a flat
[{role, content, timestamp}] transcript. Read-only.

There is no envelope to unwrap here, unlike the chat agent's replay endpoint. The
ontology agent writes the question verbatim and the answer exactly as the browser
accumulated it, so normalization is a role map and nothing more.

The actor is the composite "{sub}/{buildId}" the agent wrote under, with the sub
half taken from the verified Cognito claims — so a user can only replay their own
sessions, and a foreign or unknown sessionId yields an empty transcript rather
than an error that would confirm it exists.
"""

import os
import re

import boto3
from botocore.exceptions import ClientError
from aws_utils import lambda_utils, auth_context


agentcore_client = boto3.client('bedrock-agentcore')

# Valid characters for AgentCore Memory IDs. Kept byte-for-byte in lock-step with
# the ontology chat agent's sanitize_id (apps/ai/agents/ontology_chat/memory.py)
# and list_ontology_conversations.py so the ids queried here match the ones the
# agent stored events under.
_ID_PATTERN = re.compile(r'[^a-zA-Z0-9\-_/:]')

# Only conversational turns spoken by the user or the assistant are replayed.
_ROLE_MAP = {'USER': 'user', 'ASSISTANT': 'assistant'}


def sanitize_id(value, default='default'):
    if not value:
        return default

    sanitized = _ID_PATTERN.sub('_', value)

    if sanitized and not sanitized[0].isalnum():
        sanitized = 'u' + sanitized

    return sanitized or default


def _iso(value):
    return value.isoformat() if hasattr(value, 'isoformat') else value


def list_events(memory_id, session_id, actor_id):
    events = []
    next_token = None

    while True:
        params = {
            'memoryId': memory_id,
            'sessionId': session_id,
            'actorId': actor_id,
            # Mandatory — payloads come back empty otherwise.
            'includePayloads': True,
            'maxResults': 100,
        }
        if next_token:
            params['nextToken'] = next_token

        response = agentcore_client.list_events(**params)
        events.extend(response.get('events', []))

        next_token = response.get('nextToken')
        if not next_token:
            break

    return events


def normalize_events(events):
    messages = []

    for event in events:
        timestamp = _iso(event.get('eventTimestamp'))
        for item in event.get('payload', []) or []:
            conversational = item.get('conversational')
            if not conversational:
                continue

            role = _ROLE_MAP.get(conversational.get('role'))
            if not role:
                continue

            text = (conversational.get('content') or {}).get('text', '')
            if not text:
                continue

            messages.append({'role': role, 'content': text, 'timestamp': timestamp})

    return messages


def main(user_sub, build_id, session_id):
    memory_id = os.environ['MEMORY_ID']

    # Each half sanitized separately and joined — never sanitize("{sub}/{build}"),
    # which a crafted build id could use to escape the separator.
    actor_id = f"{sanitize_id(user_sub, 'anonymous')}/{sanitize_id(build_id, 'default')}"

    try:
        events = list_events(memory_id, sanitize_id(session_id, 'default'), actor_id)
    except ClientError as e:
        if e.response['Error']['Code'] != 'ResourceNotFoundException':
            raise
        # No such actor or session — treated as an empty/new thread.
        return {'sessionId': session_id, 'messages': []}

    # No ordering param on the API — sort locally by time, then id as a tiebreak.
    events.sort(key=lambda e: (e.get('eventTimestamp'), e.get('eventId', '')))

    return {'sessionId': session_id, 'messages': normalize_events(events)}


def lambda_handler(event, context):
    options_response = lambda_utils.handle_options(event)
    if options_response:
        return options_response

    try:
        auth = auth_context.get_auth_context(event)

        path_params = event.get('pathParameters') or {}
        build_id = path_params.get('jobId')
        session_id = path_params.get('sessionId')
        if not build_id:
            return lambda_utils.bad_request('jobId path parameter is required')
        if not session_id:
            return lambda_utils.bad_request('sessionId path parameter is required')

        result = main(auth.user_id, build_id, session_id)
        return lambda_utils.success_response(result)

    except auth_context.AuthContextError as e:
        return lambda_utils.unauthorized(str(e))
    except Exception as e:
        print(f"Error getting ontology conversation: {str(e)}")
        return lambda_utils.server_error(str(e))
