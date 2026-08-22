"""Assemble one in-process MCP server per role, and name every tool once.

Three roles are left: the extractor under a Step Functions Map branch, and the two
consolidators, which run side by side inside the build invocation. There is one server
per role rather than one shared server, so a tool handler is bound to its role at
construction and a run is only ever given the fully-qualified names of its own
server's tools. That is what makes the scoping structural: an extract batch has no
way to commit a schema and no way to fail the build, because those tools are absent,
not because a prompt asked it not to. The same holds across the consolidators, which
is why two concurrent runs cannot write over each other's half.

The name lists here are the single source of truth — `sdk_options` builds each run's
`allowed_tools` from `qualified_tool_names`, so the two cannot drift.
"""

from claude_agent_sdk import McpSdkServerConfig, SdkMcpTool, create_sdk_mcp_server

from .consolidate import predicates_tools, types_tools
from .context import RunContext
from .extract import extract_tools

# The stages a model still runs. CONVERT, SEGMENT, CANONICALIZE and EMIT are all
# deterministic and run in the state machine; EXTRACT needs a model per page but is
# fanned out by the state machine rather than dispatched by one. CONSOLIDATE is two
# roles rather than one because its two halves are designed concurrently, and neither
# is given the other's tools: a run that could commit both halves could also commit
# them inconsistently.
ROLES: tuple = (
    'extractor',
    'types_consolidator',
    'predicates_consolidator',
)

ROLE_TOOL_NAMES: dict = {
    'extractor': ('record_extraction', 'report_progress'),
    'types_consolidator': (
        'collect_raw_types', 'cluster_raw_types', 'commit_types', 'fail_build',
    ),
    'predicates_consolidator': (
        'collect_raw_predicates', 'cluster_raw_predicates', 'commit_predicates', 'fail_build',
    ),
}

BUILDERS = {
    'extractor': extract_tools,
    'types_consolidator': types_tools,
    'predicates_consolidator': predicates_tools,
}


def server_name(role: str) -> str:
    return f"onto_{role}"


def qualified(role: str, tool_name: str) -> str:
    return f"mcp__{server_name(role)}__{tool_name}"


def role_tool_names(role: str) -> tuple:
    return ROLE_TOOL_NAMES[role]


def qualified_tool_names(role: str) -> list:
    return [qualified(role, name) for name in role_tool_names(role)]


def role_tools(ctx: RunContext, role: str) -> list:
    return BUILDERS[role](ctx)


def build_servers(ctx: RunContext, roles: tuple = None) -> dict:
    """One server per named role, keyed by server name, ready for `mcp_servers`."""
    return {
        server_name(role): create_sdk_mcp_server(
            server_name(role), tools=role_tools(ctx, role)
        )
        for role in (roles if roles is not None else ROLES)
    }


__all__ = [
    'ROLES',
    'SdkMcpTool',
    'McpSdkServerConfig',
    'build_servers',
    'qualified_tool_names',
    'role_tool_names',
    'server_name',
]
