"""The orchestrator's model and the two search subagents as `AgentDefinition`s.

Two roles, not one per hop: `seeker` starts from a query and finds its own seed
pages, `explorer` starts from pages it was handed. After that both run the same loop
outward, so the orchestrator reads the same report shape back whichever it dispatched.

The orchestrator holds every tool and is forbidden by its prompt from running the
loop. The ban is advisory in the sense that nothing enforces it: it needs
`retrieve_pages` to pull up one page a user asked about by name, and taking the tools
away would cost more than it saves. The containment that matters is in the prompt and
in the report contract — a subagent returns findings and paths, never page text.

The SDK constrains `AgentDefinition.model` to the aliases `sonnet|opus|haiku|inherit`,
so the alias is what pins the tier and the caller's subscription resolves it.
"""

import json
from pathlib import Path

from claude_agent_sdk import AgentDefinition

from tools.registry import ORCHESTRATOR_ROLE, SUBAGENT_ROLES, qualified_tool_names

ORCHESTRATOR_MODEL = 'opus'
SUBAGENT_MODEL = 'sonnet'

# The built-in that dispatches a subagent. The CLI has renamed it across versions
# (`Task` in older builds, `Agent` in 2.1.206+) and ships both names, so accepting
# either is what keeps a CLI bump from silently disabling every dispatch.
DISPATCH_TOOLS = frozenset({'Agent', 'Task'})

# Schema lookup for tools the agent already holds. It grants nothing — the
# PreToolUse hook and each role's `tools` list still gate every actual call — but a
# CLI that defers tool schemas needs it to reach them at all.
TOOL_SEARCH = 'ToolSearch'

PROMPTS_PATH = Path(__file__).with_name('prompts.json')

# Prepended to both subagent charters. The loop and the report contract are the same
# for either role, so they are stated once here and each charter says only how it
# gets its first pages.
SEARCH_PROTOCOL = """
## The loop

You have a hop budget. Spend it:

1. Get pages — either from vector_search or from the list you were handed.
2. retrieve_pages on them. Read them. Keep the ones that bear on the question.
3. page_relations on the pages you kept. Pick the relations worth following: the ones
   whose far end could plausibly carry the rest of the answer. Ignore the rest.
4. neighbor_pages on the endpoint node ids of the relations you picked, passing EVERY
   page id you have read so far as exclude_page_ids.
5. Back to step 2 with those pages, until your hop budget runs out or nothing new
   comes back.

Track your own explored pages in your head and keep passing them as
exclude_page_ids. Nothing remembers them for you, and nothing needs to: the hop
budget is what stops you, not the exclusion list. Forgetting one costs you a re-read,
not a loop.

## What the tools will and will not do for you

neighbor_pages returns bare page ids that have NOT been judged against the question.
It ranks them only so a heavily-referenced node cannot flood you. Deciding whether a
page is relevant is yours alone, and it takes reading the page.

A snippet from vector_search is one window, not a page. Never quote one as if you had
read the page it came from.

## What to report

Return exactly this, and nothing else. No page text.

findings:  one line per page that bears on the question —
           {pageId, pageLabel, docTitle, pageNumber, contribution, quote}
           `contribution` is what this page adds in one sentence. `quote` is a short
           verbatim span from the page that supports it. `pageLabel` is the readable
           name every tool returns beside the id — copy it verbatim, never build one
           yourself, so the orchestrator can cite the page without reading it again.
paths:     how you got from a seed page to a finding —
           {fromPageId, hops: ["Acme Ltd —invoiced→ +44 7700 900123", ...], toPageId}
frontier:  page ids you reached but did not explore because the budget ran out. NOT
           pages you judged irrelevant.
explored:  every page id you read, including the ones you ruled out.
note:      how many hops you ran, what you ruled out and why, and anything that
           looked wrong.

Two rules about that. Every claim carries its pageId — a finding without provenance
cannot be used and will be discarded. And empty findings is a real answer: if nothing
you read bears on the question, say so and list what you explored. Do not pad the
report with pages that only look related.
""".strip()

# When the orchestrator should dispatch each role. The SDK shows this to the
# orchestrator as the subagent's description, so it is the selection signal.
ROLE_DESCRIPTIONS: dict = {
    'seeker': (
        'Searches the ontology from a query and follows the graph outward from what it '
        'finds. Dispatch this first, and again for a differently worded query. Give it '
        'the query and a hop budget.'
    ),
    'explorer': (
        'Explores outward from specific pages it is handed, without searching first. '
        'Dispatch several at once, each over a batch of frontier pages, to widen a '
        'search that has already found its footing. Give it the page ids, the '
        'question, and a hop budget.'
    ),
}


def load_prompts() -> dict:
    return json.loads(PROMPTS_PATH.read_text())


def build_roles(prompts: dict) -> dict:
    """The two search subagents: charter, the shared loop, own tools, Sonnet tier."""
    return {
        role: AgentDefinition(
            description=ROLE_DESCRIPTIONS[role],
            prompt=f"{prompts[role]}\n\n{SEARCH_PROTOCOL}",
            tools=qualified_tool_names(role),
            model=SUBAGENT_MODEL,
        )
        for role in SUBAGENT_ROLES
    }


def orchestrator_allowed_tools() -> list:
    """The orchestrator's tools: its own server plus the built-in dispatcher."""
    return [*qualified_tool_names(ORCHESTRATOR_ROLE), *sorted(DISPATCH_TOOLS), TOOL_SEARCH]
