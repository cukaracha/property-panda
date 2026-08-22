/** Parsed shapes of the ontology tool's flat output files (nodes/edges/chunks/
 *  pages.csv + schema.json), plus the force-graph data derived from the nodes
 *  and edges. */

export type NodeRole = 'identifier' | 'entity' | 'observation';

export interface NodeDatum {
  id: string; // node_id
  name: string; // most frequent surface form
  label: string; // the canonical type's human-readable label
  type: string; // canonical type (machine name)
  role: NodeRole;
  semantic: boolean; // false for hideable document scaffolding
  norm: string; // canonical key for identifiers, empty otherwise
  event_date: string; // ISO-8601 for observation nodes, else empty
  aliases: string[];
  page_df: number;
  idf: number;
  degree: number;
  eligible: boolean;
  evidence: string; // verbatim quote the node was extracted from
  page_ids: string[];
  chunk_ids: string[];
  doc_ids: string[];
}

export interface LinkDatum {
  id: string; // edge_id
  source: string; // source_node_id
  target: string; // target_node_id
  predicate: string;
  predicate_label: string;
  qualifier: string;
  time: string;
  weight: number;
  evidence: string;
  page_ids: string[];
  chunk_ids: string[];
}

export interface SchemaType {
  n: string;
  label: string;
  def: string;
  role: NodeRole;
  semantic: boolean;
}

export interface SchemaPredicate {
  n: string;
  label: string;
  def: string;
  dom: string[];
  rng: string[];
}

export interface Schema {
  types: SchemaType[];
  predicates: SchemaPredicate[];
  schema_version?: number;
  revision?: number;
  build_id?: string;
  created_at?: number;
  parent_schema_uri?: string;
}

export interface ChunkRec {
  chunk_id: string;
  page_id: string;
  doc_id: string;
  chunk_index: number;
  char_start: number;
  char_end: number;
  text: string;
}

export interface PageRec {
  page_id: string;
  doc_id: string;
  doc_title: string;
  page_number: number | null;
  text: string;
}

export interface GraphData {
  nodes: NodeDatum[];
  links: LinkDatum[];
}

export interface ParsedOntology {
  graph: GraphData;
  nodes: NodeDatum[];
  chunks: ChunkRec[];
  pages: PageRec[];
  schema: Schema;
}

/**
 * One entry in a turn's search trail, in the order it happened.
 *
 * A tool step is `{name} {detail}` as the agent emitted it, split for display rather
 * than on the wire, so the runtime keeps sending one shape per stream event. A
 * reasoning step is prose, already joined from the fragments it streamed as.
 */
export interface TrailStep {
  type: 'reasoning' | 'tool';
  content: string;
}

/** One turn of the Ask panel's conversation with a finished ontology. */
export interface OntologyChatMessage {
  role: 'user' | 'assistant';
  content: string;
  /** ISO-8601. Carried on restored turns so a replay round-trips losslessly. */
  timestamp?: string;
  /** The search steps that produced this answer, kept so the walk stays auditable
   *  after the fact. Only ever set on turns taken in this session: the conversation
   *  endpoint stores the text of a turn, not how it was reached, so a restored
   *  transcript has none. */
  trail?: TrailStep[];
}
