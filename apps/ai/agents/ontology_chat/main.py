"""AgentCore entrypoint for the ontology chat agent.

Answers questions about one finished ontology. The browser invokes this runtime
directly with a Cognito access token, exactly as it invokes the chat agent, and reads
the answer back over SSE — there is no API Gateway route and no Lambda in the path.

Unlike the build agent, this one streams. A graph walk can take a minute and the walk
itself is most of what makes the answer trustworthy, so every dispatch, search and
page read goes back to the browser as it happens rather than being reduced to a trail
on a job row.

Three things are settled before a single tool exists. The caller's `sub` comes from
the verified bearer token, never the payload. The build is loaded and checked against
that sub, so a build id the caller may not read is refused before any prefix is
derived from it — and where they may read it, the row's own owner is what the prefix
and the vector filter are then derived from, because a published ontology is searched
where it already lives rather than copied to the reader. And the caller's own Claude
token is resolved per email from the shared secret and passed through `options.env`,
so every question consumes the subscription of the person who asked it.

The conversation itself lives in AgentCore Memory, keyed by the `conversationId` the
browser sends. Prior turns are read back from there rather than replayed in the
request body, so a reload resumes a conversation instead of losing it — and so the
words presented to the orchestrator as its own are words it actually said.
"""

import json
import logging
import os
import sys
import traceback
import uuid
from typing import AsyncGenerator

import boto3
from bedrock_agentcore.runtime import BedrockAgentCoreApp
from claude_agent_sdk import query

import memory
from identity import IdentityError, user_sub_from_headers
from roles import load_prompts
from sdk_options import build_options
from stream_map import StreamMapper
from tools.context import ChatContext
from tools.store import BuildStore

JOB_TABLE = os.environ.get('JOB_TABLE', '')
CLAUDE_TOKENS_SECRET = os.environ.get('CLAUDE_TOKENS_SECRET', '')
GOLD_BUCKET_NAME = os.environ.get('GOLD_BUCKET_NAME', '')
VECTOR_BUCKET = os.environ.get('VECTOR_BUCKET', '')
VECTOR_INDEX = os.environ.get('VECTOR_INDEX', '')
REGION = os.environ.get('AWS_REGION', 'us-east-1')
WORKSPACE_ROOT = os.environ.get('WORKSPACE_ROOT', '/tmp/ontology_chat')

# Container stdout is block-buffered, and a traceback that never reaches CloudWatch
# would make a failed answer look like a silent one.
logging.basicConfig(level=logging.INFO, stream=sys.stdout)

app = BedrockAgentCoreApp()

_PROMPTS = load_prompts()

# How many prior turns to read back out of Memory. A conversation can outlive any
# number of sessions, so this bounds what a very long one costs the orchestrator
# before it has read a single page.
HISTORY_TURNS = 12


def parse_payload(payload) -> dict:
    """Pull the build, the question, and the conversation id out of the payload."""
    if isinstance(payload, str):
        payload = json.loads(payload)
    if isinstance(payload, dict) and isinstance(payload.get('input'), dict):
        payload = payload['input']

    if not isinstance(payload, dict):
        raise ValueError('payload must be an object')

    build_id = (payload.get('buildId') or '').strip()
    question = (payload.get('question') or payload.get('prompt') or '').strip()
    if not build_id or not question:
        raise ValueError("payload must carry 'buildId' and 'question'")

    conversation_id = (payload.get('conversationId') or '').strip()

    return {
        'build_id': build_id,
        'question': question,
        'conversation_id': conversation_id,
    }


def _load_build(build_id: str, user_sub: str) -> dict:
    """A build row the caller may read, or None if it is not one or does not exist.

    That is their own build, or any build its owner has published. A published
    ontology is read exactly where it already sits, so what this returns is also what
    resolves the layout: `userId` on the row is the sub every prefix and every vector
    filter downstream is built from.
    """
    item = boto3.resource('dynamodb', region_name=REGION).Table(JOB_TABLE).get_item(
        Key={'jobId': build_id}
    ).get('Item')
    if not item:
        return None
    if item.get('userId') != user_sub and item.get('visibility') != 'published':
        return None
    return item


def _resolve_token(email: str):
    """Read the caller's Claude subscription token from the shared secret.

    The secret maps each email to a {token, updatedAt} entry, the shape the profile
    endpoint writes. A question consumes the caller's own subscription, so a missing
    entry is a clear, recoverable failure rather than a fallback to a shared
    credential.
    """
    client = boto3.client('secretsmanager', region_name=REGION)
    raw = client.get_secret_value(SecretId=CLAUDE_TOKENS_SECRET)['SecretString']
    entry = json.loads(raw).get(email) or {}
    return entry.get('token')


def _compose_prompt(build: dict, question: str, history: list, index_status: str) -> str:
    prompt = (
        f"Ontology: {build.get('title') or '(untitled)'}\n"
        f"Build id: {build['jobId']}\n"
    )
    documents = build.get('docNames') or []
    if documents:
        listed = '\n'.join(f"  - {name}" for name in documents)
        prompt += f"Documents ({len(documents)}):\n{listed}\n"
    if index_status == 'failed':
        prompt += (
            '\nIndexing failed for this ontology, so it cannot be searched, though '
            'build_overview still works. Say that it needs rebuilding, and do not '
            'dispatch a search.\n'
        )
    elif index_status != 'ready':
        prompt += (
            f"\nThe page index for this ontology is '{index_status}', so a search "
            'cannot return anything yet. Do not dispatch one. Say the ontology is '
            'still being indexed and that searching will work shortly.\n'
        )
    if history:
        turns = '\n\n'.join(f"{turn['role']}: {turn['content']}" for turn in history)
        prompt += f"\n## Conversation so far\n\n{turns}\n"
    prompt += f"\n## The question\n\n{question}\n"
    return prompt


@app.entrypoint
async def invoke(payload, context) -> AsyncGenerator[dict, None]:
    """Answer one question, streaming the search as it happens."""
    try:
        user_sub = user_sub_from_headers(getattr(context, 'request_headers', None))
        request = parse_payload(payload)
    except (IdentityError, ValueError) as error:
        yield {'type': 'error', 'content': str(error)}
        return

    build = _load_build(request['build_id'], user_sub)
    if build is None:
        # Same wording an unknown build gets: answering "that exists but is not
        # yours" would turn this into a way to probe for other users' builds.
        yield {'type': 'error', 'content': 'That ontology could not be found.'}
        return

    if build.get('status') not in ('succeeded', 'partial'):
        yield {
            'type': 'error',
            'content': 'That ontology has not finished building yet.',
        }
        return

    token = _resolve_token(build.get('email', ''))
    if not token:
        yield {
            'type': 'error',
            'content': (
                'This account has no Claude token, so the ontology cannot be searched. '
                'Save one on the profile page and ask again.'
            ),
        }
        return

    session_id = getattr(context, 'session_id', None) or request['build_id']
    workspace = f"{WORKSPACE_ROOT}/{session_id}"
    os.makedirs(f"{workspace}/.claude", exist_ok=True)

    # Two different ids doing two different jobs. The runtime session id above governs
    # container and workspace affinity and has AgentCore's own lifecycle rules;
    # conversation_id governs the transcript, so resuming a two-week-old conversation
    # does not depend on those.
    conversation_id = memory.sanitize_id(request['conversation_id'] or str(uuid.uuid4()))
    actor = memory.actor_for(user_sub, request['build_id'])

    history = []
    if memory.enabled():
        # Best-effort on both sides: a memory outage costs this turn its history, not
        # its answer.
        try:
            history = memory.load_turns(conversation_id, actor, HISTORY_TURNS * 2)
        except Exception:  # noqa: BLE001 - memory is never load-bearing
            print(traceback.format_exc(), flush=True)
        try:
            memory.record_message(conversation_id, actor, 'USER', request['question'])
        except Exception:  # noqa: BLE001
            print(traceback.format_exc(), flush=True)

    ctx = ChatContext(
        request['build_id'],
        user_sub,
        build.get('title', ''),
        owner_sub=build.get('userId') or user_sub,
        gold_bucket=GOLD_BUCKET_NAME,
        vector_bucket=VECTOR_BUCKET,
        vector_index=VECTOR_INDEX,
        region=REGION,
    )
    # One store for the whole question: every role's tools read through it, and the
    # mapper borrows it to name a page in the trail without a second load of the graph.
    store = BuildStore(ctx)
    options = build_options(store, _PROMPTS, token, workspace)
    mapper = StreamMapper(label_for=store.page_label)
    prompt = _compose_prompt(
        build, request['question'], history, build.get('indexStatus') or 'pending'
    )

    print(f"[ontology-chat] answering on build {request['build_id']}", flush=True)

    answer_parts = []
    try:
        async for message in query(prompt=prompt, options=options):
            for event in mapper.consume(message):
                if event['type'] == 'message':
                    answer_parts.append(event['content'])
                yield event
    except Exception as error:  # noqa: BLE001 - the request boundary must catch everything
        print(traceback.format_exc(), flush=True)
        yield {'type': 'error', 'content': f"{type(error).__name__}: {error}"}
    finally:
        # In `finally`, not on the success path: a turn the user partly saw — a client
        # disconnect, an exhausted turn budget, a mid-stream failure — still belongs in
        # the transcript. Nothing here yields, which is what makes it legal under the
        # GeneratorExit a disconnect raises.
        answer = '\n\n'.join(answer_parts).strip()
        if memory.enabled() and answer:
            try:
                memory.record_message(conversation_id, actor, 'ASSISTANT', answer)
            except Exception:  # noqa: BLE001
                print(traceback.format_exc(), flush=True)


if __name__ == '__main__':
    app.run()
