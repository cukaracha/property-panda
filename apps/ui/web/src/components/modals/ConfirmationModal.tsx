import { useState, useEffect, useCallback } from 'react';
import type { ReactNode } from 'react';
import { AlertTriangle, CheckCircle2, XCircle } from 'lucide-react';
import { Button } from '../ui/button';
import { Spinner } from '../ui/spinner';
import Modal from './Modal';
import { cn } from '../../lib/utils';

type ConfirmationState = 'confirm' | 'in-progress' | 'success' | 'error';

/**
 * `danger` is for a destructive step: a rose body block, an acknowledgement the
 * user must tick, and a destructive confirm button. `brand` is for a reversible
 * one: a bamboo body block, no acknowledgement, and a primary confirm button.
 */
export type ConfirmationTone = 'danger' | 'brand';

export interface ConfirmationModalProps {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: () => Promise<void>;
  title: string;
  description: string;
  confirmLabel?: string;
  /** Required by the `danger` tone, which will not enable Confirm until it is ticked. */
  checkboxLabel?: string;
  tone?: ConfirmationTone;
  successMessage?: string;
  errorMessage?: string;
  onSuccess?: () => void;
  /**
   * A second checkbox under the acknowledgement, for a confirmation that also asks how
   * to carry the action out. Owned by the caller, since the answer is what it confirms
   * with, and left out entirely when nothing is being asked.
   */
  extraOption?: { label: string; checked: boolean; onChange: (checked: boolean) => void };
}

const AUTO_CLOSE_DELAY = 3000;

// Complete-class lookup (cn() has no tailwind-merge): the tone decides the
// resting tile, and failure is always rose whatever the tone.
const TILE: Record<ConfirmationTone, Record<ConfirmationState, string>> = {
  danger: {
    confirm: 'border border-rose-500 bg-danger-subtle text-danger',
    'in-progress': 'border border-line-brand bg-brand-subtle text-brand',
    success: 'border border-line-brand bg-brand-subtle text-brand',
    error: 'border border-rose-500 bg-danger-subtle text-danger',
  },
  brand: {
    confirm: 'border border-line-brand bg-brand-subtle text-brand',
    'in-progress': 'border border-line-brand bg-brand-subtle text-brand',
    success: 'border border-line-brand bg-brand-subtle text-brand',
    error: 'border border-rose-500 bg-danger-subtle text-danger',
  },
};

function IconTile({
  state,
  tone,
  children,
}: {
  state: ConfirmationState;
  tone: ConfirmationTone;
  children: ReactNode;
}) {
  return (
    <span
      className={`inline-flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-card ${TILE[tone][state]}`}
    >
      {children}
    </span>
  );
}

/**
 * Two-step confirmation dialog with an in-flight spinner and auto-closing
 * success / retryable error states. The `danger` tone gates the confirm behind
 * an acknowledgement; the `brand` tone does not, because what it confirms is
 * reversible. Built on the design-system Modal + Button, styled on the tokens.
 */
export default function ConfirmationModal({
  isOpen,
  onClose,
  onConfirm,
  title,
  description,
  confirmLabel = 'Confirm',
  checkboxLabel,
  tone = 'danger',
  successMessage = 'Operation completed successfully.',
  errorMessage = 'An error occurred. Please try again.',
  onSuccess,
  extraOption,
}: ConfirmationModalProps) {
  const [state, setState] = useState<ConfirmationState>('confirm');
  const [checked, setChecked] = useState(false);
  const [error, setError] = useState('');

  const reset = useCallback(() => {
    setState('confirm');
    setChecked(false);
    setError('');
  }, []);

  useEffect(() => {
    if (!isOpen) {
      reset();
    }
  }, [isOpen, reset]);

  useEffect(() => {
    if (state === 'success' || state === 'error') {
      const callback = state === 'success' && onSuccess ? onSuccess : onClose;
      const timer = setTimeout(() => {
        callback();
      }, AUTO_CLOSE_DELAY);
      return () => clearTimeout(timer);
    }
  }, [state, onClose, onSuccess]);

  const handleConfirm = async () => {
    setState('in-progress');
    try {
      await onConfirm();
      setState('success');
    } catch (err) {
      setError(err instanceof Error ? err.message : errorMessage);
      setState('error');
    }
  };

  const handleRetry = () => {
    setState('confirm');
    setChecked(false);
  };

  const acknowledged = tone === 'brand' || checked;

  const renderContent = () => {
    switch (state) {
      case 'confirm':
        return (
          <>
            <div
              className={cn(
                'mb-4 rounded-card border p-3',
                tone === 'brand'
                  ? 'border-line-brand bg-brand-subtle'
                  : 'border-rose-500 bg-danger-subtle'
              )}
            >
              <p className={cn('text-sm', tone === 'brand' ? 'text-brand' : 'text-danger')}>
                {description}
              </p>
            </div>
            {tone === 'danger' && checkboxLabel && (
              <label className='flex cursor-pointer items-start gap-3'>
                <input
                  type='checkbox'
                  className='check mt-0.5'
                  checked={checked}
                  onChange={e => setChecked(e.target.checked)}
                />
                <span className='text-sm text-body'>{checkboxLabel}</span>
              </label>
            )}
            {extraOption && (
              <label
                className={cn(
                  'flex cursor-pointer items-start gap-3',
                  tone === 'danger' && checkboxLabel && 'mt-3 border-t border-line pt-3'
                )}
              >
                <input
                  type='checkbox'
                  className='check mt-0.5'
                  checked={extraOption.checked}
                  onChange={e => extraOption.onChange(e.target.checked)}
                />
                <span className='text-sm text-body'>{extraOption.label}</span>
              </label>
            )}
          </>
        );

      case 'in-progress':
        return (
          <div className='flex flex-col items-center gap-3 py-6'>
            <Spinner size='lg' />
            <p className='text-sm text-muted'>Processing…</p>
          </div>
        );

      case 'success':
        return (
          <div className='flex flex-col items-center gap-3 py-6 text-center'>
            <CheckCircle2 className='text-brand' size={32} />
            <p className='text-sm text-body'>{successMessage}</p>
          </div>
        );

      case 'error':
        return (
          <div className='flex flex-col items-center gap-3 py-6 text-center'>
            <XCircle className='text-danger' size={32} />
            <p className='text-sm text-danger'>{error || errorMessage}</p>
          </div>
        );
    }
  };

  const renderFooter = () => {
    switch (state) {
      case 'confirm':
        return (
          <>
            <Button variant='outline' onClick={onClose}>
              Cancel
            </Button>
            <Button
              variant={tone === 'brand' ? 'default' : 'destructive'}
              onClick={handleConfirm}
              disabled={!acknowledged}
            >
              {confirmLabel}
            </Button>
          </>
        );

      case 'error':
        return (
          <>
            <Button variant='outline' onClick={onClose}>
              Close
            </Button>
            <Button variant='outline' onClick={handleRetry}>
              Retry
            </Button>
          </>
        );

      default:
        return null;
    }
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      dismissible={state !== 'in-progress'}
      title={title}
      icon={
        <IconTile state={state} tone={tone}>
          {state === 'success' ? (
            <CheckCircle2 size={20} />
          ) : state === 'error' ? (
            <XCircle size={20} />
          ) : (
            <AlertTriangle size={20} />
          )}
        </IconTile>
      }
      iconColor=''
      footer={renderFooter()}
    >
      {renderContent()}
    </Modal>
  );
}
