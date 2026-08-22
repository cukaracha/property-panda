"""Collapse verified extraction into the scored graph. No model input at all.

It applies the schema's type map to every entity and predicate map to every relation
(a flipped predicate swaps subject and object), keys each entity by
(canonical_type, norm-or-normalized-name), groups keyed entities into nodes and
grouped relations into edges, then scores every node (page_df, eligibility, idf,
degree).

Exact matching only, by design. The same phone written three ways collapses to one
node and bridges its documents; two spelling variants of a name stay two nodes. Node
ids are content-hashed from the key, which is what makes a rebuild over the same
corpus produce the same ids — so this stage stays deterministic even though the
extraction that fed it came from a model.

Entities and relations are folded in the SAME pass over the elements, and that is
only correct because **a relation's endpoints are always page-local**: EXTRACT
resolves `s_id` and `o_id` through the maps built from that one page and drops a
relation whose endpoints were not both extracted there, so by the time a page's
relations are read its entities are already keyed. If extraction ever gains a
cross-page relation, this fuse must be undone or those edges will vanish silently
into `relations_dropped_unmapped`.

This lives in `shared/` rather than under `tools/` because a Lambda runs it: the
control-Lambda asset excludes the agent's tool tree, so anything the state machine
executes has to be importable from here.
"""

import math
from collections import Counter

from . import artifacts, elements, keys

MIN_PAGE_DF = 2
MAX_PAGE_DF_RATIO = 0.05
MAX_PAGE_DF_ABS = 500
IDENTIFIER_CEILING_MULTIPLIER = 3.0

GRAPH_NAME = 'canonicalize/graph.json'


def _add_entities(element, nodes, entity_to_node, type_map, identifier_types,
                  type_attrs, counts):
    """Key and group one page's verified entities into nodes."""
    for ent in element.get('entities', []):
        counts['entities_total'] += 1
        canonical = type_map.get(ent['type'])
        if canonical is None:
            counts['entities_dropped_unmapped'] += 1
            continue
        is_identifier = canonical in identifier_types
        key = keys.node_key(canonical, ent['name'], ent.get('norm'), is_identifier)
        nid = keys.node_id(key)
        entity_to_node[ent['id']] = nid

        node = nodes.get(nid)
        if node is None:
            attrs = type_attrs.get(canonical, {})
            node = {
                'node_id': nid, 'type': canonical, 'is_identifier': is_identifier,
                'label': attrs.get('label', canonical),
                'role': attrs.get('role', 'entity'),
                'semantic': attrs.get('semantic', True),
                'norm': (ent.get('norm') or '') if is_identifier else '',
                'surfaces': Counter(), 'page_ids': set(), 'chunk_ids': set(),
                'doc_ids': set(), 'evidence': ent.get('ev', ''),
                'event_date': '',
            }
            nodes[nid] = node
        node['surfaces'][ent['name']] += 1
        node['page_ids'].add(ent['page_id'])
        if ent.get('chunk_id'):
            node['chunk_ids'].add(ent['chunk_id'])
        node['doc_ids'].add(ent['doc_id'])
        if not node['evidence']:
            node['evidence'] = ent.get('ev', '')
        date = ent.get('date')
        if date:
            node['event_date'] = min(node['event_date'], date) if node['event_date'] else date


def _add_relations(element, grouped, entity_to_node, pred_map, counts):
    """Map, flip, resolve, and group one page's relations into edges."""
    for rel in element.get('relations', []):
        counts['relations_total'] += 1
        mapping = pred_map.get(rel['p'])
        if mapping is None:
            counts['relations_dropped_unmapped'] += 1
            continue
        predicate, flip = mapping[0], mapping[1]
        s_id, o_id = (rel['o_id'], rel['s_id']) if flip else (rel['s_id'], rel['o_id'])
        source, target = entity_to_node.get(s_id), entity_to_node.get(o_id)
        if not source or not target:
            counts['relations_dropped_unmapped'] += 1
            continue
        # Qualifier and time are part of the key, not attributes of it: P2B keeps
        # a negated claim separate from the affirmed one, and grouping on the
        # triple alone would merge them back into a single double-counted edge.
        qualifier, time = rel.get('q') or '', rel.get('tm') or ''
        key = (source, predicate, target, qualifier, time)
        edge = grouped.get(key)
        if edge is None:
            edge = {
                'source_node_id': source, 'target_node_id': target, 'predicate': predicate,
                'page_ids': set(), 'chunk_ids': set(), 'evidence': rel.get('ev', ''),
                'qualifier': qualifier, 'time': time,
            }
            grouped[key] = edge
        edge['page_ids'].add(rel['page_id'])
        if rel.get('chunk_id'):
            edge['chunk_ids'].add(rel['chunk_id'])
        if not edge['evidence']:
            edge['evidence'] = rel.get('ev', '')


def _finalize(nodes, grouped_edges, total_pages):
    """Assign edge ids/weights, compute degree, and score every node."""
    degree = Counter()
    edges = []
    for edge in grouped_edges.values():
        degree[edge['source_node_id']] += 1
        degree[edge['target_node_id']] += 1
        edges.append({
            'edge_id': keys.edge_id(edge['source_node_id'], edge['predicate'],
                                    edge['target_node_id'], edge['qualifier'], edge['time']),
            'source_node_id': edge['source_node_id'],
            'target_node_id': edge['target_node_id'],
            'predicate': edge['predicate'],
            'qualifier': edge['qualifier'],
            'time': edge['time'],
            'weight': len(edge['page_ids']),
            'evidence': edge['evidence'],
            'page_ids': sorted(edge['page_ids']),
            'chunk_ids': sorted(edge['chunk_ids']),
        })

    ceiling_base = min(MAX_PAGE_DF_RATIO * total_pages, MAX_PAGE_DF_ABS)
    final_nodes = {}
    for nid, node in nodes.items():
        page_df = len(node['page_ids'])
        ceiling = ceiling_base * (IDENTIFIER_CEILING_MULTIPLIER if node['is_identifier'] else 1)
        name = node['surfaces'].most_common(1)[0][0]
        final_nodes[nid] = {
            'node_id': nid,
            'name': name,
            'label': node['label'],
            'type': node['type'],
            'role': node['role'],
            'semantic': node['semantic'],
            'norm': node['norm'],
            'event_date': node['event_date'],
            'is_identifier': node['is_identifier'],
            'aliases': sorted(s for s in node['surfaces'] if s != name),
            'page_df': page_df,
            'idf': round(math.log(total_pages / page_df), 4) if page_df else 0.0,
            'degree': degree.get(nid, 0),
            'eligible': MIN_PAGE_DF <= page_df <= ceiling,
            'page_ids': sorted(node['page_ids']),
            'chunk_ids': sorted(node['chunk_ids']),
            'doc_ids': sorted(node['doc_ids']),
            'evidence': node['evidence'],
        }
    return final_nodes, edges


def build_graph(run_prefix: str) -> dict:
    """Apply the committed schema to every element and write the scored graph."""
    maps = artifacts.read_json(artifacts.resolve(run_prefix, 'consolidate/maps.json'))
    total_pages = len(
        artifacts.read_json(artifacts.resolve(run_prefix, 'pages/manifest.json'))
    )
    type_map = maps['type_map']
    pred_map = maps['pred_map']
    identifier_types = set(maps.get('identifier_types', []))
    type_attrs = maps.get('type_attrs', {})

    nodes, entity_to_node, grouped_edges = {}, {}, {}
    counts = {'entities_total': 0, 'entities_dropped_unmapped': 0,
              'relations_total': 0, 'relations_dropped_unmapped': 0}
    for element in elements.stream(run_prefix):
        _add_entities(element, nodes, entity_to_node, type_map, identifier_types,
                      type_attrs, counts)
        _add_relations(element, grouped_edges, entity_to_node, pred_map, counts)

    final_nodes, edges = _finalize(nodes, grouped_edges, total_pages)

    graph = {
        'nodes': final_nodes,
        'edges': edges,
        'total_pages': total_pages,
        'counts': counts,
    }
    artifacts.write_json(artifacts.resolve(run_prefix, GRAPH_NAME), graph)

    return {
        'nodes': len(final_nodes),
        'edges': len(edges),
        'totalPages': total_pages,
        **counts,
    }
