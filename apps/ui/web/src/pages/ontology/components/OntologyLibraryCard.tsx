import { ChevronRight, Globe, Lock, Trash2 } from 'lucide-react';

import { Badge, type BadgeTone } from '../../../components/ui/badge';
import { cn } from '../../../lib/utils';
import type { OntologySummary } from '../../../services/ontologyService';

interface OntologyLibraryCardProps {
  build: OntologySummary;
  /** Status word or in-flight stage, already resolved by the rail. */
  badgeLabel: string;
  badgeTone: BadgeTone;
  /** How this build names the one it was derived from, if it was. */
  derivedFrom?: string;
  createdLabel: string;
  /** True for the build currently on screen: "you are here", not "unavailable". */
  isActive: boolean;
  isOpenable: boolean;
  /** Dimmed because there is genuinely nothing to open. */
  isUnavailable: boolean;
  onOpen: () => void;
  onDelete: () => void;
  /** Absent when this build cannot be shared: someone else's, or not finished. */
  onTogglePublished?: () => void;
  publishing?: boolean;
  disabled?: boolean;
}

/**
 * One entry in the library rail.
 *
 * The two row actions sit outside the card's own button rather than inside it,
 * because the card is itself a button and a button cannot nest one. They are also
 * the two things that are not the same for every entry: a shared ontology someone
 * else built can be opened, asked and derived from, but not deleted or unpublished,
 * so both are simply absent on it rather than present and refusing.
 */
export default function OntologyLibraryCard({
  build,
  badgeLabel,
  badgeTone,
  derivedFrom,
  createdLabel,
  isActive,
  isOpenable,
  isUnavailable,
  onOpen,
  onDelete,
  onTogglePublished,
  publishing,
  disabled,
}: OntologyLibraryCardProps) {
  const title = build.title || 'Untitled build';
  const published = build.visibility === 'published';
  const owned = build.isOwner !== false;

  return (
    <div className='relative'>
      <button
        type='button'
        aria-label={`Open ${title}`}
        disabled={!isOpenable}
        onClick={onOpen}
        className={cn(
          'flex w-full flex-col gap-1.5 rounded-[12px] border px-3 py-[11px] text-left disabled:cursor-default',
          // A ternary rather than an override: cn() is a plain join, so the
          // two states have to be mutually exclusive. Keeping the border
          // width on the shared string is what stops the card reflowing by a
          // pixel when it becomes the selected one.
          isActive
            ? 'border-accent-line bg-accent-soft'
            : 'border-transparent bg-transparent hover:bg-panel-2 disabled:hover:bg-transparent',
          isUnavailable && 'opacity-50'
        )}
      >
        <span className='flex items-center gap-2'>
          <span className='min-w-0 flex-1 truncate text-[13px] font-semibold text-ink'>
            {title}
          </span>
          <ChevronRight className='h-3.5 w-3.5 shrink-0 text-ink-4' />
        </span>
        <span className='flex flex-wrap gap-1.5'>
          <Badge tone={badgeTone}>{badgeLabel}</Badge>
          {derivedFrom && (
            <Badge title={derivedFrom}>{build.redriveOf ? 'Retry' : 'Updated'}</Badge>
          )}
          {published && owned && <Badge tone='positive'>Shared</Badge>}
        </span>
        <span className='truncate pr-12 text-[11px] tabular-nums text-ink-3'>
          {createdLabel} · {build.docCount} document{build.docCount === 1 ? '' : 's'}
        </span>
        {!owned && build.ownerEmail && (
          <span className='truncate pr-12 text-[11px] text-ink-4'>
            Shared by {build.ownerEmail}
          </span>
        )}
        {build.status === 'deleteFailed' && build.deleteError && (
          <span className='text-[11px] text-rose'>{build.deleteError}</span>
        )}
      </button>

      <div className='absolute bottom-2 right-2 flex items-center gap-0.5'>
        {onTogglePublished && (
          <button
            type='button'
            aria-label={published ? `Stop sharing ${title}` : `Share ${title} with everyone`}
            title={
              published
                ? 'Shared with everyone. Click to make it private again.'
                : 'Private to you. Click to let every user open it.'
            }
            disabled={publishing || disabled}
            onClick={onTogglePublished}
            className='grid h-[22px] w-[22px] place-items-center rounded-control text-ink-4 hover:bg-panel-2 hover:text-ink disabled:pointer-events-none disabled:opacity-40'
          >
            {published ? (
              <Globe className='h-3.5 w-3.5 text-cyan' />
            ) : (
              <Lock className='h-3.5 w-3.5' />
            )}
          </button>
        )}
        {/* Still enabled on deleteFailed — every purge step is idempotent, so
            deleting again finishes a half-done teardown. */}
        {owned && (
          <button
            type='button'
            aria-label={`Delete ${title}`}
            disabled={build.status === 'deleting' || disabled}
            onClick={onDelete}
            className='grid h-[22px] w-[22px] place-items-center rounded-control text-ink-4 hover:bg-panel-2 hover:text-rose disabled:pointer-events-none disabled:opacity-40'
          >
            <Trash2 className='h-3.5 w-3.5' />
          </button>
        )}
      </div>
    </div>
  );
}
