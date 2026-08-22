import { useCallback, useEffect, useMemo, useState } from 'react';
import { ChevronLeft, ChevronRight, Library, Plus, RefreshCw } from 'lucide-react';

import { type BadgeTone } from '../../../components/ui/badge';
import { Button } from '../../../components/ui/button';
import { Spinner } from '../../../components/ui/spinner';
import { cn } from '../../../lib/utils';
import {
  listOntologies,
  publishOntology,
  type OntologyStatus,
  type OntologySummary,
} from '../../../services/ontologyService';
import { STAGE_BADGE_LABEL } from '../utils/stageLabels';
import DeleteOntologyModal from './DeleteOntologyModal';
import OntologyLibraryCard from './OntologyLibraryCard';

interface OntologyLibraryRailProps {
  /** Load a saved build's graph and schema into the explorer. */
  onOpen: (build: OntologySummary) => void;
  /** Clear the page back to an empty corpus. */
  onNewOntology: () => void;
  /** The build currently loaded, so the list can frame it. */
  activeJobId?: string | null;
  /** Bumped after a build finishes so the list picks the new entry up. */
  refreshKey?: number;
  /** A build was sent for deletion, so the page can drop it if it was open. */
  onDeleted?: (jobId: string) => void;
  disabled?: boolean;
  collapsed: boolean;
  onToggleCollapsed: () => void;
}

const STATUS_TONE: Record<OntologyStatus, BadgeTone> = {
  succeeded: 'positive',
  partial: 'warning',
  failed: 'warning',
  awaitingReview: 'warning',
  processing: 'brand',
  queued: 'neutral',
  deleting: 'neutral',
  deleteFailed: 'warning',
};

const STATUS_LABEL: Record<OntologyStatus, string> = {
  succeeded: 'Ready',
  partial: 'Partial',
  failed: 'Failed',
  awaitingReview: 'Needs review',
  processing: 'Building',
  queued: 'Queued',
  deleting: 'Deleting',
  deleteFailed: 'Delete failed',
};

/** Dot colour for the collapsed rail, where there is no room for a word. */
const STATUS_DOT: Record<OntologyStatus, string> = {
  succeeded: 'var(--cyan)',
  partial: 'var(--rose)',
  failed: 'var(--rose)',
  awaitingReview: 'var(--rose)',
  processing: 'var(--indigo)',
  queued: 'var(--ink-3)',
  deleting: 'var(--ink-3)',
  deleteFailed: 'var(--rose)',
};

/** How often the list re-checks a build that is being torn down. */
const DELETING_POLL_MS = 5000;

/** Statuses a row can be opened from: a finished build loads its graph, and one still
 *  running is re-attached to and followed to its result. A build paused on the
 *  conversion review is in the second group, and is the one row here that has to be
 *  openable: the decision it is waiting for cannot be made anywhere else. */
const OPENABLE_STATUSES: OntologyStatus[] = [
  'succeeded',
  'partial',
  'queued',
  'processing',
  'awaitingReview',
];

/**
 * What a build's badge says. A finished build is named by its status; one still
 * running is named by the stage it is in, so "Converting" and "Extracting 7/12" are
 * distinguishable rather than both reading as "Building".
 */
function badgeLabel(build: OntologySummary): string {
  if (build.status !== 'processing') return STATUS_LABEL[build.status];

  const stage = build.stage && STAGE_BADGE_LABEL[build.stage];
  if (!stage) return STATUS_LABEL.processing;

  const { done, total } = build.progress ?? { done: 0, total: 0 };
  return build.stage === 'EXTRACT' && total > 0 ? `${stage} ${done}/${total}` : stage;
}

/**
 * How a derived build names the one it came from.
 *
 * The source may since have been deleted, and this rail only knows the titles it was
 * listed, so an unresolved id says so rather than inventing a name for it.
 *
 * A retry says so separately: it was derived over the same corpus to finish a build
 * that stopped short, which is a different thing from an ontology whose documents
 * changed.
 */
function derivedFrom(build: OntologySummary, builds: OntologySummary[]): string | undefined {
  const sourceId = build.redriveOf || build.sourceJobId;
  if (!sourceId) return undefined;

  const verb = build.redriveOf ? 'Completes' : 'Updated from';
  const source = builds.find(other => other.jobId === sourceId);
  return source?.title ? `${verb} "${source.title}"` : `${verb} an earlier build`;
}

/** A build can only be shared once it has produced a graph for someone to open. */
const SHAREABLE_STATUSES: OntologyStatus[] = ['succeeded', 'partial'];

function formatCreated(createdAt: number): string {
  return new Date(createdAt * 1000).toLocaleString(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short',
  });
}

/**
 * The signed-in user's saved ontologies, docked beside every phase of the page.
 *
 * It is a rail rather than a panel because it is the one thing that spans the
 * workflow: starting a new ontology and returning to an old one are both "which
 * ontology am I working on", and that question outlives whichever phase is open.
 *
 * A finished build opens its graph and a running one is re-attached to and followed,
 * so a reload never strands a build in progress. Only a failed or deleting entry is
 * listed without being selectable, having nothing to open.
 *
 * Ontologies other people have published are listed in their own section rather than
 * mixed in. They behave like the user's own — open the graph, ask questions of it,
 * derive a new version from it — but they are not the user's to delete or unshare, so
 * separating them is what makes "yours" mean something.
 *
 * The build already on screen is not clickable either, but it is not dimmed: that is
 * "you are here", not "this is unavailable", and one blanket disabled style for both
 * made the row doing the most look like the one you could do least with.
 *
 * How it is marked instead is the conversation drawer's treatment (.cb-drawer__item,
 * styles/app-chat.css): accent tint and accent border on the selected row, nothing at
 * all on the rest. That depends on the rest being quiet, which is why an unselected
 * card carries no frame of its own — an accent border only reads as a selection when
 * the rows around it are not already bordered.
 */
export default function OntologyLibraryRail({
  onOpen,
  onNewOntology,
  activeJobId,
  refreshKey = 0,
  onDeleted,
  disabled,
  collapsed,
  onToggleCollapsed,
}: OntologyLibraryRailProps) {
  const [builds, setBuilds] = useState<OntologySummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<OntologySummary | null>(null);
  // The build whose visibility is being changed, so its own toggle can wait without
  // freezing the rest of the rail.
  const [publishing, setPublishing] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setError(null);
    try {
      setBuilds(await listOntologies());
    } catch (e) {
      setBuilds([]);
      setError(e instanceof Error ? e.message : 'Failed to load your saved ontologies');
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh, refreshKey]);

  // A purge runs in a worker, so the row only clears on a later listing.
  const purging = builds?.some(build => build.status === 'deleting') ?? false;

  useEffect(() => {
    if (!purging) return;
    const timer = setInterval(() => {
      void refresh();
    }, DELETING_POLL_MS);
    return () => clearInterval(timer);
  }, [purging, refresh]);

  const handleTogglePublished = async (build: OntologySummary) => {
    setPublishing(build.jobId);
    setError(null);
    try {
      await publishOntology(build.jobId, build.visibility !== 'published');
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to change who can see this ontology');
    } finally {
      setPublishing(null);
    }
  };

  const handleDeleted = () => {
    const jobId = deleteTarget?.jobId;
    setDeleteTarget(null);
    if (jobId) onDeleted?.(jobId);
    void refresh();
  };

  // Openable covers a build still running as well as a finished one: a build outlives
  // the page that started it, so a reload has to be able to get back to the only view
  // of it. `failed`, `deleting` and `deleteFailed` stay inert, having nothing to open.
  const isOpenable = (build: OntologySummary) =>
    OPENABLE_STATUSES.includes(build.status) && !disabled && build.jobId !== activeJobId;

  // Not clickable because it is already open, which is a different thing from not
  // clickable because there is nothing there. Only the second one is dimmed.
  const isActive = (build: OntologySummary) => build.jobId === activeJobId;
  const isUnavailable = (build: OntologySummary) => !isActive(build) && !isOpenable(build);

  // isOwner is only absent on a listing from a server that predates sharing, where
  // every build was the caller's, so the default belongs on the owned side.
  const owned = useMemo(() => builds?.filter(build => build.isOwner !== false) ?? [], [builds]);
  const shared = useMemo(() => builds?.filter(build => build.isOwner === false) ?? [], [builds]);

  const renderCard = (build: OntologySummary) => (
    <OntologyLibraryCard
      key={build.jobId}
      build={build}
      badgeLabel={badgeLabel(build)}
      badgeTone={STATUS_TONE[build.status]}
      derivedFrom={derivedFrom(build, builds ?? [])}
      createdLabel={formatCreated(build.createdAt)}
      isActive={isActive(build)}
      isOpenable={isOpenable(build)}
      isUnavailable={isUnavailable(build)}
      onOpen={() => onOpen(build)}
      onDelete={() => setDeleteTarget(build)}
      onTogglePublished={
        build.isOwner !== false && SHAREABLE_STATUSES.includes(build.status)
          ? () => void handleTogglePublished(build)
          : undefined
      }
      publishing={publishing === build.jobId}
      disabled={disabled}
    />
  );

  const railWidth = collapsed
    ? 'w-[58px]'
    : 'w-[178px] min-[900px]:w-[212px] min-[1200px]:w-[252px]';

  const deleteModal = (
    <DeleteOntologyModal
      isOpen={deleteTarget !== null}
      build={deleteTarget}
      onClose={() => setDeleteTarget(null)}
      onSuccess={handleDeleted}
    />
  );

  if (collapsed) {
    return (
      <div
        className={cn(
          'flex min-h-0 flex-none flex-col items-center gap-2 border-r border-line bg-canvas py-3',
          railWidth
        )}
      >
        <Button
          variant='ghost'
          size='icon'
          aria-label='Show your ontologies'
          aria-expanded={false}
          onClick={onToggleCollapsed}
        >
          <ChevronRight className='h-4 w-4' />
        </Button>
        <Button size='icon' aria-label='New ontology' onClick={onNewOntology}>
          <Plus className='h-4 w-4' />
        </Button>
        <span className='h-px w-6 bg-line' />
        <Button
          variant='ghost'
          size='icon'
          aria-label='Refresh your ontologies'
          onClick={refresh}
          disabled={disabled}
        >
          <RefreshCw className='h-4 w-4' />
        </Button>

        <div className='flex min-h-0 flex-1 flex-col items-center gap-1.5 overflow-y-auto'>
          {builds?.map(build => (
            <button
              key={build.jobId}
              type='button'
              aria-label={`Open ${build.title || 'Untitled build'}`}
              title={[
                `${build.title || 'Untitled build'} · ${badgeLabel(build)}`,
                derivedFrom(build, builds ?? []),
                build.isOwner === false ? `Shared by ${build.ownerEmail ?? 'another user'}` : null,
              ]
                .filter(Boolean)
                .join(' · ')}
              disabled={!isOpenable(build)}
              onClick={() => onOpen(build)}
              className={cn(
                'grid h-9 w-9 shrink-0 place-items-center rounded-control border border-line bg-panel',
                'hover:border-accent-line hover:bg-panel-2 disabled:cursor-default',
                isActive(build) && 'border-accent-line bg-accent-soft',
                isUnavailable(build) && 'opacity-50'
              )}
            >
              <span
                className='h-[9px] w-[9px] rounded-full'
                style={{ background: STATUS_DOT[build.status] }}
              />
            </button>
          ))}
        </div>
        {deleteModal}
      </div>
    );
  }

  return (
    <div
      className={cn('flex min-h-0 flex-none flex-col border-r border-line bg-canvas', railWidth)}
    >
      <div className='flex flex-none flex-col gap-[7px] px-3 pb-[13px] pl-3.5 pt-3.5'>
        <div className='flex items-center gap-2'>
          <Library className='h-4 w-4 shrink-0 text-cyan' />
          <span className='min-w-0 flex-1 truncate text-[13px] font-semibold text-ink'>
            Your ontologies
          </span>
          <button
            type='button'
            aria-label='Hide your ontologies'
            aria-expanded
            onClick={onToggleCollapsed}
            className='grid h-[26px] w-[26px] shrink-0 place-items-center rounded-control text-ink-4 hover:bg-panel-2 hover:text-ink'
          >
            <ChevronLeft className='h-4 w-4' />
          </button>
        </div>
        <p className='text-[11.5px] leading-snug text-ink-4'>
          Open a previous build to explore it again
        </p>
        <Button size='sm' className='w-full' onClick={onNewOntology}>
          <Plus className='h-4 w-4' />
          New ontology
        </Button>
      </div>

      <div className='flex flex-none items-center border-y border-line px-3 py-[7px]'>
        <Button variant='ghost' size='sm' onClick={refresh} disabled={disabled}>
          <RefreshCw className='h-3.5 w-3.5' />
          Refresh
        </Button>
      </div>

      <div className='flex min-h-0 flex-1 flex-col gap-[7px] overflow-y-auto p-2.5'>
        {builds === null && (
          <div className='flex items-center gap-2.5 px-1 py-3 text-sm text-ink-3'>
            <Spinner size='sm' />
            Loading your ontologies…
          </div>
        )}

        {/* The failure replaces the list rather than sitting above an empty state —
            "no ontologies yet" is a claim this rail cannot make when it never heard back. */}
        {error && <div className='alert is-rose text-xs'>{error}</div>}

        {builds !== null && !error && builds.length === 0 && (
          <p className='px-1 py-3 text-xs leading-relaxed text-ink-3'>
            No ontologies yet. Build one above and it will appear here.
          </p>
        )}

        {!error && owned.map(renderCard)}

        {/* Only headed once there is something under it, so a user who has never seen
            a shared ontology is not shown an empty section explaining one. */}
        {!error && shared.length > 0 && (
          <>
            <div className='mt-1.5 flex items-center gap-2 px-1 pt-1.5'>
              <span className='text-[11px] font-semibold uppercase tracking-wide text-ink-4'>
                Shared with you
              </span>
              <span className='h-px flex-1 bg-line' />
            </div>
            {shared.map(renderCard)}
          </>
        )}
      </div>

      {deleteModal}
    </div>
  );
}
