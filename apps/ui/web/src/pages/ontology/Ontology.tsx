import { useEffect, useMemo, useState } from 'react';

import { useTheme } from '../../hooks/useTheme';
import AskPhase from './components/AskPhase';
import BuildPhase from './components/BuildPhase';
import BuildReport from './components/BuildReport';
import OntologyLibraryRail from './components/OntologyLibraryRail';
import OntologyPageBar, { type OntologyView } from './components/OntologyPageBar';
import OntologyPhase, { type OntologySubView } from './components/OntologyPhase';
import UpdateConfirmDialog from './components/UpdateConfirmDialog';
import { useOntologyChat } from './hooks/useOntologyChat';
import { useOntologyConversations } from './hooks/useOntologyConversations';
import {
  useOntologyPipeline,
  type OntologyPhase as PipelinePhase,
} from './hooks/useOntologyPipeline';
import { makeTypeColorMap, readPalette } from './utils/graphColors';
import type { OntologySummary, ReviewBuildRequest } from '../../services/ontologyService';

/** Reuse the loaded build's schema on an update, so node ids survive it. */
const DEFAULT_EXTEND_SCHEMA = true;

/**
 * Ontology page — upload a set of documents, build a knowledge graph from them
 * (the documents are converted to markdown, then an agent extracts per page,
 * consolidates the schema and keys identical entities into shared nodes, all
 * server-side and on your own Claude subscription), explore the result as an
 * interactive force-directed graph, read the consolidated schema, and ask
 * questions of it.
 *
 * A workspace of three numbered phases rather than a scrolling stack: building,
 * reading and asking each want the whole width, and they are a sequence — there is
 * nothing to look at before a build and nothing to ask before there is a graph. The
 * library of past builds is the one thing that spans all three, so it is a rail.
 *
 * Asking is the reason the graph exists rather than plain search: a question whose
 * answer is split across documents that never mention each other is answered by
 * walking the entity they share. That is why a finished build opens on Ask.
 *
 * Past builds are stored per user, so an ontology can be reopened later without
 * rebuilding it, and any loaded build's corpus can be edited. Adding or removing a
 * document derives a NEW ontology rather than changing this one: the documents that
 * stayed have their converted markdown and extracted elements carried over
 * server-side, so only what actually changed is processed again, and the ontology
 * being edited stays in the library alongside its conversations.
 */
export default function Ontology() {
  const [rejectError, setRejectError] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [title, setTitle] = useState('');
  // Bumped when a build reaches a terminal state so the saved list refetches.
  const [libraryKey, setLibraryKey] = useState(0);
  // Which phase the user chose, and the pipeline phase they chose it under. Pairing
  // the two is what makes the workspace follow the work: a build finishing, or a
  // reset, invalidates the old choice rather than stranding the user on a phase that
  // no longer has anything in it.
  const [viewChoice, setViewChoice] = useState<{ phase: PipelinePhase; view: OntologyView } | null>(
    null
  );
  const [subView, setSubView] = useState<OntologySubView>('graph');
  const [railCollapsed, setRailCollapsed] = useState(false);
  const [legendOpen, setLegendOpen] = useState(true);
  const [confirmUpdate, setConfirmUpdate] = useState(false);
  const [showReport, setShowReport] = useState(false);
  const [extendSchema, setExtendSchema] = useState(DEFAULT_EXTEND_SCHEMA);
  // The pending edit to the corpus, stamped with the build it applies to: which of
  // that build's documents were dropped, and which files were added. Stamping it is
  // what discards the edit when another build is loaded, without an effect that would
  // set state during a render pass. An empty owner is the no-build-yet case, which is
  // stable while a first corpus is being picked.
  const [edit, setEdit] = useState<{ owner: string; removed: string[]; files: File[] }>({
    owner: '',
    removed: [],
    files: [],
  });

  const { theme } = useTheme();
  const {
    phase,
    status,
    detail,
    result,
    error: pipelineError,
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
  } = useOntologyPipeline();
  const activeBuildId = phase === 'done' ? jobId : null;
  const chat = useOntologyChat(activeBuildId);
  const conversations = useOntologyConversations(activeBuildId);

  // Palette recomputes on a light/dark flip so the canvas repaints without re-simulating.
  const palette = useMemo(() => readPalette(), [theme]);
  const typeColors = useMemo(
    () => makeTypeColorMap(result ? result.nodes.map(n => n.type) : [], palette),
    [result, palette]
  );
  const nodeById = useMemo(() => new Map(result?.nodes.map(n => [n.id, n]) ?? []), [result]);
  const selectedNode = selectedId ? (nodeById.get(selectedId) ?? null) : null;

  const busy = phase === 'uploading' || phase === 'building' || phase === 'loading';
  const hasResult = phase === 'done' && result !== null;

  // A finished or failed build changes the library, so refetch it once the phase
  // settles rather than polling the list alongside the status.
  useEffect(() => {
    if (phase === 'done' || phase === 'error') setLibraryKey(k => k + 1);
  }, [phase]);

  // A result arriving moves the workspace on to it. Ask rather than Ontology: the
  // graph is the apparatus, the question is the point, and the graph is one click
  // away in the phase nav either way.
  const view = viewChoice?.phase === phase ? viewChoice.view : hasResult ? 'ask' : 'build';
  const setView = (next: OntologyView) => setViewChoice({ phase, view: next });

  const combinedError = rejectError || pipelineError;

  // A loaded build whose corpus can be edited. Independent of how it got here: one
  // built in this session and one reopened from the library are both addressed by
  // their bronze keys, so both are editable.
  //
  // Deliberately not gated on `hasResult`, which is false for the whole of an update:
  // the corpus is what phase 1 is about, and it has to survive the run rather than
  // blanking back to the empty picker. A failed build is excluded because its own
  // documents are the wrong thing to derive the next ontology from.
  const corpusLoaded = docs !== null && jobId !== null && phase !== 'error';
  const owner = corpusLoaded ? jobId : '';
  // Any edit stamped with a different build belongs to one no longer on screen.
  const current = edit.owner === owner ? edit : { owner, removed: [], files: [] };
  const files = current.files;

  const keptDocs = useMemo(
    () => (docs ?? []).filter(doc => !current.removed.includes(doc.key)),
    [docs, current.removed]
  );

  const setFiles = (next: File[]) => setEdit({ ...current, files: next });
  const removeKeptDoc = (index: number) =>
    setEdit({ ...current, removed: [...current.removed, keptDocs[index].key] });
  const removeFile = (index: number) =>
    setEdit({ ...current, files: files.filter((_, i) => i !== index) });

  const corpusSummary = useMemo(() => {
    const total = (corpusLoaded ? keptDocs.length : 0) + files.length;
    if (total === 0) return '';
    const bytes = files.reduce((sum, f) => sum + f.size, 0);
    // Only the added files have a size. A carried document lives in the lake and the
    // browser never held it, so a total would be wrong rather than merely missing.
    const size =
      bytes >= 1024 * 1024
        ? `${(bytes / (1024 * 1024)).toFixed(1)} MB`
        : `${(bytes / 1024).toFixed(0)} KB`;
    const suffix = corpusLoaded && files.length > 0 ? ` · ${size} added` : ` · ${size}`;
    return `${total} document${total === 1 ? '' : 's'}${suffix}`;
  }, [corpusLoaded, keptDocs, files]);

  const corpusDiff = {
    added: corpusLoaded ? files.length : 0,
    removed: corpusLoaded ? current.removed.length : 0,
  };

  const startBuild = () => {
    setRejectError(null);
    setSelectedId(null);
    setConfirmUpdate(false);
    if (corpusLoaded) {
      // Derives a new ontology rather than rebuilding this one. Only the added files
      // are uploaded; the kept documents are carried over server-side, so the work
      // is proportional to the change rather than to the corpus.
      void updateCorpus(jobId, keptDocs, files, title.trim(), extendSchema);
      return;
    }
    build(files, title.trim());
  };

  // An update re-runs stages that take minutes to hours and cannot be cancelled, so
  // it asks first. A first build has nothing to lose and does not.
  const handleBuild = () => {
    if (corpusLoaded && corpusDiff.added + corpusDiff.removed > 0) {
      setConfirmUpdate(true);
      return;
    }
    startBuild();
  };

  // Two ways in, decided by the row's own status. A finished build has outputs to
  // fetch; one still running has none yet, so it is watched instead and resolves
  // into the explorer through the same terminal path a build started here does.
  const handleOpenSaved = (saved: OntologySummary) => {
    setRejectError(null);
    setSelectedId(null);
    setTitle(saved.title ?? '');
    setExtendSchema(DEFAULT_EXTEND_SCHEMA);
    // A build paused on the conversion review is watched rather than opened for the
    // same reason a running one is: it has no outputs yet, and re-attaching the poller
    // is what puts the review back on screen so it can still be answered.
    if (
      saved.status === 'queued' ||
      saved.status === 'processing' ||
      saved.status === 'awaitingReview'
    ) {
      watch(saved.jobId, Boolean(saved.sourceJobId));
      return;
    }
    void open(saved.jobId, saved.status);
  };

  const handleNewOntology = () => {
    setSelectedId(null);
    setRejectError(null);
    setTitle('');
    setConfirmUpdate(false);
    setExtendSchema(DEFAULT_EXTEND_SCHEMA);
    setViewChoice(null);
    // Detaches this page from the build; it keeps running server-side and turns up
    // finished in the rail. Clearing `docs` re-seeds the corpus editor empty.
    reset();
  };

  // A retry is a new build, so the page follows it the same way it follows one
  // reopened mid-run. It is derived, which is what keeps the stepper's first stage
  // honest about the documents being carried rather than converted.
  const handleRedriven = (newJobId: string) => {
    setShowReport(false);
    setSelectedId(null);
    setViewChoice(null);
    watch(newJobId, true);
  };

  // Answering the conversion review resumes the SAME execution, so unlike a redrive
  // there is no new build to follow and nothing on screen to swap out. The poller
  // picks the build back up from where it paused.
  const handleReview = (body: ReviewBuildRequest) => submitReview(jobId as string, body);

  // Deleting the build that is loaded would leave the explorer showing a graph
  // whose artifacts are on their way out, so clear it.
  const handleDeleted = (deletedJobId: string) => {
    if (deletedJobId === jobId) handleNewOntology();
  };

  return (
    <div className='flex h-full flex-col overflow-hidden'>
      <OntologyPageBar
        view={view}
        onViewChange={setView}
        hasResult={hasResult}
        askConfigured={chat.configured}
      />

      <div className='flex min-h-0 flex-1'>
        <OntologyLibraryRail
          onOpen={handleOpenSaved}
          onNewOntology={handleNewOntology}
          activeJobId={jobId}
          refreshKey={libraryKey}
          onDeleted={handleDeleted}
          disabled={busy}
          collapsed={railCollapsed}
          onToggleCollapsed={() => setRailCollapsed(value => !value)}
        />

        {view === 'build' && (
          <BuildPhase
            phase={phase}
            files={files}
            onFilesChange={setFiles}
            onRemoveFile={removeFile}
            onReject={setRejectError}
            title={title}
            onTitleChange={setTitle}
            error={combinedError}
            status={status}
            awaitingReview={awaitingReview}
            onReview={handleReview}
            isUpdate={isUpdate}
            corpusLoaded={corpusLoaded}
            keptDocs={keptDocs}
            onRemoveKeptDoc={removeKeptDoc}
            addedCount={corpusDiff.added}
            removedCount={corpusDiff.removed}
            corpusSummary={corpusSummary}
            onBuild={handleBuild}
            busy={busy}
          />
        )}

        {view === 'ontology' && hasResult && result && (
          <OntologyPhase
            result={result}
            jobId={jobId}
            isPartial={isPartial}
            palette={palette}
            typeColors={typeColors}
            selectedId={selectedId}
            onSelect={setSelectedId}
            selectedNode={selectedNode}
            subView={subView}
            onSubViewChange={setSubView}
            legendOpen={legendOpen}
            onToggleLegend={() => setLegendOpen(value => !value)}
            onShowReport={detail ? () => setShowReport(true) : undefined}
          />
        )}

        {view === 'ask' && hasResult && (
          <AskPhase
            messages={chat.messages}
            trail={chat.trail}
            streamingAnswer={chat.streamingAnswer}
            asking={chat.asking}
            isRestoring={chat.isRestoring}
            error={chat.error}
            indexStatus={chat.indexStatus}
            configured={chat.configured}
            conversations={conversations.conversations}
            conversationsError={conversations.error}
            activeSessionId={chat.activeSessionId}
            onAsk={question => chat.ask(question, conversations.refresh)}
            onNewConversation={chat.newConversation}
            onSelectConversation={chat.loadConversation}
            onRefreshConversations={conversations.refresh}
          />
        )}
      </div>

      <BuildReport
        isOpen={showReport}
        onClose={() => setShowReport(false)}
        status={detail}
        onRedriven={handleRedriven}
      />

      <UpdateConfirmDialog
        open={confirmUpdate}
        addedCount={corpusDiff.added}
        removedCount={corpusDiff.removed}
        extendSchema={extendSchema}
        onExtendSchemaChange={setExtendSchema}
        onCancel={() => setConfirmUpdate(false)}
        onConfirm={startBuild}
      />
    </div>
  );
}
