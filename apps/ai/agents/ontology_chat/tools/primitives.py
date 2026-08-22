"""The five primitives every role holds. Deterministic, and stateless between calls.

Primitives, not workflows. Each answers exactly one question about the ontology, and
the n-hop search is assembled from them by a subagent rather than run inside a tool:

    vector_search     where do I start?
    retrieve_pages    what does this page actually say?
    page_relations    what does this page connect to?
    neighbor_pages    which other pages share those nodes?
    build_overview    what is in this corpus at all?

Keeping the loop in the subagent is what makes variable depth possible — the
orchestrator hands out a hop budget instead of a constant compiled into a tool — and
what keeps the intermediate pages out of the orchestrator's context.

Nothing here holds state. The SDK hands a tool only its arguments, with no caller
identity, so a tool could not tell two concurrent subagents apart even if it wanted
to; `exclude_page_ids` is therefore a plain parameter, carrying the pages THAT
subagent has already read, which it has in its own context. Two subagents can
converge on the same page without racing, and a later question can never inherit an
earlier one's exclusions.

Above all, no relevance verdict is stored anywhere. "Explored and irrelevant" is true
of a question, not of a page: a page one search discarded is often exactly what the
next search needs.
"""

from .common import make_tool, respond
from .store import MAX_PAGES_PER_CALL, BuildStore

DEFAULT_TOP_K = 12
MAX_TOP_K = 30


def build_tools(store: BuildStore) -> list:
    async def vector_search(args: dict) -> dict:
        query = str(args['query']).strip()
        if not query:
            raise ValueError('query must not be empty')
        top_k = min(int(args.get('top_k') or DEFAULT_TOP_K), MAX_TOP_K)
        pages = store.search(query, top_k)
        return respond({
            'query': query,
            'pages': pages,
            'returned': len(pages),
            'note': (
                'Window hits deduped to their parent pages. The snippet is the single '
                'best-matching window, not the page — read the page before relying on it.'
            ),
        })

    async def retrieve_pages(args: dict) -> dict:
        page_ids = list(args.get('page_ids') or [])
        if not page_ids:
            raise ValueError('page_ids must not be empty')
        wanted = page_ids[:MAX_PAGES_PER_CALL]
        pages, missing = [], []
        for page_id in wanted:
            try:
                page = store.page(page_id)
            except Exception:
                missing.append(page_id)
                continue
            pages.append({
                'pageId': page['page_id'],
                'pageLabel': store.page_label(page['page_id']),
                'docId': page['doc_id'],
                'docTitle': page['doc_title'],
                'pageNumber': page['page_number'],
                'text': page['text'],
            })
        return respond({
            'pages': pages,
            'missing': missing,
            'notReturned': page_ids[MAX_PAGES_PER_CALL:],
            'note': (
                f"At most {MAX_PAGES_PER_CALL} pages per call. Anything in notReturned "
                'was not read — ask again for it if you still want it.'
            ),
        })

    async def page_relations(args: dict) -> dict:
        page_ids = list(args.get('page_ids') or [])
        if not page_ids:
            raise ValueError('page_ids must not be empty')
        relations = store.relations(page_ids)
        return respond({
            'pageIds': page_ids,
            'relations': relations,
            'returned': len(relations),
            'note': (
                'Every relation the ontology recorded on these pages. Pick the ones '
                'worth following, then pass their endpoint node ids to neighbor_pages.'
            ),
        })

    async def neighbor_pages(args: dict) -> dict:
        node_ids = list(args.get('node_ids') or [])
        if not node_ids:
            raise ValueError('node_ids must not be empty')
        result = store.neighbors(node_ids, list(args.get('exclude_page_ids') or []))
        result['note'] = (
            'One hop only, page ids only. Ranked internally so a hub node cannot flood '
            'you; truncated=true means candidates were dropped. Nothing here has been '
            'judged against your question — retrieve the pages and decide yourself.'
        )
        return respond(result)

    async def build_overview(_args: dict) -> dict:
        return respond(store.overview())

    return [
        make_tool(
            'vector_search',
            (
                'Search the ontology for pages whose text resembles a query. Returns pages, '
                'not chunks: window hits are deduped to their parent pages, best first, each '
                'with the best-matching snippet. Use it to find where to start; it cannot '
                'find a page that shares no wording with the query, which is what the graph '
                'walk is for.'
            ),
            {
                'type': 'object',
                'properties': {
                    'query': {'type': 'string'},
                    'top_k': {'type': 'integer'},
                },
                'required': ['query'],
            },
            vector_search,
        ),
        make_tool(
            'retrieve_pages',
            (
                'Read the full text of up to 10 pages, with the document title and page '
                'number. This is the only way to see what a page actually says — every other '
                'tool returns ids and one-liners. Each page also carries a pageLabel, which '
                'is how to name it in a report or an answer.'
            ),
            {
                'type': 'object',
                'properties': {
                    'page_ids': {'type': 'array', 'items': {'type': 'string'}},
                },
                'required': ['page_ids'],
            },
            retrieve_pages,
        ),
        make_tool(
            'page_relations',
            (
                'Every relation the ontology recorded on the given pages, one line each: the '
                'triple, its evidence, and the node ids of both endpoints. Cheap compared to '
                'reading pages, so use it to decide which connections are worth following '
                'before you pay for the pages at the far end.'
            ),
            {
                'type': 'object',
                'properties': {
                    'page_ids': {'type': 'array', 'items': {'type': 'string'}},
                },
                'required': ['page_ids'],
            },
            page_relations,
        ),
        make_tool(
            'neighbor_pages',
            (
                'The pages one hop away: other pages that mention the given nodes. Returns '
                'page ids only, never content, and never more than one hop — walking further '
                'is your loop, not this tool\'s. Pass every page you have already read as '
                'exclude_page_ids so you are not handed them again.'
            ),
            {
                'type': 'object',
                'properties': {
                    'node_ids': {'type': 'array', 'items': {'type': 'string'}},
                    'exclude_page_ids': {'type': 'array', 'items': {'type': 'string'}},
                },
                'required': ['node_ids'],
            },
            neighbor_pages,
        ),
        make_tool(
            'build_overview',
            (
                'What this ontology is made of: the documents and their page counts, how many '
                'pages, nodes and edges, the commonest entity types and relation types, and '
                'the most connected nodes. Use it to orient before searching, or to answer a '
                'question about the corpus itself.'
            ),
            {},
            build_overview,
        ),
    ]
