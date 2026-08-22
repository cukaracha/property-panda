"""AgentCore Memory for the ontology chat agent.

Short-term events only: every turn is written as a plain conversational event and
read back as one. There are no memory strategies on the resource, so nothing is
summarized or extracted — what went in is what comes out.

Deliberately not `apps/ai/agents/chat/agent_memory.py`. That module builds a
Strands `AgentCoreMemorySessionManager`, which only works because the chat agent
IS a Strands agent; this one runs `claude_agent_sdk.query()`, which has no
session-manager concept, so the data plane is called directly. The upside is that
the stored payload is the answer's own text rather than a serialized Strands
envelope, which is why the replay Lambda needs no unwrapping.

Memory is best-effort and never load-bearing: nothing here raises on the caller's
behalf, so a memory outage costs the conversation its history, not its answer.
The memory resource is created and owned by the IaC; its id arrives as MEMORY_ID.
"""

import hashlib
import os
import re
from datetime import datetime, timezone

import boto3
from botocore.exceptions import ClientError

MEMORY_ID = os.environ.get('MEMORY_ID', '')
REGION = os.environ.get('AWS_REGION', 'us-east-1')

# Valid characters for AgentCore Memory IDs. Kept byte-for-byte in lock-step with
# the chat agent's sanitize_id (apps/ai/agents/chat/agent_memory.py) and the two
# ontology read Lambdas, so the ids written here match the ones queried there.
_ID_PATTERN = re.compile(r'[^a-zA-Z0-9\-_/:]')

# Ceilings on a replay. Pages, not turns, are what a long conversation costs the
# orchestrator, so this bounds the read itself as well as what reaches the prompt.
MAX_EVENT_PAGES = 5
HISTORY_CHARS = 24000

_ROLE_MAP = {'USER': 'user', 'ASSISTANT': 'assistant'}


def _client():
    return boto3.client('bedrock-agentcore', region_name=REGION)


def sanitize_id(value, default='default'):
    """Sanitize an ID to match AgentCore Memory regex pattern.

    Pattern: [a-zA-Z0-9][a-zA-Z0-9-_/]*(?::[a-zA-Z0-9-_/]+)*[a-zA-Z0-9-_/]*
    """
    if not value:
        return default

    sanitized = _ID_PATTERN.sub('_', value)

    if sanitized and not sanitized[0].isalnum():
        sanitized = 'u' + sanitized

    return sanitized or default


def enabled() -> bool:
    return bool(MEMORY_ID)


def actor_for(user_sub: str, build_id: str) -> str:
    """The actor a build's conversations live under: one caller, one ontology.

    ListSessions returns nothing but session ids and start times, so scoping the
    history picker to a single build has to be built into the actor itself. Each
    half is sanitized separately and joined with '/' — never
    sanitize(f"{sub}/{build}") — so a crafted build id cannot escape the '/' and
    address another caller's actor.
    """
    return f"{sanitize_id(user_sub, 'anonymous')}/{sanitize_id(build_id, 'default')}"


def load_turns(session_id: str, actor_id: str, max_messages: int) -> list:
    """The conversation so far, oldest first, in the shape _compose_prompt wants."""
    client = _client()
    events = []
    next_token = None

    for _ in range(MAX_EVENT_PAGES):
        params = {
            'memoryId': MEMORY_ID,
            'sessionId': session_id,
            'actorId': actor_id,
            # Mandatory — payloads come back empty otherwise.
            'includePayloads': True,
            'maxResults': 100,
        }
        if next_token:
            params['nextToken'] = next_token

        try:
            response = client.list_events(**params)
        except ClientError as e:
            if e.response['Error']['Code'] != 'ResourceNotFoundException':
                raise
            # The first turn of a conversation reads before it writes, so an
            # unknown session is the normal empty case rather than a failure.
            return []

        events.extend(response.get('events', []))

        next_token = response.get('nextToken')
        if not next_token:
            break

    # No ordering param on the API — sort locally by time, then id as a tiebreak.
    events.sort(key=lambda e: (e.get('eventTimestamp'), e.get('eventId', '')))

    turns = []
    for event in events:
        for item in event.get('payload', []) or []:
            conversational = item.get('conversational')
            if not conversational:
                continue
            role = _ROLE_MAP.get(conversational.get('role'))
            text = (conversational.get('content') or {}).get('text', '')
            if role and text:
                turns.append({'role': role, 'content': text})

    # Trim from the oldest end against both ceilings — a handful of long answers
    # can outweigh a great many short ones.
    turns = turns[-max_messages:]
    while turns and sum(len(turn['content']) for turn in turns) > HISTORY_CHARS:
        turns.pop(0)

    return turns


def record_message(session_id: str, actor_id: str, role: str, text: str) -> None:
    """Append one turn. `role` is USER or ASSISTANT, `text` is exactly what was said."""
    token = hashlib.sha256(f"{session_id}:{role}:{text}".encode()).hexdigest()[:32]
    _client().create_event(
        memoryId=MEMORY_ID,
        actorId=actor_id,
        sessionId=session_id,
        eventTimestamp=datetime.now(timezone.utc),
        # Deterministic, so an AgentCore retry of the same turn cannot double-write.
        clientToken=token,
        payload=[{'conversational': {'role': role, 'content': {'text': text}}}],
    )
