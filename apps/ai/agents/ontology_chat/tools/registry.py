"""Assemble one in-process MCP server per role, and name every tool once.

Unlike the build agent, where each role owns a different stage and therefore a
different set of tools, all three roles here hold the same five primitives: the
orchestrator so it can read one page without a round trip, and both subagent roles
because they run the same loop. What differs between the roles is the charter, not
the capability.

There is still one server per role rather than one shared server, because a role's
`AgentDefinition.tools` names fully-qualified tools and each role has to name its
own. The name list here is the single source of truth — `roles.py` builds every
`tools` list from `qualified_tool_names`, so the two cannot drift.

Every server closes over ONE `BuildStore`, so the page graph is loaded once per
question and shared by every subagent the orchestrator dispatches. The store is
constructed by the entrypoint and passed in rather than made here, because the stream
mapper needs the same one to turn page ids into readable labels for the trail — and a
second store would load the graph again to answer that.
"""

from claude_agent_sdk import create_sdk_mcp_server

from .primitives import build_tools
from .store import BuildStore

ORCHESTRATOR_ROLE = 'orchestrator'

# The two ways to run the search loop. A seeker starts from a query and finds its own
# seed pages; an explorer starts from pages it was handed. Both then loop outward
# identically, which is why the orchestrator can dispatch either without changing how
# it reads the report that comes back.
SUBAGENT_ROLES: tuple = ('seeker', 'explorer')

ALL_ROLES: tuple = (ORCHESTRATOR_ROLE, *SUBAGENT_ROLES)

TOOL_NAMES: tuple = (
    'vector_search',
    'retrieve_pages',
    'page_relations',
    'neighbor_pages',
    'build_overview',
)


def server_name(role: str) -> str:
    return f"onto_ask_{role}"


def qualified(role: str, tool_name: str) -> str:
    return f"mcp__{server_name(role)}__{tool_name}"


def qualified_tool_names(role: str) -> list:
    return [qualified(role, name) for name in TOOL_NAMES]


def build_servers(store: BuildStore) -> dict:
    """One server per role, keyed by server name, ready for `mcp_servers`."""
    return {
        server_name(role): create_sdk_mcp_server(server_name(role), tools=build_tools(store))
        for role in ALL_ROLES
    }


__all__ = [
    'ALL_ROLES',
    'ORCHESTRATOR_ROLE',
    'SUBAGENT_ROLES',
    'TOOL_NAMES',
    'build_servers',
    'qualified_tool_names',
    'server_name',
]
