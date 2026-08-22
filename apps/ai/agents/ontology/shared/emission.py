"""Serialize the graph into gold. The last thing a build writes.

Seven artifacts make up a finished ontology: four CSVs, the schema, the telemetry
signals, and `index/page_graph.json`. The CSVs are the graph laid out for a table;
`page_graph.json` is the same graph laid out for the walk retrieval actually does —
page to its relations, relation to its far node, node back to every page it appears
on. Retrieval loads that one small file instead of parsing four CSVs and inverting
them itself, and it deliberately carries no page or chunk text: the text is fetched
per page, on demand, only for the pages a search actually reaches.

Two of the seven are not written here. `pages.csv` and `chunks.csv` are produced by
segmentation, at the moment it has the text in hand, so this stage never reads the
pages back. What it needs from them is four fields per page, and all four are in the
manifest. The read set is therefore five small objects however large the corpus is.

This lives in `shared/` rather than under `tools/` because a Lambda runs it: the
control-Lambda asset excludes the agent's tool tree.
"""

import json

from . import artifacts, elements, telemetry

OUTPUT_NAMES = ('nodes.csv', 'edges.csv', 'chunks.csv', 'pages.csv', 'schema.json',
                'telemetry.json', 'index/page_graph.json')

COUNTS_NAME = 'extract/counts.json'
COUNT_FIELDS = ('items_total', 'anchor_fail', 'relations_total',
                'relations_dropped_endpoint')

_NODE_FIELDS = ['node_id', 'name', 'label', 'type', 'role', 'semantic', 'norm', 'aliases',
                'event_date', 'page_df', 'idf', 'degree', 'eligible', 'evidence', 'page_ids',
                'chunk_ids', 'doc_ids']
_EDGE_FIELDS = ['edge_id', 'source_node_id', 'target_node_id', 'predicate', 'predicate_label',
                'qualifier', 'time', 'weight', 'evidence', 'page_ids', 'chunk_ids']


def _node_rows(nodes):
    for node in nodes.values():
        yield {
            **{k: node[k] for k in ('node_id', 'name', 'label', 'type', 'role', 'semantic',
                                    'norm', 'event_date', 'page_df', 'idf', 'degree',
                                    'evidence')},
            'eligible': node['eligible'],
            'aliases': json.dumps(node.get('aliases', [])),
            'page_ids': json.dumps(node.get('page_ids', [])),
            'chunk_ids': json.dumps(node.get('chunk_ids', [])),
            'doc_ids': json.dumps(node.get('doc_ids', [])),
        }


def _edge_rows(edges, pred_labels):
    for edge in edges:
        yield {
            **{k: edge[k] for k in ('edge_id', 'source_node_id', 'target_node_id',
                                    'predicate', 'qualifier', 'time', 'weight', 'evidence')},
            'predicate_label': pred_labels.get(edge['predicate'], edge['predicate']),
            'page_ids': json.dumps(edge.get('page_ids', [])),
            'chunk_ids': json.dumps(edge.get('chunk_ids', [])),
        }


def _manifest_pages(run_prefix: str):
    """The four page fields the page graph needs, adapted from the manifest's names."""
    manifest = artifacts.read_json(artifacts.resolve(run_prefix, 'pages/manifest.json'))
    return [
        {
            'page_id': entry['pageId'],
            'doc_id': entry['doc'],
            'doc_title': entry['docTitle'],
            'page_number': entry['page'],
        }
        for entry in manifest
    ]


def extract_counts(run_prefix: str) -> dict:
    """The corpus-wide extraction counters, precomputed if compaction has run."""
    uri = artifacts.resolve(run_prefix, COUNTS_NAME)
    if artifacts.exists(uri):
        return artifacts.read_json(uri)

    total = dict.fromkeys(COUNT_FIELDS, 0)
    for element in elements.stream(run_prefix):
        elements.add_counts(total, element)
    return total


def page_graph(pages, nodes, edges, pred_labels):
    """Invert the graph into the page-walk shape retrieval reads.

    Every edge is filed under each page it was seen on, so "what does this page
    connect to" is a lookup rather than a scan; every node lists the pages it appears
    on, so "which other pages share this node" is the same. `idf` and `weight` come
    along because the neighbour cut is computed from them.
    """
    page_edges = {page['page_id']: [] for page in pages}
    edge_rows = {}
    for edge in edges:
        edge_rows[edge['edge_id']] = {
            's': edge['source_node_id'],
            't': edge['target_node_id'],
            'p': edge['predicate'],
            'label': pred_labels.get(edge['predicate'], edge['predicate']),
            'q': edge.get('qualifier', ''),
            'tm': edge.get('time', ''),
            'ev': edge.get('evidence', ''),
            'w': edge.get('weight', 0),
        }
        for page_id in edge.get('page_ids', []):
            page_edges.setdefault(page_id, []).append(edge['edge_id'])

    return {
        'pages': {
            page['page_id']: {
                'docId': page['doc_id'],
                'docTitle': page['doc_title'],
                'pageNumber': page['page_number'],
                'edges': page_edges.get(page['page_id'], []),
            }
            for page in pages
        },
        'edges': edge_rows,
        'nodes': {
            node['node_id']: {
                'name': node['name'],
                'label': node['label'],
                'role': node['role'],
                'semantic': node['semantic'],
                'eligible': node['eligible'],
                'idf': node['idf'],
                'pages': node.get('page_ids', []),
            }
            for node in nodes.values()
        },
    }


def output_uris(run_prefix: str) -> list:
    return [artifacts.resolve(run_prefix, name) for name in OUTPUT_NAMES]


def emit(run_prefix: str) -> dict:
    """Write the flat outputs and the page graph. Returns the URIs and headline counts."""
    graph = artifacts.read_json(
        artifacts.resolve(run_prefix, 'canonicalize/graph.json'))
    schema = artifacts.read_json(
        artifacts.resolve(run_prefix, 'consolidate/schema.json'))
    schema_counts = artifacts.read_json(
        artifacts.resolve(run_prefix, 'consolidate/maps.json')).get('counts', {})
    nodes, edges = graph['nodes'], graph['edges']
    pred_labels = {p['n']: (p.get('label') or p['n']) for p in schema.get('predicates', [])}

    pages = _manifest_pages(run_prefix)

    artifacts.write_csv(artifacts.resolve(run_prefix, 'nodes.csv'),
                        _NODE_FIELDS, _node_rows(nodes))
    artifacts.write_csv(artifacts.resolve(run_prefix, 'edges.csv'),
                        _EDGE_FIELDS, _edge_rows(edges, pred_labels))
    artifacts.write_json(artifacts.resolve(run_prefix, 'schema.json'), schema)

    graph_index = page_graph(pages, nodes, edges, pred_labels)
    artifacts.write_json(artifacts.resolve(run_prefix, 'index/page_graph.json'), graph_index)

    signals = telemetry.compute(nodes, edges, graph.get('total_pages', 0),
                                extract_counts(run_prefix), schema_counts,
                                graph.get('counts', {}))
    artifacts.write_json(artifacts.resolve(run_prefix, 'telemetry.json'), signals)

    return {
        'outputs': output_uris(run_prefix),
        'nodes': len(nodes),
        'edges': len(edges),
        'pages': len(pages),
        'pagesWithRelations': sum(
            1 for page in graph_index['pages'].values() if page['edges']),
        'crossDocumentEdges': signals['cross_document_edge_count'],
    }
