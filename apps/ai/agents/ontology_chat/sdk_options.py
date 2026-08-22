"""Assemble the SDK options for one question, and the hook that gates every tool call.

The orchestrator runs on Opus with the two search subagents as `agents`, reaching
their tools through one in-process MCP server per role. Three settings make the
scoping authoritative in a headless run:

- A `PreToolUse` hook allows only this build's tools (`mcp__onto_ask_*`) and the
  built-in dispatcher, and denies everything else. There is no user to answer a
  permission prompt here, so the hook returns an explicit allow or deny and nothing
  ever blocks waiting for input.
- Every filesystem and web built-in is disallowed. This agent reads S3 through its
  tools and nothing else; a `Bash` or `WebFetch` mid-answer would be a way around the
  tenancy prefix, not a convenience.
- `setting_sources=[]` ignores any ambient Claude settings, so an answer comes out the
  same in the container as it does anywhere else.

The caller's token is passed through `options.env`, never the process environment, so
concurrent questions from different users stay isolated and each one consumes the
subscription of the person who asked.
"""

from typing import Any

from claude_agent_sdk import ClaudeAgentOptions, HookMatcher

from roles import (
    DISPATCH_TOOLS,
    ORCHESTRATOR_MODEL,
    TOOL_SEARCH,
    build_roles,
    orchestrator_allowed_tools,
)
from tools.registry import build_servers
from tools.store import BuildStore

# A hard question dispatches a seeker, then several explorers per round, each
# spending a handful of turns inside its own dispatch. Generous enough that a wide
# frontier is not cut off mid-search.
MAX_TURNS = 400

# Built-in tools the agent must never reach. The primitives already cover everything
# a search needs, so filesystem and web access could only be used to step outside the
# owner's prefix; the built-in to-do list would compete with the orchestrator's own
# sequencing, and `Workflow` is a second fan-out mechanism that would sidestep the
# per-role scoping.
DISALLOWED_BUILTINS = [
    'Bash',
    'Read',
    'Write',
    'Edit',
    'MultiEdit',
    'NotebookEdit',
    'NotebookRead',
    'Glob',
    'Grep',
    'WebFetch',
    'WebSearch',
    'TodoWrite',
    'Workflow',
]


def _tool_is_allowed(tool_name: str) -> bool:
    return (
        tool_name in DISPATCH_TOOLS
        or tool_name == TOOL_SEARCH
        or tool_name.startswith('mcp__onto_ask_')
    )


async def _pre_tool_guard(
    hook_input: dict, _tool_use_id: str | None, _context: Any
) -> dict:
    """Allow this build's tools and the dispatcher, deny everything else, explicitly."""
    tool_name = hook_input.get('tool_name', '')
    allowed = _tool_is_allowed(tool_name)
    return {
        'hookSpecificOutput': {
            'hookEventName': 'PreToolUse',
            'permissionDecision': 'allow' if allowed else 'deny',
            'permissionDecisionReason': (
                '' if allowed else f"{tool_name} is not available to this agent"
            ),
        }
    }


def build_options(
    store: BuildStore, prompts: dict, token: str, workspace: str
) -> ClaudeAgentOptions:
    return ClaudeAgentOptions(
        model=ORCHESTRATOR_MODEL,
        system_prompt=prompts['orchestrator_system'],
        agents=build_roles(prompts),
        mcp_servers=build_servers(store),
        allowed_tools=orchestrator_allowed_tools(),
        disallowed_tools=DISALLOWED_BUILTINS,
        setting_sources=[],
        # The answer streams to the browser a token at a time rather than landing whole
        # when the orchestrator finishes writing it. A graph walk already takes a
        # minute, so waiting again for the prose is the difference between an answer
        # that is being written and one that is merely late.
        include_partial_messages=True,
        # The reasoning between the tool calls, which is the part of a long search the
        # trail cannot otherwise explain: which entity to walk from, and why this page
        # settles the question. `display` is the load-bearing half — Opus returns a
        # signature and no text unless the text is asked for. Adaptive rather than a
        # fixed budget so a one-hop question does not pay for a six-hop one.
        thinking={'type': 'adaptive', 'display': 'summarized'},
        permission_mode='acceptEdits',
        cwd=workspace,
        max_turns=MAX_TURNS,
        hooks={'PreToolUse': [HookMatcher(hooks=[_pre_tool_guard])]},
        env={
            'CLAUDE_CODE_OAUTH_TOKEN': token,
            'HOME': workspace,
            'CLAUDE_CONFIG_DIR': f"{workspace}/.claude",
        },
    )
