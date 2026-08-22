"""Assemble the SDK options for a run, and the hook that gates every tool call.

The runtime answers to two modes and every run is a single top-level agent with its
own charter and its own tools. There is no orchestrator and no subagents: EXTRACT is
fanned out by a Step Functions Map, CONSOLIDATE is two runs launched side by side by
the invocation itself, and CANONICALIZE and EMIT make no model calls at all, so
nothing here needs sequencing by a model. The dispatch indirection that used to sit
above these charters cost a turn each way per hop and depended on a built-in tool the
CLI has renamed across versions, which is how the first deployed build stalled.

Three settings make the scoping authoritative in a headless run:

- A `PreToolUse` hook allows only this run's tools (`mcp__onto_*`) and denies
  everything else, dispatchers included. There is no user to answer a permission
  prompt here, so the hook returns an explicit allow or deny and nothing ever blocks
  waiting for input. It is also the belt-and-braces behind the per-role tool lists.
- Every filesystem and web built-in is disallowed. This pipeline reads S3 through
  its tools and nothing else; a `Bash` or `WebFetch` in the middle of a build would
  be a way around the tenancy prefix, not a convenience.
- `setting_sources=[]` ignores any ambient Claude settings, so a run behaves the
  same in the container as it does anywhere else.

The caller's token is passed through `options.env`, never the process environment,
so concurrent builds for different users stay isolated and each run consumes the
subscription of the person who started it.
"""

import json
from pathlib import Path
from typing import Any

from claude_agent_sdk import ClaudeAgentOptions, HookMatcher

from tools.context import RunContext
from tools.registry import build_servers, qualified_tool_names

MODEL = 'sonnet'

TYPES_ROLE = 'types_consolidator'
PREDICATES_ROLE = 'predicates_consolidator'
EXTRACT_ROLE = 'extractor'

# Each CONSOLIDATE half is three tool calls and a design decision. The old ceiling was
# sized for an orchestrator driving four roles over a whole corpus, and left here it
# would turn a runaway loop into an hours-long one rather than a bounded failure.
MAX_TURNS = 60

# One batch is a handful of pages and each page is a read plus a record, so this is
# generous for the work while still bounding a runaway invocation.
EXTRACT_MAX_TURNS = 120

# The built-ins that dispatch a subagent. Nothing here dispatches, so both names are
# denied rather than merely absent — the CLI has shipped one or the other across
# versions and an unlisted name is not a guarantee.
DISPATCH_TOOLS = frozenset({'Agent', 'Task'})

# Schema lookup for tools the agent already holds. It is deliberately not in any run's
# `allowed_tools`: every role here holds two to four tools and the CLI carries all of
# their schemas from the first turn, so offering the lookup only bought a turn spent
# fetching what was already in context. The hook still admits the name, because what a
# future role may need is the hook's business rather than this list's.
TOOL_SEARCH = 'ToolSearch'

PROMPTS_PATH = Path(__file__).with_name('prompts.json')

# Built-in tools no run may reach. The tools already cover everything a stage needs,
# so filesystem and web access could only be used to step outside the owner's prefix;
# the built-in to-do list would compete with the stage sequence, and `Workflow` is a
# second fan-out mechanism that would sidestep the tool scoping.
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

# Appended to both CONSOLIDATE charters. It used to report to an orchestrator that
# would check its counts and decide whether to retry; nothing does that now, so the
# honesty it asked for has to be stated as the stage's own discipline.
CONSOLIDATE_PROTOCOL = (
    'You are one of the two halves of the last model step in this build, and the other '
    'half is running right now. Everything before you was extracted and verified '
    'deterministically, and everything after you is applied deterministically to the '
    'vocabulary you commit, so nothing downstream will notice a mistake here and nothing '
    'will ask you to try again. Work only on your own half and commit it once. Use only '
    'the tools you have been given. Never describe an artifact you did not create: only '
    'what a tool actually returned is real. When a tool reports a count that does not '
    'match what you expected, say so rather than smoothing it over. If you cannot commit '
    'at all, call fail_build with the actual reason instead of committing an empty '
    'vocabulary. Finish with a short report: what you committed, the headline counts, and '
    'anything that looked wrong.'
)

# The same discipline for an extract invocation, which has no orchestrator to report
# to: a Step Functions Map hands it one batch and takes the recorded pages back from
# the tool, not from anything said here. Stating that plainly is what stops a model
# from summarizing its way past a page it never wrote.
EXTRACT_PROTOCOL = (
    'You are running one batch of an ontology build\'s EXTRACT stage. You have been given '
    'the full text of a fixed set of pages and no way to obtain more, so work through '
    'exactly those pages and stop. Use only the tools you have been given. A page is done '
    'when record_extraction has returned for it and not before: what you record is what '
    'counts, and a page you describe but do not record is simply missing. Every page is '
    'recorded independently, so a page that will not extract is one page lost, not a reason '
    'to stop working the rest of the batch. Stop as soon as the last page is recorded. '
    'Nothing reads a closing summary, so writing one only costs the build time.'
)


def load_prompts() -> dict:
    return json.loads(PROMPTS_PATH.read_text())


def _tool_is_allowed(tool_name: str) -> bool:
    if tool_name in DISPATCH_TOOLS:
        return False
    return tool_name == TOOL_SEARCH or tool_name.startswith('mcp__onto_')


async def _pre_tool_guard(
    hook_input: dict, _tool_use_id: str | None, _context: Any
) -> dict:
    """Allow this run's tools, deny everything else, explicitly.

    Returning a permission decision rather than deferring to a prompt is what keeps a
    headless run from hanging on the first built-in tool the model reaches for.
    """
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


def _options(role: str, prompts: dict, protocol: str, ctx: RunContext,
             token: str, workspace: str, max_turns: int) -> ClaudeAgentOptions:
    return ClaudeAgentOptions(
        model=MODEL,
        system_prompt=f"{prompts[role]}\n\n{protocol}",
        mcp_servers=build_servers(ctx, roles=(role,)),
        allowed_tools=qualified_tool_names(role),
        disallowed_tools=[*DISALLOWED_BUILTINS, *sorted(DISPATCH_TOOLS)],
        setting_sources=[],
        permission_mode='acceptEdits',
        cwd=workspace,
        max_turns=max_turns,
        hooks={'PreToolUse': [HookMatcher(hooks=[_pre_tool_guard])]},
        env={
            'CLAUDE_CODE_OAUTH_TOKEN': token,
            'HOME': workspace,
            'CLAUDE_CONFIG_DIR': f"{workspace}/.claude",
        },
    )


def build_consolidate_options(
    role: str, ctx: RunContext, prompts: dict, token: str, workspace: str
) -> ClaudeAgentOptions:
    """Options for one half of CONSOLIDATE, the build's only remaining model step."""
    return _options(role, prompts, CONSOLIDATE_PROTOCOL,
                    ctx, token, workspace, MAX_TURNS)


def build_extract_options(
    ctx: RunContext, prompts: dict, token: str, workspace: str
) -> ClaudeAgentOptions:
    """Options for one EXTRACT batch: the extractor alone, no other role."""
    return _options(EXTRACT_ROLE, prompts, EXTRACT_PROTOCOL,
                    ctx, token, workspace, EXTRACT_MAX_TURNS)
