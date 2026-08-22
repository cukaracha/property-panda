"""List the authenticated user's past conversations about one ontology build.

Proxies the AgentCore Memory data-plane: lists the caller's sessions on the
ontology chat agent's memory and returns them newest-first as
{sessionId, createdAt}. Read-only.

The actor is a composite — "{sub}/{buildId}" — because ListSessions returns
nothing but session ids and start times, so scoping the list to one ontology has
to be built into the actor itself. The sub half always comes from the verified
Cognito claims, so a crafted buildId can only ever address an actor under the
caller's own sub, and a foreign build simply yields an empty list.
"""

import os
import re

import boto3
from botocore.exceptions import ClientError
from aws_utils import lambda_utils, auth_context


agentcore_client = boto3.client('bedrock-agentcore')

# Valid characters for AgentCore Memory IDs. Kept byte-for-byte in lock-step with
# the ontology chat agent's sanitize_id (apps/ai/agents/ontology_chat/memory.py)
# and get_ontology_conversation.py so the actor id queried here matches the one
# the agent stored events under.
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


def main(user_sub, build_id):
    memory_id = os.environ['MEMORY_ID']

    # Each half sanitized separately and joined — never sanitize("{sub}/{build}"),
    # which a crafted build id could use to escape the separator.
    actor_id = f"{sanitize_id(user_sub, 'anonymous')}/{sanitize_id(build_id, 'default')}"

    try:
        sessions = list_sessions(memory_id, actor_id)
    except ClientError as e:
        if e.response['Error']['Code'] != 'ResourceNotFoundException':
            raise
        # Nobody has asked this build a question yet, so Memory has no such actor.
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

        path_params = event.get('pathParameters') or {}
        build_id = path_params.get('jobId')
        if not build_id:
            return lambda_utils.bad_request('jobId path parameter is required')

        result = main(auth.user_id, build_id)
        return lambda_utils.success_response(result)

    except auth_context.AuthContextError as e:
        return lambda_utils.unauthorized(str(e))
    except Exception as e:
        print(f"Error listing ontology conversations: {str(e)}")
        return lambda_utils.server_error(str(e))
