import { CheckCircle, XCircle, X } from 'lucide-react';
import { cn } from '../../lib/utils';

export type ToastItem = { id: number; type: 'success' | 'error'; message: string };

interface ToastProps {
  toast: ToastItem;
  onRemove: () => void;
  /** Stacking position from the top edge (0 = first). */
  index?: number;
}

// Complete-class lookup: two tones only, brand for success and rose for failure.
const toneClasses: Record<ToastItem['type'], string> = {
  success: 'border-line-brand bg-brand-subtle text-brand',
  error: 'border-rose-500 bg-danger-subtle text-danger',
};

/** Transient top-right notification, styled on the design tokens. */
export default function Toast({ toast, onRemove, index = 0 }: ToastProps) {
  return (
    <div
      role='status'
      className={cn(
        'fixed right-5 z-[110] flex w-[min(360px,100vw-40px)] items-center gap-2 rounded-card border px-4 py-3 text-sm font-medium shadow-lg',
        toneClasses[toast.type]
      )}
      style={{ top: 20 + index * 60 }}
    >
      {toast.type === 'success' ? <CheckCircle size={18} /> : <XCircle size={18} />}
      <span className='min-w-0 flex-1'>{toast.message}</span>
      <button
        type='button'
        onClick={onRemove}
        aria-label='Dismiss'
        className='ml-1 flex-none text-muted transition-colors hover:text-strong'
      >
        <X size={15} />
      </button>
    </div>
  );
}
