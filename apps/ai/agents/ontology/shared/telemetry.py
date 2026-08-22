"""Build telemetry — cheap quality signals, each detecting a specific failure.

Replaces the old per-decision log. Every stage accumulates a few counts into its
output artifact; EMIT gathers them plus the finished graph and computes the signals
below (anchor-fail rate, dropped-relation rate, schema drops, graph density,
hub/eligibility, role distribution, schema absorption, and the headline
cross-document edge count).
"""

from collections import Counter


def compute(nodes, edges, total_pages, extract_counts, schema_counts, canon_counts):
    """Return the telemetry dict written to telemetry.json and summarized on the job row.

    - nodes: {node_id: node} with page_df / degree / eligible / role / doc_ids
    - extract_counts: summed per-page {items_total, anchor_fail, relations_total,
      relations_dropped_endpoint}
    - schema_counts: {types_dropped, predicates_dropped, types_raw, types_canonical,
      predicates_raw, predicates_canonical}
    - canon_counts: {relations_total, relations_dropped_unmapped, entities_dropped_unmapped}
    """
    node_count = len(nodes)
    edge_count = len(edges)
    singletons = sum(1 for n in nodes.values() if n.get("degree", 0) == 0)
    ineligible = sum(1 for n in nodes.values() if not n.get("eligible"))
    identifiers = [n for n in nodes.values() if n.get("role") == "identifier"]
    page_dfs = [n.get("page_df", 0) for n in nodes.values()]

    role_distribution = Counter({"entity": 0, "observation": 0, "identifier": 0})
    for n in nodes.values():
        role_distribution[n.get("role", "entity")] += 1

    cross_doc_edges = 0
    for edge in edges:
        source = nodes.get(edge["source_node_id"])
        target = nodes.get(edge["target_node_id"])
        if source and target and len(set(source.get("doc_ids", [])) | set(target.get("doc_ids", []))) >= 2:
            cross_doc_edges += 1

    items_total = extract_counts.get("items_total", 0)
    anchor_fail = extract_counts.get("anchor_fail", 0)
    rel_total = extract_counts.get("relations_total", 0)
    rel_dropped = extract_counts.get("relations_dropped_endpoint", 0)

    types_raw = schema_counts.get("types_raw", 0)
    types_canonical = schema_counts.get("types_canonical", 0)
    predicates_raw = schema_counts.get("predicates_raw", 0)
    predicates_canonical = schema_counts.get("predicates_canonical", 0)

    return {
        "anchor_fail_rate": round(anchor_fail / items_total, 4) if items_total else 0.0,
        "dropped_relation_rate": round(rel_dropped / rel_total, 4) if rel_total else 0.0,
        "types_dropped": schema_counts.get("types_dropped", 0),
        "predicates_dropped": schema_counts.get("predicates_dropped", 0),
        "node_count": node_count,
        "edge_count": edge_count,
        "singleton_rate": round(singletons / node_count, 4) if node_count else 0.0,
        "max_page_df": max(page_dfs) if page_dfs else 0,
        "ineligible_rate": round(ineligible / node_count, 4) if node_count else 0.0,
        "identifier_count": len(identifiers),
        "identifier_page_df": sorted((n.get("page_df", 0) for n in identifiers), reverse=True)[:20],
        "role_distribution": dict(role_distribution),
        "types_raw": types_raw,
        "types_canonical": types_canonical,
        "predicates_raw": predicates_raw,
        "predicates_canonical": predicates_canonical,
        "types_absorbed_ratio": round(types_raw / types_canonical, 2) if types_canonical else 0.0,
        "predicates_absorbed_ratio": round(predicates_raw / predicates_canonical, 2) if predicates_canonical else 0.0,
        "cross_document_edge_count": cross_doc_edges,
        "relations_dropped_unmapped": canon_counts.get("relations_dropped_unmapped", 0),
        "entities_dropped_unmapped": canon_counts.get("entities_dropped_unmapped", 0),
        "total_pages": total_pages,
    }
