/**
 * Ontology service — the ontology agent's async build API (client side).
 *
 * Flow: getBronzeUploadUrl -> uploadFile (per document, into bronze) ->
 * triggerOntology (202 + jobId) -> poll getOntologyStatus until
 * succeeded/failed/partial -> getOntologyOutputs for the presigned gold artifacts.
 * Upload helpers live in datalakeService/utilityService; only the ontology-specific
 * endpoints live here.
 *
 * Saved ontologies are listed from listOntologies and re-opened through
 * getOntologyOutputs. Both cover the caller's own builds and every ontology anyone
 * has published: publishing moves nothing, so a shared build is read in place, and
 * the server resolves its prefix from the build's owner rather than from the caller.
 * Deleting stays with whoever built it, which is what `isOwner` on a listing is for.
 *
 * Past conversations about a build come from the two conversation endpoints. They
 * are REST rather than part of the SSE path in ontologyChatService, because
 * reading a transcript is a plain authorized GET and has nothing to do with the
 * runtime that produced it.
 */
import { authFetch } from './authUtils';

const API_URL = import.meta.env.VITE_API_URL;

export type OntologyStatus =
  | 'queued'
  | 'processing'
  // Stopped after conversion, waiting for the user to say what to do about the
  // documents that could not be converted. Not terminal: the answer puts the build
  // back to processing or ends it as failed.
  | 'awaitingReview'
  | 'succeeded'
  | 'failed'
  | 'partial'
  | 'deleting'
  | 'deleteFailed';
export type OntologyStage =
  'CARRY_FORWARD' | 'CONVERT' | 'SEGMENT' | 'EXTRACT' | 'CONSOLIDATE' | 'CANONICALIZE' | 'EMIT';

/**
 * Whether the build's pages are searchable. Deliberately independent of
 * OntologyStatus: the graph and the page index are built by two concurrent
 * branches, so an ontology can be finished and not yet searchable, and indexing
 * can fail without invalidating the graph.
 */
export type OntologyIndexStatus = 'pending' | 'ready' | 'failed';

export interface OntologyProgress {
  done: number;
  total: number;
}

/** Live conversion counter, bumped by each document as it reaches a terminal state.
 *  `done` counts every document that finished either way, so it reaches `total`;
 *  `failed` is how many of those will never have markdown. */
export interface OntologyConvertProgress {
  done: number;
  failed: number;
  total: number;
}

/** What conversion produced, once every document is terminal.
 *
 *  `attempted` is the documents that actually ran through the converter. On a derived
 *  build the rest arrived with their markdown already copied, which is `carried`, so
 *  `attempted` alone would report a twenty document ontology as having converted two. */
export interface OntologyConvertMetrics {
  total: number;
  attempted: number;
  succeeded: number;
  failed: number;
  carried: number;
}

/** What extraction produced. `failed` pages have no elements and so contribute
 *  nothing to the graph, which is one of the two reasons a build lands `partial`. */
export interface OntologyExtractMetrics {
  total: number;
  extracted: number;
  failed: number;
  /** Capped server-side, so a build that extracted nothing does not return every id. */
  pageIds: string[];
}

/** Who can open an ontology. Absent means private to its owner. */
export type OntologyVisibility = 'published';

/**
 * One line of the agent's activity trail. It covers CONSOLIDATE only, which is the
 * one stage a model runs inside the build invocation, so it is a diagnostic for the
 * job row rather than a picture of the whole build.
 */
export interface OntologyTrailEntry {
  type: 'message' | 'tool' | 'status';
  content: string;
  at: number;
}

export interface TriggerOntologyResponse {
  jobId: string;
}

export interface OntologyStatusResponse {
  jobId: string;
  title?: string;
  status: OntologyStatus;
  indexStatus?: OntologyIndexStatus;
  stage?: OntologyStage;
  progress?: OntologyProgress;
  convertProgress?: OntologyConvertProgress;
  /** Written once conversion is over, so absent while CONVERT is still running. */
  convert?: OntologyConvertMetrics;
  extract?: OntologyExtractMetrics;
  visibility?: OntologyVisibility | null;
  isOwner?: boolean;
  ownerEmail?: string;
  outputs: string[];
  docNames?: string[];
  /** Bronze keys, positionally matched to docNames. How a corpus update names the
   *  documents it is keeping. */
  docKeys?: string[];
  /** The build this one was derived from by a corpus update; absent on an ordinary
   *  build, which is how the stepper knows whether a run began by carrying forward. */
  sourceJobId?: string | null;
  /** Set when this build was derived to complete one that stopped short, which is a
   *  retry rather than a second ontology over the same documents. */
  redriveOf?: string | null;
  failedDocs?: string[];
  /** The same documents as bronze keys, which is the only handle a retry or a
   *  replacement can be submitted under. Appended live by the conversion Map and
   *  corrected by the fan-in, so it names failures while a build is still running.
   *  Resolve one to a filename by its position in docKeys. */
  failedDocKeys?: string[];
  /** How many times this build has already been sent back through conversion. */
  reviewRounds?: number;
  trail?: OntologyTrailEntry[];
  error?: string | null;
}

/** One saved ontology in the caller's library. */
export interface OntologySummary {
  jobId: string;
  title: string;
  status: OntologyStatus;
  indexStatus?: OntologyIndexStatus;
  /** Coarse stage, so an in-flight build reads as "Extracting" rather than "Building". */
  stage?: OntologyStage;
  progress?: OntologyProgress;
  /** Set when this build was derived from another by a corpus update, so the rail
   *  can mark it instead of listing two builds that share a title. */
  sourceJobId?: string | null;
  /** Set when this build was derived to complete one that stopped short. */
  redriveOf?: string | null;
  /** Absent on a private build. A published one is listed for every user. */
  visibility?: OntologyVisibility | null;
  /** False for a shared ontology someone else built, which is what decides whether
   *  publishing and deleting are offered at all. */
  isOwner?: boolean;
  ownerEmail?: string;
  createdAt: number;
  docNames: string[];
  docCount: number;
  /** Why the last purge stopped. Only ever set alongside a deleteFailed status. */
  deleteError?: string;
}

/** Presigned URLs for a finished build's gold artifacts, keyed by file name. */
export interface OntologyOutputsResponse {
  jobId: string;
  status: OntologyStatus;
  outputs: Record<string, string>;
}

/** Terminal states for the ontology poller. */
export const ONTOLOGY_TERMINAL: OntologyStatus[] = ['succeeded', 'failed', 'partial'];

/** Start an async ontology build over documents already uploaded to bronze under
 *  buildId. Returns the jobId (HTTP 202). A priorJobId extends that build's schema
 *  instead of consolidating a fresh one.
 *
 *  docNames are the original filenames, positionally matched to docKeys: bronze
 *  object names are opaque uuids, so this is the only point at which a name the user
 *  would recognise can be recorded. */
export async function triggerOntology(
  buildId: string,
  docKeys: string[],
  docNames: string[],
  title: string,
  priorJobId?: string
): Promise<TriggerOntologyResponse> {
  const response = await authFetch(`${API_URL}/ontology/build`, {
    method: 'POST',
    body: JSON.stringify({
      buildId,
      docKeys,
      docNames,
      title,
      ...(priorJobId ? { priorJobId } : {}),
    }),
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.message || 'Failed to start ontology build');
  return data;
}

/** Fetch an ontology build job's current status. */
export async function getOntologyStatus(jobId: string): Promise<OntologyStatusResponse> {
  const response = await authFetch(`${API_URL}/ontology/status?jobId=${encodeURIComponent(jobId)}`);
  const data = await response.json();
  if (!response.ok) throw new Error(data.message || 'Failed to get ontology status');
  return data;
}

/** List the signed-in user's saved ontologies, newest first. */
export async function listOntologies(): Promise<OntologySummary[]> {
  const response = await authFetch(`${API_URL}/ontology/builds`);
  const data = await response.json();
  if (!response.ok) throw new Error(data.message || 'Failed to list ontologies');
  return data.builds ?? [];
}

/** Presigned URLs for one build's gold outputs, keyed by artifact name. */
export async function getOntologyOutputs(jobId: string): Promise<OntologyOutputsResponse> {
  const response = await authFetch(
    `${API_URL}/ontology/builds/${encodeURIComponent(jobId)}/outputs`
  );
  const data = await response.json();
  if (!response.ok) throw new Error(data.message || 'Failed to load ontology outputs');
  return data;
}

/** Delete one ontology and every resource it created.
 *
 *  Returns as soon as the build is marked for deletion (HTTP 202): the teardown
 *  spans six services and runs in a worker, so the row stays listed as `deleting`
 *  until it is done and flips to `deleteFailed` if it is not. Calling this again
 *  on a failed build re-runs the purge. */
export async function deleteOntology(jobId: string): Promise<void> {
  const response = await authFetch(`${API_URL}/ontology/builds/${encodeURIComponent(jobId)}`, {
    method: 'DELETE',
  });
  if (!response.ok) {
    const data = await response.json();
    throw new Error(data.message || 'Failed to delete ontology');
  }
}

/** What a corpus update changes about a build. */
export interface UpdateCorpusRequest {
  /** A fresh build id the added documents were uploaded under. Becomes the new jobId. */
  buildId: string;
  addDocKeys: string[];
  addDocNames: string[];
  /** Source-build keys for the documents to keep. Anything omitted is dropped. */
  keepDocKeys: string[];
  title: string;
  /** Reuse the source build's schema so node ids stay stable across the update. */
  extendSchema: boolean;
}

/** Add or remove documents by deriving a new ontology from an existing one.
 *
 *  Returns the NEW build's jobId (HTTP 202). The source ontology is not modified and
 *  stays in the library: an update is a second build that carries the unchanged
 *  documents' converted markdown and extracted elements over, so only what actually
 *  changed is processed again. Poll the returned jobId exactly like a fresh build. */
export async function updateOntologyCorpus(
  sourceJobId: string,
  body: UpdateCorpusRequest
): Promise<TriggerOntologyResponse> {
  const response = await authFetch(
    `${API_URL}/ontology/builds/${encodeURIComponent(sourceJobId)}/corpus`,
    { method: 'POST', body: JSON.stringify(body) }
  );
  const data = await response.json();
  if (!response.ok) throw new Error(data.message || 'Failed to update this ontology');
  return data;
}

/** Finish a build that stopped short, by deriving a new one over the same corpus.
 *
 *  Returns the NEW build's jobId (HTTP 202), polled exactly like any other build. The
 *  source is untouched and stays in the library. Only what was actually lost is
 *  redone: the documents that converted have their markdown carried over and the
 *  pages that were extracted keep their elements, so a retry costs the failures and
 *  nothing else. Owner only, and only for a partial or failed ontology. */
export async function redriveOntology(sourceJobId: string): Promise<TriggerOntologyResponse> {
  const response = await authFetch(
    `${API_URL}/ontology/builds/${encodeURIComponent(sourceJobId)}/redrive`,
    { method: 'POST', body: JSON.stringify({ buildId: crypto.randomUUID() }) }
  );
  const data = await response.json();
  if (!response.ok) throw new Error(data.message || 'Failed to complete this ontology');
  return data;
}

/** Share one ontology with every other user, or take it back.
 *
 *  Nothing is copied. A published ontology is read where it already sits, so every
 *  other user can open its graph, ask questions of it, and derive new versions from
 *  it, while deleting it stays with whoever built it. Owner only. */
export async function publishOntology(jobId: string, published: boolean): Promise<void> {
  const response = await authFetch(
    `${API_URL}/ontology/builds/${encodeURIComponent(jobId)}/publish`,
    {
      method: published ? 'POST' : 'DELETE',
    }
  );
  if (!response.ok) {
    const data = await response.json();
    throw new Error(data.message || 'Failed to change who can see this ontology');
  }
}

/** What to do about the documents a build could not convert.
 *
 *  On a retry every failed document has to be accounted for, as either retried or
 *  dropped. A replacement is both at once: the original is dropped and the newly
 *  uploaded file joins addDocKeys. Leaving one unanswered is refused, because a
 *  document left in the corpus but out of the retry would never be converted again and
 *  the finished ontology would report a document it does not have. */
export interface ReviewBuildRequest {
  action: 'continue' | 'stop' | 'retry';
  /** Failed keys to convert again as they are. */
  retryDocKeys?: string[];
  /** Failed keys to abandon, including any that a replacement stands in for. */
  dropDocKeys?: string[];
  /** Replacements, already uploaded to bronze under this build's own id. */
  addDocKeys?: string[];
  addDocNames?: string[];
}

export interface ReviewBuildResponse {
  jobId: string;
  action: ReviewBuildRequest['action'];
  docCount: number;
}

/** Answer the conversion review a paused build is waiting on.
 *
 *  A build that lost documents to conversion stops before extraction, which is the
 *  expensive stage, and holds the execution open. This resumes it: `continue` builds
 *  from what converted, `stop` ends the build there and keeps everything it produced,
 *  and `retry` sends the chosen documents back through conversion inside the SAME
 *  build, so the jobId does not change and the page keeps polling the one it has. */
export async function reviewBuild(
  jobId: string,
  body: ReviewBuildRequest
): Promise<ReviewBuildResponse> {
  const response = await authFetch(
    `${API_URL}/ontology/builds/${encodeURIComponent(jobId)}/review`,
    { method: 'POST', body: JSON.stringify(body) }
  );
  const data = await response.json();
  if (!response.ok) throw new Error(data.message || 'Failed to answer the conversion review');
  return data;
}

/** One past conversation about an ontology, as the history list shows it. */
export interface OntologyConversationSummary {
  sessionId: string;
  createdAt: string;
}

/** One replayed turn of a past conversation. */
export interface OntologyConversationMessage {
  role: 'user' | 'assistant';
  content: string;
  timestamp: string;
}

/** List the caller's past conversations about one ontology, newest first. */
export async function listOntologyConversations(
  buildId: string
): Promise<OntologyConversationSummary[]> {
  const response = await authFetch(
    `${API_URL}/ontology/builds/${encodeURIComponent(buildId)}/conversations`
  );
  const data = await response.json();
  if (!response.ok) throw new Error(data.message || 'Failed to list conversations');
  return data.conversations ?? [];
}

/** Replay one past conversation about an ontology, oldest turn first. */
export async function getOntologyConversation(
  buildId: string,
  sessionId: string
): Promise<OntologyConversationMessage[]> {
  const response = await authFetch(
    `${API_URL}/ontology/builds/${encodeURIComponent(buildId)}/conversations/${encodeURIComponent(sessionId)}`
  );
  const data = await response.json();
  if (!response.ok) throw new Error(data.message || 'Failed to load conversation');
  return data.messages ?? [];
}
