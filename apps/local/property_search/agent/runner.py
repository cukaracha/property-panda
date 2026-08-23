"""Run one chat turn on the user's own Claude subscription.

`claude-agent-sdk` drives the `claude` CLI, and the token saved on the profile page is
what it runs as. That token is passed through `options.env` rather than the process
environment, so it is scoped to the one child process that needs it and never leaks
into the scraper's Chrome or anything else this server spawns.

The agent is deliberately small. It has the page context, the page's own actions, and
two web tools; every filesystem and shell built-in is denied, because nothing here
needs to read this machine and an assistant that could would be a much larger thing to
reason about. A `PreToolUse` hook makes that explicit rather than implicit: there is no
one to answer a permission prompt in a background thread, so the hook returns an
outright allow or deny and no call ever blocks waiting for input.
"""

import os
from typing import Any, AsyncGenerator

from claude_agent_sdk import ClaudeAgentOptions, HookMatcher, query

from .act_parser import ActParser
from .format_prompt import PROMPTS
from .stream_map import StreamMapper

# An alias rather than a pinned id: the CLI resolves it to whichever model the
# subscription currently offers, which is what keeps this working without edits.
MODEL = os.environ.get("CHAT_MODEL", "sonnet")

# A page question is a handful of searches at most. High enough not to cut off a
# genuine multi-step answer, low enough to bound a turn that has gone wrong.
MAX_TURNS = 40

# The web tools survive the move off Bedrock: they were two Lambda tool targets on the
# MCP gateway before, and they are built into the SDK now.
ALLOWED_TOOLS = ["WebSearch", "WebFetch"]

# Everything the agent must never reach. The page context is what it answers from, so
# filesystem and shell access could only take it somewhere it has no business being;
# the built-in to-do list would compete with its own sequencing, and the fan-out tools
# would spawn agents this permission model says nothing about.
DISALLOWED_BUILTINS = [
    "Bash",
    "Read",
    "Write",
    "Edit",
    "MultiEdit",
    "NotebookEdit",
    "NotebookRead",
    "Glob",
    "Grep",
    "TodoWrite",
    "Workflow",
    "Task",
    "Agent",
]


async def _pre_tool_guard(
    hook_input: dict, _tool_use_id: str | None, _context: Any
) -> dict:
    """Allow the two web tools, deny everything else, explicitly."""
    tool_name = hook_input.get("tool_name", "")
    allowed = tool_name in ALLOWED_TOOLS
    return {
        "hookSpecificOutput": {
            "hookEventName": "PreToolUse",
            "permissionDecision": "allow" if allowed else "deny",
            "permissionDecisionReason": (
                "" if allowed else f"{tool_name} is not available to this assistant"
            ),
        }
    }


def build_options(token: str, workspace: str) -> ClaudeAgentOptions:
    return ClaudeAgentOptions(
        model=MODEL,
        system_prompt=PROMPTS["system"],
        allowed_tools=ALLOWED_TOOLS,
        disallowed_tools=DISALLOWED_BUILTINS,
        # Ignore any ambient Claude settings on this machine, so the assistant behaves
        # the same here as it would anywhere else.
        setting_sources=[],
        # The answer reaches the browser a word at a time rather than landing whole
        # when the model finishes writing it.
        include_partial_messages=True,
        # The reasoning the thinking card shows. `display` is the load-bearing half:
        # without it a signature comes back and no text. Adaptive rather than a fixed
        # budget, so a one-line answer does not pay for a researched one.
        thinking={"type": "adaptive", "display": "summarized"},
        cwd=workspace,
        max_turns=MAX_TURNS,
        hooks={"PreToolUse": [HookMatcher(hooks=[_pre_tool_guard])]},
        env={
            "CLAUDE_CODE_OAUTH_TOKEN": token,
            "HOME": workspace,
            "CLAUDE_CONFIG_DIR": f"{workspace}/.claude",
        },
    )


async def stream_turn(
    prompt: str, token: str, workspace: str
) -> AsyncGenerator[dict, None]:
    """Yield one turn's worth of browser-facing events.

    Two stages: the mapper turns SDK messages into events, and the parser splits the
    text ones into prose and proposed actions. Anything that is not text interrupts
    the prose, so the parser is drained first and the ordering the user sees matches
    the order things actually happened.
    """
    os.makedirs(f"{workspace}/.claude", exist_ok=True)

    mapper = StreamMapper()
    parser = ActParser()

    async for message in query(prompt=prompt, options=build_options(token, workspace)):
        for event in mapper.consume(message):
            if event["type"] == "text":
                for out in parser.feed(event["content"]):
                    yield out
                continue
            for out in parser.flush():
                yield out
            yield event

    for out in parser.flush():
        yield out
