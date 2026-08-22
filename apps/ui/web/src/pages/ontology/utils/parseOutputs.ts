/** Parse the ontology tool's flat outputs into typed records + force-graph data. */
import { parseCsvObjects } from './csv';
import type {
  ChunkRec,
  GraphData,
  LinkDatum,
  NodeDatum,
  NodeRole,
  PageRec,
  Schema,
} from '../types/ontology';

function safeJson<T>(raw: string, fallback: T): T {
  try {
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

function num(raw: string, fallback = 0): number {
  const value = Number(raw);
  return Number.isFinite(value) ? value : fallback;
}

/** Python csv.DictWriter serializes booleans as "True"/"False". */
function bool(raw: string): boolean {
  return raw === 'True' || raw === 'true';
}

export function parseNodes(csv: string): NodeDatum[] {
  return parseCsvObjects(csv).map(row => ({
    id: row.node_id,
    name: row.name,
    label: row.label,
    type: row.type,
    role: row.role as NodeRole,
    // Fail open: an unproduced/empty semantic column must not hide every node.
    semantic: row.semantic !== 'False',
    norm: row.norm,
    event_date: row.event_date,
    aliases: safeJson<string[]>(row.aliases, []),
    page_df: num(row.page_df),
    idf: num(row.idf),
    degree: num(row.degree),
    eligible: bool(row.eligible),
    // Builds emitted before nodes.csv carried evidence simply have no column here.
    evidence: row.evidence ?? '',
    page_ids: safeJson<string[]>(row.page_ids, []),
    chunk_ids: safeJson<string[]>(row.chunk_ids, []),
    doc_ids: safeJson<string[]>(row.doc_ids, []),
  }));
}

export function parseEdges(csv: string): LinkDatum[] {
  return parseCsvObjects(csv).map(row => ({
    id: row.edge_id,
    source: row.source_node_id,
    target: row.target_node_id,
    predicate: row.predicate,
    predicate_label: row.predicate_label,
    qualifier: row.qualifier,
    time: row.time,
    weight: num(row.weight),
    evidence: row.evidence,
    page_ids: safeJson<string[]>(row.page_ids, []),
    chunk_ids: safeJson<string[]>(row.chunk_ids, []),
  }));
}

export function parseChunks(csv: string): ChunkRec[] {
  return parseCsvObjects(csv).map(row => ({
    chunk_id: row.chunk_id,
    page_id: row.page_id,
    doc_id: row.doc_id,
    chunk_index: num(row.chunk_index),
    char_start: num(row.char_start),
    char_end: num(row.char_end),
    text: row.text,
  }));
}

export function parsePages(csv: string): PageRec[] {
  return parseCsvObjects(csv).map(row => ({
    page_id: row.page_id,
    doc_id: row.doc_id,
    doc_title: row.doc_title,
    page_number: row.page_number === '' ? null : num(row.page_number),
    text: row.text,
  }));
}

export function parseSchema(json: string): Schema {
  return safeJson<Schema>(json, { types: [], predicates: [] });
}

/** Build force-graph data: fresh node/link objects (force-graph mutates them, so
 *  they must be separate from the raw arrays), deduped, with dangling edges dropped. */
export function buildGraphData(nodes: NodeDatum[], edges: LinkDatum[]): GraphData {
  const byId = new Map<string, NodeDatum>();
  for (const node of nodes) {
    if (!byId.has(node.id)) byId.set(node.id, { ...node });
  }
  const links = edges
    .filter(edge => byId.has(edge.source) && byId.has(edge.target))
    .map(edge => ({ ...edge }));
  return { nodes: Array.from(byId.values()), links };
}
