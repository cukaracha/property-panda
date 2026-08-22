"""Chat Agent — Strands agent with AgentCore Memory integration.

Tools come from an AgentCore Gateway (an MCP server over streamable HTTP). The
gateway URL is injected as GATEWAY_URL; the agent authenticates to it with its
OWN token, minted via AgentCore Identity (M2M client-credentials) — NOT the
user's token. Auth splits by direction: the user's Cognito token authenticates
the inbound call into this runtime (front-door JWT authorizer) and the outbound
A2A call to subagents; the gateway (outbound) gets a dedicated M2M token via
`gateway_access_token`. When the gateway is unconfigured or can't be reached
before streaming begins, the agent falls back to running with no tools so chat
still works.
"""

import os
import json
import boto3
from typing import AsyncGenerator

from strands import Agent
from strands.models import BedrockModel
from strands.tools.mcp.mcp_client import MCPClient
from mcp.client.streamable_http import streamablehttp_client
from bedrock_agentcore.runtime import BedrockAgentCoreApp
from bedrock_agentcore.identity.auth import requires_access_token

from agent_memory import create_session_manager
from format_prompt import build_enriched_prompt, PROMPTS
from stream_parser import StreamParser

# region Configuration

MODEL_ID = "global.anthropic.claude-sonnet-4-6"
SYSTEM_PROMPT = PROMPTS["base_do_not_change"]

# Region the agent invokes Bedrock in — the runtime's own region (AgentCore injects
# AWS_REGION). Bedrock is invoked directly with the runtime's in-account execution role.
BEDROCK_REGION = os.environ.get("AWS_REGION", "ap-southeast-2")

# MCP endpoint of the AgentCore Gateway (set by Terraform in ai_agents.tf).
GATEWAY_URL = os.environ.get("GATEWAY_URL")

# AgentCore Identity (M2M) outbound auth for the gateway. GATEWAY_CREDENTIAL_PROVIDER
# is the OAuth2 credential provider name; GATEWAY_SCOPES the space-separated scopes to
# request. Set by Terraform in ai_agents.tf; unset → no M2M token (gateway skipped).
GATEWAY_CREDENTIAL_PROVIDER = os.environ.get("GATEWAY_CREDENTIAL_PROVIDER")
GATEWAY_SCOPES = os.environ.get("GATEWAY_SCOPES", "").split()

# SSM Parameter Store path that registers the A2A subagent fleet. Each subagent's
# Terraform writes one parameter (= its runtime ARN) under this path; the chat agent
# (orchestrator) reads the path per request to auto-discover subagents. Set by
# Terraform in ai_agents.tf; unset → no subagents (chat still works).
SUBAGENT_REGISTRY_PATH = os.environ.get("SUBAGENT_REGISTRY_PATH")

# endregion

# region Utilities


def parse_payload(payload: dict | str) -> tuple[str, str, str, str, str, list, str]:
    """Parse payload and extract prompt, actor_id, session_id, topic_id, page_context, actions, bearer_token.

    Handles two formats:
    - Direct: {"prompt": "...", "actor_id": "...", "session_id": "...", "topic_id": "...", "page_context": "...", "actions": [...]}
    - AWS SDK: {"input": {"prompt": "...", ...}}
    """
    if isinstance(payload, str):
        payload = json.loads(payload)

    # AWS SDK wraps payload in "input" field
    if isinstance(payload, dict) and "input" in payload and isinstance(payload["input"], dict):
        payload = payload["input"]

    prompt = payload.get("prompt") if isinstance(payload, dict) else None
    if not prompt:
        raise ValueError(
            f"No prompt found. Expected {{'prompt': '...'}} or {{'input': {{'prompt': '...'}}}}. "
            f"Received: {payload}"
        )

    actor_id = payload.get("actor_id", "anonymous")
    session_id = payload.get("session_id", "default")
    topic_id = payload.get("topic_id", "")
    page_context = payload.get("page_context", "")
    actions = payload.get("actions", [])
    bearer_token = payload.get("bearer_token", "")

    return prompt, actor_id, session_id, topic_id, page_context, actions, bearer_token


# endregion

# region Agent Factory

app = BedrockAgentCoreApp()


def create_agent(actor_id: str, session_id: str, tools: list) -> Agent:
    """Create an agent instance with memory session manager and the given tools.

    The Bedrock model is invoked directly with the runtime's in-account execution role
    credentials; AgentCore Memory uses the same role.
    """
    session_manager = create_session_manager(session_id, actor_id)

    model = BedrockModel(
        model_id=MODEL_ID,
        region_name=BEDROCK_REGION,
        additional_request_fields={
            "anthropic_beta": ["interleaved-thinking-2025-05-14"],
            "thinking": {
                "type": "enabled",
                "budget_tokens": 2000,
            },
        },
    )

    return Agent(
        model=model,
        tools=tools,
        system_prompt=SYSTEM_PROMPT,
        session_manager=session_manager,
    )


async def gateway_access_token() -> str | None:
    """Mint an M2M access token for the MCP gateway via AgentCore Identity.

    Uses the OAuth2 client-credentials credential provider (GATEWAY_CREDENTIAL_PROVIDER),
    keyed off the WorkloadAccessToken AgentCore injects for this runtime — so the gateway
    sees the agent's own machine identity, not a replayed user token. Returns None when
    unconfigured (e.g. local dev) so the gateway is simply skipped.
    """
    if not GATEWAY_CREDENTIAL_PROVIDER:
        return None

    @requires_access_token(
        provider_name=GATEWAY_CREDENTIAL_PROVIDER,
        scopes=GATEWAY_SCOPES,
        auth_flow="M2M",
        into="access_token",
    )
    async def _fetch(*, access_token: str = "") -> str:
        return access_token

    return await _fetch()


def build_gateway_client(access_token: str | None) -> MCPClient | None:
    """Build an MCP client for the AgentCore Gateway, or None if it can't be used.

    Connects over streamable HTTP, authenticating with the agent's OWN gateway token
    (minted via AgentCore Identity M2M — see gateway_access_token), NOT a forwarded
    user token. Built fresh per request so a fresh token is used and nothing is shared
    across calls.
    """
    if not GATEWAY_URL or not access_token:
        return None

    return MCPClient(
        lambda: streamablehttp_client(
            GATEWAY_URL,
            headers={"Authorization": f"Bearer {access_token}"},
        )
    )


# endregion

# region A2A subagent fleet (auto-discovered via the SSM registry)


def discover_subagent_urls() -> list[str]:
    """Read the SSM registry and return the A2A invocation URL of each subagent.

    Each subagent's Terraform writes one parameter under SUBAGENT_REGISTRY_PATH whose
    value is the subagent's AgentCore runtime ARN. We turn each ARN into the runtime's
    A2A invocation URL (with a trailing slash — build_runtime_url omits it, and the A2A
    card resolver expects base + "/.well-known/agent-card.json"). Read with the chat
    agent's own in-account execution-role credentials, NOT the cross-account relay
    session. A new subagent appears here on the next turn with no orchestrator redeploy.
    """
    if not SUBAGENT_REGISTRY_PATH:
        return []

    from bedrock_agentcore.runtime import build_runtime_url

    ssm = boto3.client("ssm", region_name=BEDROCK_REGION)
    urls: list[str] = []
    paginator = ssm.get_paginator("get_parameters_by_path")
    for page in paginator.paginate(Path=SUBAGENT_REGISTRY_PATH, Recursive=True):
        for param in page["Parameters"]:
            arn = param["Value"]
            urls.append(build_runtime_url(arn).rstrip("/") + "/")
    return urls


def make_subagent_provider(bearer_token: str, session_id: str):
    """Build an A2AClientToolProvider over the discovered subagent fleet, or None.

    The provider fetches each subagent's agent card (discovery) and exposes the fleet
    as A2A tools (a2a_list_discovered_agents, a2a_send_message, …) the orchestrator LLM
    can call to delegate.

    This is the INBOUND auth to the subagent runtime: the user's Cognito access token
    rides on the `Authorization` header, which the subagent's front-door JWT authorizer
    validates and then strips (it never reaches subagent code). We deliberately do NOT
    forward the user token onward — the subagent reaches the shared gateway with its OWN
    AgentCore Identity M2M token, so no `X-Amzn-...-Custom-*` passthrough is needed (and
    AgentCore wouldn't reliably forward it into an A2A container anyway). The session-id
    header keeps AgentCore session continuity. Returns None when no subagents registered.
    """
    urls = discover_subagent_urls()
    if not urls:
        return None

    from strands_tools.a2a_client import A2AClientToolProvider

    return A2AClientToolProvider(
        known_agent_urls=urls,
        httpx_client_args={
            "headers": {
                # Front-door JWT auth on the subagent runtime (consumed, then stripped).
                "Authorization": f"Bearer {bearer_token}",
                "X-Amzn-Bedrock-AgentCore-Runtime-Session-Id": session_id,
            },
            "timeout": 120,
        },
    )


# endregion

# region Entrypoint


async def _stream_agent(agent: Agent, prompt: str) -> AsyncGenerator[dict, None]:
    """Run the agent and yield structured stream events (tag-parsed)."""
    parser = StreamParser()
    seen_tool_ids: set[str] = set()

    async for event in agent.stream_async(prompt):

        if "data" in event and "reasoning" not in event:
            # TextStreamEvent — streamed text, feed through tag parser
            for parsed in parser.feed(event["data"]):
                yield parsed

        elif "reasoningText" in event:
            # ReasoningTextStreamEvent — native model reasoning
            for flushed in parser.flush():
                yield flushed
            yield {"type": "reasoning", "content": event["reasoningText"]}

        elif "current_tool_use" in event and event.get("current_tool_use", {}).get("name"):
            # ToolUseStreamEvent — deduplicate by toolUseId
            tool_use = event["current_tool_use"]
            tool_id = tool_use.get("toolUseId")
            if tool_id and tool_id not in seen_tool_ids:
                seen_tool_ids.add(tool_id)
                for flushed in parser.flush():
                    yield flushed
                # Gateway tools are prefixed "<target>___<tool>"; show the bare name.
                yield {"type": "tool", "content": tool_use["name"].split("___")[-1]}

        elif "force_stop" in event:
            for flushed in parser.flush():
                yield flushed
            yield {"type": "status", "content": "force_stop"}

        elif "result" in event:
            # AgentResultEvent — stream end
            for flushed in parser.flush():
                yield flushed
            yield {"type": "status", "content": "complete"}

        # Skip: init_event_loop, start_event_loop, message, event (raw chunks)


@app.entrypoint
async def agent_invocation(payload: dict | str) -> AsyncGenerator[dict, None]:
    """Invoke the agent with a payload and stream structured events.

    Every exception (bad payload, cross-account AssumeRole denial, Bedrock error,
    …) is caught and surfaced to the client as an `error` event carrying the
    traceback, rather than crashing the stream. Yielding instead of raising lets
    the SSE stream end cleanly so the UI finalizes the message and renders the
    error in a red debugging card.
    """
    actor_id, session_id = "unknown", "unknown"

    try:
        prompt, actor_id, session_id, topic_id, page_context, actions, bearer_token = parse_payload(payload)
        enriched_prompt = build_enriched_prompt(topic_id, page_context, actions, prompt)

        print(f"[DEBUG] Enriched prompt:\n{enriched_prompt}")

        # Auto-discover the A2A subagent fleet from the SSM registry and expose it as
        # tools the orchestrator LLM can delegate to. Best-effort: a registry hiccup or
        # an unreachable subagent degrades to "no subagents" rather than crashing the
        # turn (preserves the errors-are-events contract). Built once and merged into
        # both the gateway and no-gateway tool lists below.
        subagent_tools: list = []
        try:
            provider = make_subagent_provider(bearer_token, session_id)
            if provider is not None:
                subagent_tools = provider.tools
                print(f"[DEBUG] Discovered {len(subagent_tools)} subagent A2A tool(s)")
        except Exception as e:
            print(f"[WARN] Subagent discovery failed, continuing without subagents: {e}")

        # Outbound gateway auth: mint the agent's own M2M token (AgentCore Identity),
        # never the forwarded user token. None (unconfigured) → gateway is skipped.
        gateway_token = await gateway_access_token()
        mcp_client = build_gateway_client(gateway_token)
        started = False

        if mcp_client is not None:
            try:
                # Connect to the gateway and stream the whole turn inside the
                # client context so the MCP session stays open for tool calls.
                with mcp_client:
                    gateway_tools = mcp_client.list_tools_sync()
                    print(f"[DEBUG] Loaded {len(gateway_tools)} gateway tool(s)")
                    agent = create_agent(actor_id, session_id, gateway_tools + subagent_tools)
                    async for parsed in _stream_agent(agent, enriched_prompt):
                        started = True
                        yield parsed
                return
            except Exception as e:
                # Once streaming has started we can't safely restart — re-raise to
                # the outer handler so it surfaces as an error event. A failure
                # before the first yield falls through to a no-tools run.
                if started:
                    raise
                print(f"[WARN] Gateway tools unavailable, falling back to no tools: {e}")

        # No gateway configured, no token, or connect failed before streaming.
        # Subagent tools (if any) are still attached so delegation keeps working.
        agent = create_agent(actor_id, session_id, subagent_tools)
        async for parsed in _stream_agent(agent, enriched_prompt):
            yield parsed

    except Exception as e:
        import traceback

        tb = traceback.format_exc()
        print(f"[ERROR] Agent invocation failed: {e}")
        print(f"[ERROR] Context - actor_id: {actor_id}, session_id: {session_id}")
        print(tb)
        yield {"type": "error", "content": f"{type(e).__name__}: {e}\n\n{tb}"}


# endregion

if __name__ == "__main__":
    app.run()
