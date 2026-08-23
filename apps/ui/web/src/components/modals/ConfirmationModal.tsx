import { useState, useEffect, useCallback } from 'react';
import type { ReactNode } from 'react';
import { AlertTriangle, CheckCircle2, XCircle } from 'lucide-react';
import { Button } from '../ui/button';
import { Spinner } from '../ui/spinner';
import Modal from './Modal';

type ConfirmationState = 'confirm' | 'in-progress' | 'success' | 'error';

export interface ConfirmationModalProps {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: () => Promise<void>;
  title: string;
  description: string;
  confirmLabel?: string;
  checkboxLabel: string;
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

// Accent tile for the flow, rose tile for failure (mirrors SelfSignUpModal).
const TILE: Record<ConfirmationState, string> = {
  confirm: 'border border-rose-line bg-rose-soft text-rose',
  'in-progress': 'border border-accent-line bg-accent-soft text-cyan',
  success: 'border border-accent-line bg-accent-soft text-cyan',
  error: 'border border-rose-line bg-rose-soft text-rose',
};

function IconTile({ state, children }: { state: ConfirmationState; children: ReactNode }) {
  return (
    <span
      className={`inline-flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-xl ${TILE[state]}`}
    >
      {children}
    </span>
  );
}

/**
 * Two-step confirmation dialog with an acknowledgement checkbox, an in-flight
 * spinner, and auto-closing success / retryable error states. Built on the
 * design-system Modal + Button, styled entirely on the tokens.
 */
export default function ConfirmationModal({
  isOpen,
  onClose,
  onConfirm,
  title,
  description,
  confirmLabel = 'Confirm',
  checkboxLabel,
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

  const renderContent = () => {
    switch (state) {
      case 'confirm':
        return (
          <>
            <div className='mb-4 rounded-surface border border-rose-line bg-rose-soft p-3'>
              <p className='text-sm text-rose'>{description}</p>
            </div>
            <label className='flex cursor-pointer items-start gap-3'>
              <input
                type='checkbox'
                className='check mt-0.5'
                checked={checked}
                onChange={e => setChecked(e.target.checked)}
              />
              <span className='text-sm text-ink-2'>{checkboxLabel}</span>
            </label>
            {extraOption && (
              <label className='mt-3 flex cursor-pointer items-start gap-3 border-t border-line pt-3'>
                <input
                  type='checkbox'
                  className='check mt-0.5'
                  checked={extraOption.checked}
                  onChange={e => extraOption.onChange(e.target.checked)}
                />
                <span className='text-sm text-ink-2'>{extraOption.label}</span>
              </label>
            )}
          </>
        );

      case 'in-progress':
        return (
          <div className='flex flex-col items-center gap-3 py-6'>
            <Spinner size='lg' />
            <p className='text-sm text-ink-3'>Processing…</p>
          </div>
        );

      case 'success':
        return (
          <div className='flex flex-col items-center gap-3 py-6 text-center'>
            <CheckCircle2 className='text-cyan' size={32} />
            <p className='text-sm text-ink-2'>{successMessage}</p>
          </div>
        );

      case 'error':
        return (
          <div className='flex flex-col items-center gap-3 py-6 text-center'>
            <XCircle className='text-rose' size={32} />
            <p className='text-sm text-rose'>{error || errorMessage}</p>
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
            <Button variant='destructive' onClick={handleConfirm} disabled={!checked}>
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
        <IconTile state={state}>
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
