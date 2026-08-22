import { AlertTriangle, Check } from 'lucide-react';

import { Badge } from '../../../components/ui/badge';
import { Button } from '../../../components/ui/button';
import { Spinner } from '../../../components/ui/spinner';
import BuildTitleInput from './BuildTitleInput';
import ConversionReview from './ConversionReview';
import CorpusDocumentList, { type CorpusDocument } from './CorpusDocumentList';
import CorpusDropzone from './CorpusDropzone';
import ErrorAlert from './ErrorAlert';
import OntologySteps from './OntologySteps';
import type { CorpusDoc, OntologyPhase } from '../hooks/useOntologyPipeline';
import type { OntologyStatusResponse, ReviewBuildRequest } from '../../../services/ontologyService';

interface BuildPhaseProps {
  phase: OntologyPhase;
  /** Documents added since the loaded build, or the whole corpus before a first one. */
  files: File[];
  onFilesChange: (files: File[]) => void;
  onRemoveFile: (index: number) => void;
  onReject: (message: string) => void;
  title: string;
  onTitleChange: (title: string) => void;
  error: string | null;
  /** The build on screen as the server holds it, which is what the stepper counts from
   *  and what the conversion review reads. Null until the first poll of a fresh run. */
  status: OntologyStatusResponse | null;
  /** True while the build is stopped at the conversion review and not yet answered. */
  awaitingReview: boolean;
  onReview: (body: ReviewBuildRequest) => Promise<void>;
  /** True when the build in flight carries documents forward from another one. */
  isUpdate: boolean;
  /** True once a build's corpus is known, which turns this phase into the corpus
   *  editor. It stays true across an update, so the documents do not blank out
   *  while one runs. */
  corpusLoaded: boolean;
  /** The loaded build's own documents that are still in the corpus. */
  keptDocs: CorpusDoc[];
  onRemoveKeptDoc: (index: number) => void;
  addedCount: number;
  removedCount: number;
  corpusSummary: string;
  onBuild: () => void;
  busy: boolean;
}

/**
 * Phase 1 — choose a corpus and run the pipeline, and afterwards the corpus editor
 * for the ontology that came out of it.
 *
 * Any loaded build can be edited, including one reopened from the library: its
 * documents are named by their bronze keys, so keeping one needs nothing from the
 * browser. Only added documents are uploaded, and the update carries the rest over
 * server-side rather than converting and extracting them again.
 */
export default function BuildPhase({
  phase,
  files,
  onFilesChange,
  onRemoveFile,
  onReject,
  title,
  onTitleChange,
  error,
  status,
  awaitingReview,
  onReview,
  isUpdate,
  corpusLoaded,
  keptDocs,
  onRemoveKeptDoc,
  addedCount,
  removedCount,
  corpusSummary,
  onBuild,
  busy,
}: BuildPhaseProps) {
  // The build's own documents first, then whatever was added on top. Removal is by
  // position within the list the user is looking at, so the two halves are indexed
  // separately behind one list.
  const documents: CorpusDocument[] = [
    ...keptDocs.map(doc => ({ name: doc.name, size: null, added: false })),
    ...files.map(file => ({ name: file.name, size: file.size, added: corpusLoaded })),
  ];

  const changedCount = addedCount + removedCount;
  const buildDisabled = documents.length === 0 || busy || (corpusLoaded && changedCount === 0);

  // A run in flight here, as opposed to `busy`, which also covers opening a saved
  // build. `corpusLoaded` goes true a few seconds into a FIRST build, because the
  // status poll starts carrying the corpus long before there is an ontology, so it
  // cannot be the thing that decides whether a run is an update. `isUpdate` can:
  // it is set at the moment the run is started and confirmed by the status.
  const running = phase === 'uploading' || phase === 'building';
  // A settled ontology, which is what the corpus editor's own copy is about. During
  // a run there is nothing to edit and nothing to act on.
  const editable = corpusLoaded && !running;

  const buildLabel = running
    ? isUpdate
      ? 'Updating…'
      : 'Building…'
    : corpusLoaded
      ? 'Update ontology'
      : 'Build ontology';
  // Named rather than merely greyed: a disabled primary action with no reason is the
  // one thing on this page a user cannot resolve by looking harder at it.
  const buildTitle = busy
    ? undefined
    : documents.length === 0
      ? 'An ontology needs at least one document'
      : corpusLoaded && changedCount === 0
        ? 'Add or remove a document to update'
        : undefined;

  // One index space over both halves, so the list does not have to know there are two.
  const removeAt = (index: number) =>
    index < keptDocs.length ? onRemoveKeptDoc(index) : onRemoveFile(index - keptDocs.length);

  return (
    <div className='min-h-0 flex-1 overflow-y-auto'>
      <div className='mx-auto flex max-w-[720px] flex-col gap-[15px] px-6 pb-16 pt-6'>
        {running || corpusLoaded ? (
          <div className='flex flex-wrap items-center gap-3 rounded-surface border border-accent-line bg-accent-soft px-[15px] py-3'>
            <span className='grid h-6 w-6 shrink-0 place-items-center rounded-full border border-accent-line text-cyan'>
              {awaitingReview ? (
                <AlertTriangle className='h-3.5 w-3.5 text-rose' />
              ) : busy ? (
                <Spinner size='sm' />
              ) : (
                <Check className='h-3.5 w-3.5' />
              )}
            </span>
            <span className='font-semibold text-ink'>
              {awaitingReview
                ? 'Waiting on you before it builds'
                : running
                  ? isUpdate
                    ? 'Building an updated ontology'
                    : 'Building your ontology'
                  : 'Ontology built'}
            </span>
            {corpusSummary && <span className='truncate text-sm text-ink-3'>{corpusSummary}</span>}
            {changedCount > 0 && (
              <Badge tone='warning' className='ml-auto'>
                {addedCount} added · {removedCount} removed since this build
              </Badge>
            )}
          </div>
        ) : (
          <p className='text-[13px] leading-relaxed text-ink-3'>
            Upload documents to build a knowledge graph. They are converted to markdown, then an
            agent extracts entities and relations per page, keys identical entities (and shared
            identifiers) into single nodes, and renders the result as an interactive graph. Ask
            questions of a finished ontology and the answer follows those shared entities across
            documents. Builds and questions both run on the Claude token saved on your profile.
          </p>
        )}

        {error && <ErrorAlert title='The build could not complete' message={error} />}

        {phase === 'loading' && (
          <div className='alert'>
            <Spinner size='sm' />
            <div className='min-w-0 flex-1'>
              <div className='font-semibold'>Opening ontology</div>
              <div className='mt-0.5'>Fetching the graph and schema for that build.</div>
            </div>
          </div>
        )}

        <div className='relative overflow-hidden rounded-surface border border-line bg-panel p-5'>
          <span
            aria-hidden
            className='pointer-events-none absolute inset-x-0 top-0 h-0.5'
            style={{ background: 'var(--grad-soft)' }}
          />
          <div className='flex flex-col gap-4'>
            <CorpusDropzone
              files={files}
              onFilesChange={onFilesChange}
              onReject={onReject}
              disabled={busy}
              compact={corpusLoaded}
            />

            <CorpusDocumentList
              documents={documents}
              removedCount={removedCount}
              hasBuild={editable}
              onRemove={removeAt}
              disabled={busy}
            />

            {editable && (
              <p className='text-xs leading-relaxed text-ink-4'>
                Updating creates a new ontology and leaves this one in your library. The documents
                you keep are carried over, so only the ones you add are read again.
              </p>
            )}

            <BuildTitleInput value={title} onChange={onTitleChange} disabled={busy} />

            <div className='mt-[18px] flex flex-wrap items-center justify-between gap-3'>
              <span className='text-sm tabular-nums text-ink-3'>
                {documents.length > 0 ? corpusSummary : 'No documents selected yet'}
              </span>
              <Button onClick={onBuild} disabled={buildDisabled} loading={busy} title={buildTitle}>
                {buildLabel}
              </Button>
            </div>

            {(phase === 'uploading' || phase === 'building') && (
              <OntologySteps
                stage={status?.stage}
                progress={status?.progress}
                convertProgress={status?.convertProgress}
                extract={status?.extract}
                failedDocKeys={status?.failedDocKeys}
                docKeys={status?.docKeys}
                docNames={status?.docNames}
                uploading={phase === 'uploading'}
                isUpdate={isUpdate}
              />
            )}

            {/* Below the stepper rather than above it, because the stepper is what
                explains why the build has stopped where it has. */}
            {awaitingReview && status && <ConversionReview status={status} onSubmit={onReview} />}
          </div>
        </div>
      </div>
    </div>
  );
}
