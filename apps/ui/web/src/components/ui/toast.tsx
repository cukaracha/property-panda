import { CheckCircle, XCircle, X } from 'lucide-react';
import { cn } from '../../lib/utils';

export type ToastItem = { id: number; type: 'success' | 'error'; message: string };

interface ToastProps {
  toast: ToastItem;
  onRemove: () => void;
  /** Stacking position from the top edge (0 = first). */
  index?: number;
}

// Complete-class lookup: cyan accent for success, rose for failure.
const toneClasses: Record<ToastItem['type'], string> = {
  success: 'border-accent-line bg-accent-soft text-cyan',
  error: 'border-rose-line bg-rose-soft text-rose',
};

/** Transient top-right notification, styled on the design tokens. */
export default function Toast({ toast, onRemove, index = 0 }: ToastProps) {
  return (
    <div
      role='status'
      className={cn(
        'fixed right-4 z-[110] flex items-center gap-2 rounded-surface border px-4 py-3 text-sm font-medium shadow-[var(--shadow-panel)]',
        toneClasses[toast.type]
      )}
      style={{ top: 16 + index * 64 }}
    >
      {toast.type === 'success' ? <CheckCircle size={18} /> : <XCircle size={18} />}
      <span>{toast.message}</span>
      <button
        type='button'
        onClick={onRemove}
        aria-label='Dismiss'
        className='ml-2 text-ink-3 transition-colors hover:text-ink'
      >
        <X size={15} />
      </button>
    </div>
  );
}
