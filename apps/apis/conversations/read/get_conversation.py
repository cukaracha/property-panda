"""Replay a single past chat conversation for the authenticated user.

Proxies the AgentCore Memory data-plane: lists the events of one session on the
chat agent's memory (actor = Cognito sub), orders them, and normalizes them to a
flat [{role, content, timestamp}] transcript for display. Read-only. The actor is
always the verified Cognito claim, so a user can only replay their own sessions;
a foreign or unknown sessionId — or a brand-new actor with no events yet — simply
yields an empty transcript (no existence leak).

Strands' AgentCoreMemorySessionManager stores each turn's payload text as
json.dumps(SessionMessage.to_dict()) — a serialized message, not plain text — so
normalization parses that envelope and unwraps the human text: the inside of
<user_message> for user turns and of <message> for assistant turns (dropping the
page-context envelope and <act> tags), mirroring the live agent's stream_parser.

A single live assistant bubble spans several stored events (assistant reasoning /
answer / tool-use, then a tool-result user turn, then more assistant events), so
normalization groups each real user turn's following assistant and tool-result
events into one response and reconstructs its thinking-card workflow: a reasoning
step (native reasoningContent plus any out-of-tag text) and one tool step per
toolUse, matching the live view.
"""

import json
import os
import re

import boto3
from botocore.exceptions import ClientError
from aws_utils import lambda_utils, auth_context


agentcore_client = boto3.client('bedrock-agentcore')

# Valid characters for AgentCore Memory IDs. Kept byte-for-byte in lock-step with
# the chat agent's sanitize_id (apps/ai/agents/chat/agent_memory.py) and
# list_conversations.py so the ids queried here match the ones the agent stored
# events under. Cognito subs / client session UUIDs make this a no-op in practice.
_ID_PATTERN = re.compile(r'[^a-zA-Z0-9\-_/:]')

# Only conversational turns spoken by the user or the assistant are replayed;
# tool-use / tool-result blobs and TOOL/OTHER roles are dropped.
_ROLE_MAP = {'USER': 'user', 'ASSISTANT': 'assistant'}

# The agent wraps the real user text and its user-facing answer in these tags
# (see apps/ai/agents/chat/format_prompt.py and the base system prompt); match
# them case-insensitively across newlines, exactly as the live stream_parser does.
_USER_MESSAGE_RE = re.compile(r'<user_message>(.*?)</user_message>', re.IGNORECASE | re.DOTALL)
_MESSAGE_RE = re.compile(r'<message>(.*?)</message>', re.IGNORECASE | re.DOTALL)
_ACT_RE = re.compile(r'<act>.*?</act>', re.IGNORECASE | re.DOTALL)


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


def _parse_message(text):
    # conversational.content.text is json.dumps(SessionMessage.to_dict()); return
    # the inner message dict (role + content blocks). Defensive: treat non-JSON as
    # a single already-plain text block.
    try:
        return (json.loads(text) or {}).get('message') or {}
    except (json.JSONDecodeError, TypeError):
        return {'content': [{'text': text}]}


def _text_blocks(message):
    blocks = message.get('content') or []
    return '\n'.join(b['text'] for b in blocks if isinstance(b, dict) and b.get('text'))


def _user_text(message):
    # Strip the page-context envelope down to what the user actually typed. A
    # tool-result turn carries no text block, so this is empty for those.
    body = _text_blocks(message)
    found = _USER_MESSAGE_RE.findall(body)
    if found:
        return '\n'.join(m.strip() for m in found).strip()
    return body.strip()


def _assistant_answer(message):
    # Keep only <message> text, matching the live stream_parser.
    found = _MESSAGE_RE.findall(_text_blocks(message))
    return '\n\n'.join(m.strip() for m in found).strip()


def _assistant_reasoning(message):
    # Native reasoningContent blocks first, then any out-of-tag remainder of the
    # text blocks (reasoning the model wrote outside <message>/<act>), mirroring the
    # two reasoning sources the live stream_parser emits.
    parts = []
    for block in message.get('content') or []:
        if not isinstance(block, dict):
            continue
        reasoning = ((block.get('reasoningContent') or {}).get('reasoningText') or {}).get('text')
        if reasoning and reasoning.strip():
            parts.append(reasoning.strip())

    remainder = _ACT_RE.sub('', _MESSAGE_RE.sub('', _text_blocks(message))).strip()
    if remainder:
        parts.append(remainder)

    return '\n\n'.join(parts)


def _tool_names(message):
    names = []
    for block in message.get('content') or []:
        if not isinstance(block, dict):
            continue
        tool_use = block.get('toolUse')
        if tool_use and tool_use.get('name'):
            # Live sends the bare tool name (name.split('___')[-1]) — no args/result.
            names.append(tool_use['name'].split('___')[-1])
    return names


def normalize_events(events):
    messages = []
    pending = None  # assistant accumulator spanning one logical response

    def flush():
        nonlocal pending
        if pending is None:
            return
        content = '\n\n'.join(pending['content_parts']).strip()
        if content or pending['workflow']:
            message = {'role': 'assistant', 'content': content, 'timestamp': pending['timestamp']}
            if pending['workflow']:
                message['workflow'] = pending['workflow']
            messages.append(message)
        pending = None

    for event in events:
        timestamp = _iso(event.get('eventTimestamp'))
        event_id = event.get('eventId', '')
        for idx, item in enumerate(event.get('payload', []) or []):
            conversational = item.get('conversational')
            if not conversational:
                continue

            role = _ROLE_MAP.get(conversational.get('role'))
            if not role:
                continue

            text = (conversational.get('content') or {}).get('text', '')
            if not text:
                continue

            message = _parse_message(text)

            if role == 'user':
                content = _user_text(message)
                if not content:
                    # Tool-result turn — mid-response, so leave pending open.
                    continue
                flush()
                messages.append({'role': 'user', 'content': content, 'timestamp': timestamp})
                continue

            # Assistant turn: accumulate into the open response (open one if needed).
            if pending is None:
                pending = {'content_parts': [], 'workflow': [], 'timestamp': timestamp}

            reasoning = _assistant_reasoning(message)
            if reasoning:
                pending['workflow'].append({
                    'id': f'{event_id}-{idx}-r',
                    'type': 'reasoning',
                    'content': reasoning,
                    'timestamp': timestamp,
                })

            for n, name in enumerate(_tool_names(message)):
                pending['workflow'].append({
                    'id': f'{event_id}-{idx}-t{n}',
                    'type': 'tool',
                    'content': name,
                    'timestamp': timestamp,
                })

            answer = _assistant_answer(message)
            if answer:
                pending['content_parts'].append(answer)

    flush()
    return messages


def main(actor_id, session_id):
    memory_id = os.environ['MEMORY_ID']

    try:
        events = list_events(
            memory_id,
            sanitize_id(session_id, 'default'),
            sanitize_id(actor_id, 'anonymous'),
        )
    except ClientError as e:
        if e.response['Error']['Code'] != 'ResourceNotFoundException':
            raise
        # Brand-new actor (no events yet) — treated as an empty/new thread.
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
        session_id = path_params.get('sessionId')
        if not session_id:
            return lambda_utils.bad_request('sessionId path parameter is required')

        result = main(auth.user_id, session_id)
        return lambda_utils.success_response(result)

    except auth_context.AuthContextError as e:
        return lambda_utils.unauthorized(str(e))
    except Exception as e:
        print(f"Error getting conversation: {str(e)}")
        return lambda_utils.server_error(str(e))
