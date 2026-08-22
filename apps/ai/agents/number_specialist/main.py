"""Number Specialist — an A2A subagent on Bedrock AgentCore Runtime.

This is the first member of the chat orchestrator's A2A subagent fleet. Like the
chat agent, it ships as a zip "direct code deployment" (ARM64 deps + sources zipped
by apps/ai/agents/build_agent.sh, pulled from S3 via code_configuration) rather than
a container, while keeping protocol_configuration { server_protocol = "A2A" }.
AgentCore runs main.py as the entry point, which starts an A2A server on
0.0.0.0:9000 at `/`, advertising an agent card at `/.well-known/agent-card.json`. We
get that wiring from `bedrock_agentcore.runtime.serve_a2a`. The 0.0.0.0 bind is
forced with the DOCKER_CONTAINER=1 runtime env var (serve_a2a otherwise binds
0.0.0.0 only when it detects a container).

Tools come from the SAME AgentCore Gateway the chat agent uses (an MCP server over
streamable HTTP, GATEWAY_URL). Rather than bind a fixed tool, we attach the *whole*
gateway per request so tools are auto-discovered — exactly like the chat agent.

Auth splits by direction. INBOUND: the orchestrator's A2A call carries the user's
Cognito token, which this runtime's front-door JWT authorizer validates and strips — it
never reaches this code. OUTBOUND: to reach the gateway we mint our OWN token via
AgentCore Identity (M2M client-credentials), keyed off the WorkloadAccessToken AgentCore
injects into the container. No forwarded user token, no custom header — the earlier
passthrough was abandoned because AgentCore does not reliably forward `X-Amzn-...-Custom-*`
headers into an A2A container, and a replayed user token expires mid-chain.

The agent card's name/description/skills are what the orchestrator discovers and
reasons over when deciding whether to delegate — so keep them descriptive.

Execution is traced with `_log(...)` (prefixed, flushed) at every key step so the
A2A flow is visible in CloudWatch: startup → per-request token/gateway/tool/stream.
Secrets are never logged — only token *lengths* and credential *presence*.
"""

import os
import traceback

from a2a.types import AgentCapabilities, AgentCard, AgentSkill
from bedrock_agentcore.runtime import serve_a2a
from bedrock_agentcore.identity.auth import requires_access_token
from mcp.client.streamable_http import streamablehttp_client
from strands import Agent
from strands.models import BedrockModel
from strands.multiagent.a2a.executor import StrandsA2AExecutor
from strands.tools.mcp.mcp_client import MCPClient

# region Configuration

MODEL_ID = "global.anthropic.claude-sonnet-4-6"

AGENT_NAME = "number_specialist"
AGENT_DESCRIPTION = (
    "Specialist agent for random numbers. Generates random integers on request "
    "using a shared tool, and can produce several at once or within a range by "
    "calling the tool repeatedly. Delegate any 'give me a random number' style "
    "task to this agent."
)
SYSTEM_PROMPT = (
    "You are the number specialist. Your job is to produce random numbers for the "
    "caller using the available random-number tool. Call the tool as many times as "
    "needed (e.g. once per number requested), then reply with just the number(s) and "
    "a one-line explanation. Do not invent numbers — always use the tool. If the tool "
    "is unavailable, say so plainly."
)

# Region this subagent invokes Bedrock in — the runtime's own region (AgentCore injects
# AWS_REGION). Bedrock is invoked directly with the runtime's in-account execution role.
BEDROCK_REGION = os.environ.get("AWS_REGION", "ap-southeast-2")

# MCP endpoint of the shared AgentCore Gateway (set by Terraform in ai_agents.tf).
GATEWAY_URL = os.environ.get("GATEWAY_URL")

# AgentCore Identity (M2M) outbound auth for the gateway — same provider/scopes the
# chat agent uses (set by Terraform in ai_agents.tf). Unset → gateway is skipped.
GATEWAY_CREDENTIAL_PROVIDER = os.environ.get("GATEWAY_CREDENTIAL_PROVIDER")
GATEWAY_SCOPES = os.environ.get("GATEWAY_SCOPES", "").split()

# endregion

# region Logging


def _log(message: str) -> None:
    """Emit a debug line to stdout.

    `flush=True` matters in a container: stdout is block-buffered when not a TTY, so
    without it these lines can sit unflushed and never reach CloudWatch until the
    buffer fills (or never, on a crash). The `[number_specialist]` prefix makes the
    subagent's lines easy to filter from the orchestrator's in shared logs.
    """
    print(f"[number_specialist] {message}", flush=True)


def _preview_blocks(content_blocks: list) -> str:
    """Best-effort, truncated preview of the inbound prompt text for debugging."""
    texts = []
    for block in content_blocks:
        text = block.get("text") if isinstance(block, dict) else getattr(block, "text", None)
        if text:
            texts.append(text)
    joined = " ".join(texts)
    return (joined[:200] + "…") if len(joined) > 200 else joined


# endregion

# region Bedrock + gateway (shared shape with ai/agents/chat/main.py)


async def gateway_access_token() -> str | None:
    """Mint an M2M access token for the shared gateway via AgentCore Identity.

    Uses the OAuth2 client-credentials credential provider (GATEWAY_CREDENTIAL_PROVIDER),
    keyed off the WorkloadAccessToken AgentCore injects into this container — so the
    gateway sees the subagent's own machine identity, not a replayed user token. Returns
    None when unconfigured so the gateway is simply skipped. Mirrors the chat agent's
    helper. Replaces the old `_forwarded_bearer()` header-reading approach, which never
    worked: AgentCore doesn't forward our custom header into the A2A container.
    """
    if not GATEWAY_CREDENTIAL_PROVIDER:
        _log("token: GATEWAY_CREDENTIAL_PROVIDER not set — gateway will be skipped")
        return None

    @requires_access_token(
        provider_name=GATEWAY_CREDENTIAL_PROVIDER,
        scopes=GATEWAY_SCOPES,
        auth_flow="M2M",
        into="access_token",
    )
    async def _fetch(*, access_token: str = "") -> str:
        return access_token

    token = await _fetch()
    _log(f"token: minted M2M gateway token (length={len(token) if token else 0})")
    return token


def build_gateway_client(access_token: str | None) -> MCPClient | None:
    """Build an MCP client for the shared AgentCore Gateway, or None if unusable.

    Identical shape to ai/agents/chat/main.py: connect over streamable HTTP,
    authenticating with the subagent's OWN M2M gateway token (see gateway_access_token),
    NOT a forwarded user token. Built fresh per request.
    """
    if not GATEWAY_URL:
        _log("gateway: GATEWAY_URL not set — running without gateway tools")
        return None
    if not access_token:
        _log("gateway: no gateway token — running without gateway tools")
        return None

    _log(f"gateway: building MCP client for {GATEWAY_URL}")
    return MCPClient(
        lambda: streamablehttp_client(
            GATEWAY_URL,
            headers={"Authorization": f"Bearer {access_token}"},
        )
    )


def build_agent(tools: list) -> Agent:
    """Build the specialist Strands agent with the given tools.

    The Bedrock model is invoked directly with the runtime's in-account execution role
    credentials. The agent is stateless (no session_manager) — A2A context isolation is
    handled by the executor, and the orchestrator owns the conversation/memory.
    """
    _log(f"agent: building Strands agent (model={MODEL_ID}, tools={len(tools)})")
    model = BedrockModel(
        model_id=MODEL_ID,
        region_name=BEDROCK_REGION,
    )
    return Agent(
        name=AGENT_NAME,
        description=AGENT_DESCRIPTION,
        model=model,
        tools=tools,
        system_prompt=SYSTEM_PROMPT,
    )


# endregion

# region A2A executor — attach the whole gateway per request


class GatewayBackedExecutor(StrandsA2AExecutor):
    """A StrandsA2AExecutor that opens the shared MCP gateway per request and attaches
    all of its tools to a freshly-built agent.

    We override `_run_with_context_agent` (the factory-mode execution seam) instead of
    using the constructor's agent_factory, because tools must be loaded inside a live
    MCP session that stays open across the awaited stream — a one-shot factory agent
    can't hold that session. The factory passed to the constructor only satisfies its
    "exactly one of agent/agent_factory" check; it is never invoked on this path.
    """

    async def _run_with_context_agent(
        self, context_id, content_blocks, invocation_state, updater, stream_state
    ) -> None:
        _log(
            f"invoke: context_id={context_id} blocks={len(content_blocks)} "
            f"prompt_preview={_preview_blocks(content_blocks)!r}"
        )
        token = await gateway_access_token()
        mcp = build_gateway_client(token)

        if mcp is not None:
            streaming_started = False
            try:
                # The MCP session must stay open across the awaited stream so tool
                # calls work mid-turn (same idiom as ai/agents/chat/main.py).
                _log("gateway: opening MCP session")
                with mcp:
                    tools = mcp.list_tools_sync()
                    tool_names = [getattr(t, "tool_name", getattr(t, "name", "?")) for t in tools]
                    _log(f"gateway: loaded {len(tools)} tool(s): {tool_names}")
                    agent = build_agent(tools)
                    streaming_started = True
                    _log("stream: starting agent response (with gateway tools)")
                    await self._stream_agent(
                        agent, content_blocks, invocation_state, updater, stream_state
                    )
                _log("stream: completed (with gateway tools)")
                return
            except Exception as e:
                # Once streaming has begun we can't safely restart — re-raise so the
                # executor marks the A2A task failed. A failure before the first chunk
                # (e.g. gateway unreachable) degrades to a no-tools run below.
                if streaming_started:
                    _log(f"stream: FAILED mid-stream, re-raising: {type(e).__name__}: {e}")
                    _log(traceback.format_exc())
                    raise
                _log(
                    f"gateway: unavailable before streaming, falling back to no tools: "
                    f"{type(e).__name__}: {e}"
                )
                _log(traceback.format_exc())

        # No gateway/token, or connect failed before streaming.
        _log("stream: starting agent response (no tools)")
        await self._stream_agent(
            build_agent([]), content_blocks, invocation_state, updater, stream_state
        )
        _log("stream: completed (no tools)")


def build_card() -> AgentCard:
    """Build the agent card the orchestrator discovers.

    The `url` below is a local-testing placeholder. When deployed, AgentCore Runtime
    injects AGENTCORE_RUNTIME_URL (the real invocation URL) into the container, and
    serve_a2a overrides the served card's `url` to it — so the card the orchestrator
    fetches advertises the correct URL, which the A2A client then POSTs to. Do NOT set
    AGENTCORE_RUNTIME_URL yourself (the platform provides it; and a runtime can't
    self-reference its own ARN at creation time anyway).
    """
    _log("card: building agent card (name=number_specialist, skill=random_number)")
    return AgentCard(
        name=AGENT_NAME,
        description=AGENT_DESCRIPTION,
        url="http://0.0.0.0:9000/",
        version="0.1.0",
        capabilities=AgentCapabilities(streaming=True),
        skills=[
            AgentSkill(
                id="random_number",
                name="random_number",
                description=(
                    "Generate one or more random integers (1-100) via a shared tool. "
                    "Use for any request that asks for a random number, dice roll, or "
                    "random pick."
                ),
                tags=["random", "number", "rng"],
            )
        ],
        default_input_modes=["text"],
        default_output_modes=["text"],
    )


# endregion

if __name__ == "__main__":
    # serve_a2a serves the A2A protocol at `/` on port 9000. It binds 0.0.0.0 only
    # when it detects a container (/.dockerenv or DOCKER_CONTAINER); in this direct
    # code deployment there is no container, so the runtime sets DOCKER_CONTAINER=1
    # (see infra/terraform/ai_agents.tf / NumberSpecialist.ts) to force that bind.
    # enable_a2a_compliant_streaming=True emits spec-conformant artifact updates that
    # the orchestrator's A2A client consumes (and silences the legacy-mode warning).
    _log(
        f"startup: gateway_url={'set' if GATEWAY_URL else 'UNSET'} "
        f"region={BEDROCK_REGION} model={MODEL_ID} "
        f"docker_container={os.environ.get('DOCKER_CONTAINER', 'unset')}"
    )
    _log("startup: starting A2A server on 0.0.0.0:9000")
    serve_a2a(
        GatewayBackedExecutor(
            agent_factory=lambda context_id: build_agent([]),
            enable_a2a_compliant_streaming=True,
        ),
        agent_card=build_card(),
        port=9000,
    )
