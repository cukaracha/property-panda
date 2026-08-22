"""List the authenticated user's past chat conversations.

Proxies the AgentCore Memory data-plane: lists the caller's sessions on the chat
agent's memory (actor = Cognito sub) and returns them newest-first as
{sessionId, createdAt}. Read-only. The actor is always taken from the verified
Cognito claims, never a client parameter, so a user only ever sees their own
conversations.
"""

import os
import re

import boto3
from botocore.exceptions import ClientError
from aws_utils import lambda_utils, auth_context


agentcore_client = boto3.client('bedrock-agentcore')

# Valid characters for AgentCore Memory IDs. Kept byte-for-byte in lock-step with
# the chat agent's sanitize_id (apps/ai/agents/chat/agent_memory.py) and
# get_conversation.py so the actor id queried here matches the one the agent
# stored events under. A Cognito sub is a UUID, so this is a no-op in practice.
_ID_PATTERN = re.compile(r'[^a-zA-Z0-9\-_/:]')


def sanitize_id(value, default='default'):
    if not value:
        return default

    sanitized = _ID_PATTERN.sub('_', value)

    if sanitized and not sanitized[0].isalnum():
        sanitized = 'u' + sanitized

    return sanitized or default


def _iso(value):
    return value.isoformat() if hasattr(value, 'isoformat') else value


def list_sessions(memory_id, actor_id):
    sessions = []
    next_token = None

    while True:
        params = {
            'memoryId': memory_id,
            'actorId': actor_id,
            'maxResults': 100,
        }
        if next_token:
            params['nextToken'] = next_token

        response = agentcore_client.list_sessions(**params)
        sessions.extend(response.get('sessionSummaries', []))

        next_token = response.get('nextToken')
        if not next_token:
            break

    return sessions


def main(actor_id):
    memory_id = os.environ['MEMORY_ID']

    try:
        sessions = list_sessions(memory_id, sanitize_id(actor_id, 'anonymous'))
    except ClientError as e:
        if e.response['Error']['Code'] != 'ResourceNotFoundException':
            raise
        # New user: the actor has no events yet, so Memory has no record of it.
        return {'conversations': []}

    # No ordering param on the API — sort locally, newest first.
    sessions.sort(key=lambda s: s.get('createdAt'), reverse=True)

    conversations = [
        {'sessionId': s['sessionId'], 'createdAt': _iso(s.get('createdAt'))}
        for s in sessions
        if s.get('sessionId')
    ]

    return {'conversations': conversations}


def lambda_handler(event, context):
    options_response = lambda_utils.handle_options(event)
    if options_response:
        return options_response

    try:
        auth = auth_context.get_auth_context(event)
        result = main(auth.user_id)
        return lambda_utils.success_response(result)

    except auth_context.AuthContextError as e:
        return lambda_utils.unauthorized(str(e))
    except Exception as e:
        print(f"Error listing conversations: {str(e)}")
        return lambda_utils.server_error(str(e))
