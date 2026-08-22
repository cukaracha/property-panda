import { useEffect, useRef } from 'react';
import { Button } from '../../../components/ui/button';

interface UpdateConfirmDialogProps {
  open: boolean;
  addedCount: number;
  removedCount: number;
  /** Reuse the current build's schema, so node ids survive into the new ontology. */
  extendSchema: boolean;
  onExtendSchemaChange: (value: boolean) => void;
  onCancel: () => void;
  onConfirm: () => void;
}

/**
 * Confirms deriving a new ontology from an edited corpus.
 *
 * The page keeps everything else inline, so this is the one thing that interrupts,
 * and it earns that: an update is minutes to hours of work over a corpus the user
 * has just changed, and there is no way to cancel it once it starts. The body names
 * the change rather than asking "are you sure", which is the only version of this
 * question worth answering.
 *
 * It also owns the one choice an update cannot make on the user's behalf. Reusing the
 * schema keeps node ids stable, so a link or a filter into the old graph still lands;
 * designing a fresh one fits the corpus as it now stands but can renumber everything.
 */
export default function UpdateConfirmDialog({
  open,
  addedCount,
  removedCount,
  extendSchema,
  onExtendSchemaChange,
  onCancel,
  onConfirm,
}: UpdateConfirmDialogProps) {
  const confirmRef = useRef<HTMLButtonElement>(null);
  // Where focus was before the dialog took it, so closing puts it back rather than
  // dropping the user at the top of the document.
  const returnFocusRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (!open) return;
    returnFocusRef.current = document.activeElement as HTMLElement | null;
    confirmRef.current?.focus();

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onCancel();
    };
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      returnFocusRef.current?.focus?.();
    };
  }, [open, onCancel]);

  if (!open) return null;

  const changes = [
    addedCount > 0 ? `${addedCount} added` : null,
    removedCount > 0 ? `${removedCount} removed` : null,
  ]
    .filter(Boolean)
    .join(' and ');

  return (
    <div
      className='fixed inset-0 z-50 grid place-items-center p-4 backdrop-blur-[2px]'
      style={{ background: 'color-mix(in srgb, #000 58%, transparent)' }}
      onClick={onCancel}
    >
      <div
        role='dialog'
        aria-modal='true'
        aria-labelledby='update-dialog-title'
        // Without this, clicking anything inside the card would bubble to the
        // backdrop and cancel the dialog the user is reading.
        onClick={event => event.stopPropagation()}
        className='flex w-[min(440px,100%)] flex-col gap-[13px] rounded-panel border border-line bg-canvas-2 px-[22px] pb-[18px] pt-[22px] shadow-[0_30px_70px_-20px_rgba(0,0,0,0.7)]'
      >
        <h2
          id='update-dialog-title'
          className='text-[17px] font-semibold tracking-[-0.015em] text-ink'
        >
          Update this ontology?
        </h2>
        <p className='text-sm leading-relaxed text-ink-2'>
          You have {changes} document{addedCount + removedCount === 1 ? '' : 's'}. The documents you
          kept are carried over, so only the ones you added are read again. Consolidating the schema
          and rebuilding the graph still run over the whole corpus, which can take minutes to hours.
        </p>
        <p className='text-[12.5px] leading-relaxed text-ink-3'>
          This creates a new ontology. The graph on screen is replaced while it runs, and the
          existing build stays in your ontologies, so you can reopen it and its conversation at any
          time.
        </p>

        <label className='flex cursor-pointer items-start gap-2.5 rounded-control border border-line bg-panel-2 px-3 py-2.5'>
          <input
            type='checkbox'
            className='mt-0.5 shrink-0 accent-[var(--cyan)]'
            checked={extendSchema}
            onChange={event => onExtendSchemaChange(event.target.checked)}
          />
          <span className='min-w-0'>
            <span className='block text-[13px] font-medium text-ink-2'>Reuse this schema</span>
            <span className='mt-0.5 block text-xs leading-relaxed text-ink-4'>
              Keeps node ids stable, so anything you saved from this graph still resolves. Turn it
              off to design a fresh schema over the new corpus.
            </span>
          </span>
        </label>

        <div className='mt-1 flex justify-end gap-2'>
          <Button variant='ghost' onClick={onCancel}>
            Cancel
          </Button>
          <Button ref={confirmRef} onClick={onConfirm}>
            Update ontology
          </Button>
        </div>
      </div>
    </div>
  );
}
