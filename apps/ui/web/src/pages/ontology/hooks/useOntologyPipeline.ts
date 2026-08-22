/**
 * useOntologyPipeline — drives the full ontology build from the UI.
 *
 * Phase machine: idle -> uploading (presign + PUT each document into bronze) ->
 * building (one useSyncPoller over /ontology/status) -> done (fetch + parse the gold
 * outputs) | error. Mirrors Converter.tsx's cancelled-flag guard so a reset or
 * unmount can't land a stale result.
 *
 * The browser mints the buildId, uploads under it, and passes it to the build — so
 * the prefix the user wrote to is the same prefix the agent reads from, and no key
 * is ever assembled client-side.
 *
 * `open` loads a previously saved ontology straight from its gold outputs, which is
 * the same fetch-and-parse path a fresh build's results take.
 *
 * `watch` is the other half of that: it re-attaches to a build that is still running,
 * which is what makes a reload survivable. A build outlives the page that started it,
 * so without this the only view of an hours-long run is lost to a refresh.
 *
 * `updateCorpus` runs the same machine over a changed document set: it uploads only
 * what was added and lets the server carry the rest forward, so the phases after it
 * are indistinguishable from a fresh build's.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';

import { useSyncPoller } from '../../../hooks/useSyncPoller';
import { getBronzeUploadUrl } from '../../../services/datalakeService';
import { uploadFile } from '../../../services/utilityService';
import {
  getOntologyOutputs,
  getOntologyStatus,
  ONTOLOGY_TERMINAL,
  reviewBuild,
  triggerOntology,
  updateOntologyCorpus,
  type OntologyStatusResponse,
  type ReviewBuildRequest,
} from '../../../services/ontologyService';
import type { ParsedOntology } from '../types/ontology';
import {
  buildGraphData,
  parseChunks,
  parseEdges,
  parseNodes,
  parsePages,
  parseSchema,
} from '../utils/parseOutputs';

export type OntologyPhase = 'idle' | 'uploading' | 'building' | 'loading' | 'done' | 'error';

/** One document of the loaded build's corpus, as the server holds it.
 *
 *  The key is what an update names a document by, and it is the only durable handle:
 *  bronze object names are opaque uuids and the browser has no File to resubmit for a
 *  build it did not upload. Carrying the key is what makes a reopened ontology's
 *  corpus editable at all. */
export interface CorpusDoc {
  key: string;
  name: string;
}

/** Pair the server's positionally-matched key and name lists back up. */
function corpusDocs(status: Pick<OntologyStatusResponse, 'docKeys' | 'docNames'>): CorpusDoc[] {
  const keys = status.docKeys ?? [];
  const names = status.docNames ?? [];
  return keys.map((key, i) => ({ key, name: names[i] || key.split('/').pop() || key }));
}

// A build reads every page with a model, so even fanned out across the extraction
// Map it runs far longer than the ~15 min the default 90 attempts gave. 900 attempts
// x 10s is a 2.5-hour cap, and the state machine's own budget is longer still: a
// large corpus can outlast this poller and be finished when the page is reopened.
const MAX_POLL_ATTEMPTS = 900;

async function fetchOutputText(url?: string): Promise<string> {
  if (!url) return '';
  const res = await fetch(url);
  if (!res.ok) throw new Error('Failed to download an ontology output');
  return res.text();
}

/** Fetch and parse the gold artifacts the page renders. The build also emits
 *  telemetry.json, which nothing reads since the metrics panel was dropped, so it
 *  is left unfetched rather than parsed and discarded. */
async function loadOutputs(jobId: string): Promise<ParsedOntology> {
  const { outputs } = await getOntologyOutputs(jobId);
  const [nodesCsv, edgesCsv, chunksCsv, pagesCsv, schemaJson] = await Promise.all([
    fetchOutputText(outputs['nodes.csv']),
    fetchOutputText(outputs['edges.csv']),
    fetchOutputText(outputs['chunks.csv']),
    fetchOutputText(outputs['pages.csv']),
    fetchOutputText(outputs['schema.json']),
  ]);
  const nodes = parseNodes(nodesCsv);
  const edges = parseEdges(edgesCsv);
  return {
    graph: buildGraphData(nodes, edges),
    nodes,
    chunks: parseChunks(chunksCsv),
    pages: parsePages(pagesCsv),
    schema: parseSchema(schemaJson),
  };
}

export function useOntologyPipeline() {
  const [phase, setPhase] = useState<OntologyPhase>('idle');
  const [jobId, setJobId] = useState<string | null>(null);
  const [result, setResult] = useState<ParsedOntology | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Set when a saved ontology is opened, so the page can show its status badge
  // without a poll having run.
  const [openedStatus, setOpenedStatus] = useState<OntologyStatusResponse['status'] | null>(null);
  // The last full status seen for the build on screen. The poller stops at the
  // terminal one and is disabled entirely for a build opened from the library, so
  // without this the account of what the build lost would vanish the moment it was
  // finished — which is exactly when it is worth reading.
  const [loadedStatus, setLoadedStatus] = useState<OntologyStatusResponse | null>(null);
  // The loaded build's corpus. Whatever put a build on screen sets it, so the corpus
  // editor works the same for one built here and one reopened from the library.
  const [loadedDocs, setLoadedDocs] = useState<CorpusDoc[] | null>(null);
  // Whether the run in flight was started as an update. Held here as well as read
  // from the status, because the first poll is five seconds out and the stepper would
  // otherwise open on the wrong stage and correct itself.
  const [startedAsUpdate, setStartedAsUpdate] = useState(false);
  // Bumped every time the conversion review is answered, purely to give `fetchStatus` a
  // new identity so the poller's effect re-runs. The gate stops the poller, and this is
  // what starts it again on the same job.
  const [reviewNonce, setReviewNonce] = useState(0);
  // True between answering the review and the first poll that reflects the answer. The
  // poller waits five seconds before its first request, so without this the panel the
  // user just dismissed would sit there, still offering the choice they had made.
  const [reviewPending, setReviewPending] = useState(false);

  const fetchStatus = useCallback(
    () => getOntologyStatus(jobId as string),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [jobId, reviewNonce]
  );
  // The gate counts as terminal HERE and nowhere else. A build waiting on a review can
  // wait longer than the poller's own ceiling, and polling it to that ceiling would end
  // in a timeout error over a build that is doing exactly what it was asked to. Nothing
  // downstream treats it as finished: the resolution effect below ignores it, and
  // answering the review restarts the poll.
  const isTerminal = useCallback(
    (s: OntologyStatusResponse) =>
      ONTOLOGY_TERMINAL.includes(s.status) || s.status === 'awaitingReview',
    []
  );
  const { status: polled, error: pollError } = useSyncPoller<OntologyStatusResponse>({
    fetchStatus,
    isTerminal,
    enabled: phase === 'building' && !!jobId,
    maxAttempts: MAX_POLL_ATTEMPTS,
  });

  // The poller keeps its last status when it restarts, so until the first request of
  // a new build lands, `polled` still describes the previous one. Reading it then
  // would resolve a build that has not started from another build's outputs.
  const status = polled && polled.jobId === jobId ? polled : null;

  // The job row carries the whole corpus from the moment the build is created, so a
  // build in flight can name its documents without waiting to finish. Derived rather
  // than assigned from an effect, both to avoid a cascading render and because the
  // polled keys are the rebased ones an update writes.
  const docs = useMemo(
    () => (phase === 'building' && status?.docKeys?.length ? corpusDocs(status) : loadedDocs),
    [phase, status, loadedDocs]
  );

  // Resolve a terminal job: succeeded/partial -> fetch + parse the gold outputs.
  useEffect(() => {
    if (!status || phase !== 'building' || !jobId) return;
    if (status.status === 'succeeded' || status.status === 'partial') {
      let cancelled = false;
      (async () => {
        try {
          const parsed = await loadOutputs(jobId);
          if (cancelled) return;
          setResult(parsed);
          // The poll that just went terminal already carries the corpus, so this
          // build's documents are known without a second request.
          setLoadedDocs(corpusDocs(status));
          setLoadedStatus(status);
          setPhase('done');
        } catch (e) {
          if (cancelled) return;
          setError(e instanceof Error ? e.message : 'Failed to load ontology results');
          setPhase('error');
        }
      })();
      return () => {
        cancelled = true;
      };
    }
    if (status.status === 'failed') {
      setLoadedStatus(status);
      setError(status.error || 'Ontology build failed');
      setPhase('error');
    }
  }, [status, phase, jobId]);

  useEffect(() => {
    if (pollError) {
      setError(pollError);
      setPhase('error');
    }
  }, [pollError]);

  // The answer has landed once the build says something other than "waiting". Cleared
  // from the status rather than on a timer, so a review that was accepted but whose
  // build has not moved yet keeps the panel closed instead of flickering it back.
  useEffect(() => {
    if (status && status.status !== 'awaitingReview') setReviewPending(false);
  }, [status]);

  const build = useCallback(async (files: File[], title: string, priorJobId?: string) => {
    if (files.length === 0) return;
    setError(null);
    setResult(null);
    setJobId(null);
    setOpenedStatus(null);
    setLoadedDocs(null);
    setLoadedStatus(null);
    setStartedAsUpdate(false);
    setReviewPending(false);
    setPhase('uploading');

    // One build id for the whole corpus — it becomes the users/{sub}/{buildId}/
    // prefix in every lake layer and the job id itself.
    const buildId = crypto.randomUUID();
    try {
      const keys = await Promise.all(
        files.map(async file => {
          const { presignedUrl, key } = await getBronzeUploadUrl(buildId, file.name);
          await uploadFile(presignedUrl, file, 'application/octet-stream');
          return key;
        })
      );
      // Bronze object names are opaque uuids, so the filenames go with the build —
      // otherwise a document that fails to convert can only be named by its uuid.
      const names = files.map(file => file.name);
      const { jobId: newJobId } = await triggerOntology(buildId, keys, names, title, priorJobId);
      setJobId(newJobId);
      setPhase('building');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Upload failed');
      setPhase('error');
    }
  }, []);

  /** Add or remove documents by deriving a new build from the one on screen.
   *
   *  Only the added files are uploaded, and only under the new build id. Everything
   *  the user kept is carried over server-side from the source build's own prefixes,
   *  which is what stops an update re-converting and re-extracting a corpus that has
   *  not changed. The source ontology is untouched and stays in the library.
   *
   *  Nothing on screen is discarded until the new build exists, so a request that is
   *  refused — a corpus with no schema to reuse, an expired session — leaves the
   *  ontology loaded and the user's edit intact to correct and send again. */
  const updateCorpus = useCallback(
    async (
      sourceJobId: string,
      keepDocs: CorpusDoc[],
      addFiles: File[],
      title: string,
      extendSchema: boolean
    ) => {
      setError(null);
      setPhase('uploading');

      const buildId = crypto.randomUUID();
      try {
        const addDocKeys = await Promise.all(
          addFiles.map(async file => {
            const { presignedUrl, key } = await getBronzeUploadUrl(buildId, file.name);
            await uploadFile(presignedUrl, file, 'application/octet-stream');
            return key;
          })
        );
        const { jobId: newJobId } = await updateOntologyCorpus(sourceJobId, {
          buildId,
          addDocKeys,
          addDocNames: addFiles.map(file => file.name),
          keepDocKeys: keepDocs.map(doc => doc.key),
          title,
          extendSchema,
        });
        // Only now is the ontology on screen the wrong answer.
        setResult(null);
        setOpenedStatus(null);
        setLoadedStatus(null);
        setJobId(newJobId);
        setStartedAsUpdate(true);
        setReviewPending(false);
        // The corpus the new build was given, so the phase never blanks in the gap
        // before its first poll. The kept keys still name the source's prefix — the
        // server rebases them — but nothing can be submitted while a build runs, and
        // the first poll replaces them with the build's own.
        setLoadedDocs([
          ...keepDocs,
          ...addFiles.map((file, i) => ({ key: addDocKeys[i], name: file.name })),
        ]);
        setPhase('building');
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Upload failed');
        // Back to the build that is still loaded rather than to the error phase:
        // nothing was replaced, so the page has a result to show and the message
        // belongs beside the corpus the user was editing.
        setPhase('done');
      }
    },
    []
  );

  /** Answer the conversion review the build on screen is paused on.
   *
   *  Unlike an update or a redrive this does not derive anything: the paused execution
   *  is resumed in place, so the jobId is unchanged and the page goes on watching the
   *  build it was already watching. Bumping the nonce is what restarts the poller,
   *  which the gate stopped. */
  const submitReview = useCallback(async (reviewJobId: string, body: ReviewBuildRequest) => {
    await reviewBuild(reviewJobId, body);
    setReviewPending(true);
    setReviewNonce(nonce => nonce + 1);
  }, []);

  const open = useCallback(
    async (savedJobId: string, savedStatus: OntologyStatusResponse['status']) => {
      setError(null);
      setResult(null);
      setLoadedDocs(null);
      setLoadedStatus(null);
      setStartedAsUpdate(false);
      setReviewPending(false);
      setJobId(savedJobId);
      setOpenedStatus(savedStatus);
      setPhase('loading');
      try {
        // Fetched rather than taken from the library listing: the listing carries
        // names but not the bronze keys, and a key is what an update keeps a
        // document by.
        const [parsed, saved] = await Promise.all([
          loadOutputs(savedJobId),
          getOntologyStatus(savedJobId),
        ]);
        setLoadedDocs(corpusDocs(saved));
        setLoadedStatus(saved);
        setResult(parsed);
        setPhase('done');
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Failed to load that ontology');
        setPhase('error');
      }
    },
    []
  );

  /** Re-attach to a build that is still running, and follow it to its result.
   *
   *  The short half of `open`: there are no outputs to fetch yet, so this only points
   *  the poller at the job and lets the machine take it from there. When the build
   *  finishes, the terminal-resolution effect above loads it exactly as it would have
   *  for a build started on this page, so a resumed run lands in the explorer by the
   *  same path rather than a second one.
   *
   *  `isDerived` comes from the library listing's sourceJobId. Seeding it here keeps
   *  the stepper off the wrong stage for the five seconds before the first poll,
   *  which is the same reason `updateCorpus` sets it. */
  const watch = useCallback((runningJobId: string, isDerived: boolean) => {
    setError(null);
    setResult(null);
    setLoadedDocs(null);
    setLoadedStatus(null);
    setOpenedStatus(null);
    setStartedAsUpdate(isDerived);
    setReviewPending(false);
    setJobId(runningJobId);
    setPhase('building');
  }, []);

  const reset = useCallback(() => {
    setPhase('idle');
    setJobId(null);
    setResult(null);
    setError(null);
    setOpenedStatus(null);
    setLoadedDocs(null);
    setLoadedStatus(null);
    setStartedAsUpdate(false);
    setReviewPending(false);
  }, []);

  // What the build report reads: the live status while one is running, and the last
  // one seen once it is not. A build opened from the library never polls at all, so
  // for that path this is the only status there is.
  const detail = status ?? loadedStatus;

  const isPartial = (openedStatus ?? status?.status) === 'partial';
  // Paused after conversion with documents it could not convert, and not yet answered.
  const awaitingReview = status?.status === 'awaitingReview' && !reviewPending;
  // A build derived from another one, which is the only kind that carries documents
  // forward. The stepper asks so it does not credit a stage an ordinary build skips.
  const isUpdate = startedAsUpdate || Boolean(status?.sourceJobId);

  return useMemo(
    () => ({
      phase,
      status,
      detail,
      result,
      error,
      isPartial,
      awaitingReview,
      isUpdate,
      jobId,
      docs,
      build,
      updateCorpus,
      submitReview,
      open,
      watch,
      reset,
    }),
    [
      phase,
      status,
      detail,
      result,
      error,
      isPartial,
      awaitingReview,
      isUpdate,
      jobId,
      docs,
      build,
      updateCorpus,
      submitReview,
      open,
      watch,
      reset,
    ]
  );
}
