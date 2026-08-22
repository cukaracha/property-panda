import { useState, useEffect, useCallback } from 'react';
import type { ReactNode } from 'react';
import { UserPlus, CheckCircle2, AlertTriangle, XCircle } from 'lucide-react';
import Modal from '../../../components/modals/Modal';
import { Button } from '../../../components/ui/button';
import { Input } from '../../../components/ui/input';
import { Spinner } from '../../../components/ui/spinner';
import { requestSignup } from '../../../services/userManagementService';

type ModalState = 'form' | 'in-progress' | 'success' | 'error';

interface SelfSignUpModalProps {
  isOpen: boolean;
  onClose: () => void;
}

const AUTO_CLOSE_DELAY = 4000;

// Complete-class lookup: accent tile for the flow, rose tile for failure.
const TILE: Record<ModalState, string> = {
  form: 'border border-accent-line bg-accent-soft text-cyan',
  'in-progress': 'border border-accent-line bg-accent-soft text-cyan',
  success: 'border border-accent-line bg-accent-soft text-cyan',
  error: 'border border-rose-line bg-rose-soft text-rose',
};

function IconTile({ state, children }: { state: ModalState; children: ReactNode }) {
  return (
    <span
      className={`inline-flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-xl ${TILE[state]}`}
    >
      {children}
    </span>
  );
}

export default function SelfSignUpModal({ isOpen, onClose }: SelfSignUpModalProps) {
  const [email, setEmail] = useState('');
  const [state, setState] = useState<ModalState>('form');
  const [error, setError] = useState('');

  const reset = useCallback(() => {
    setEmail('');
    setState('form');
    setError('');
  }, []);

  useEffect(() => {
    if (!isOpen) {
      reset();
    }
  }, [isOpen, reset]);

  useEffect(() => {
    if (state === 'success') {
      const timer = setTimeout(() => {
        onClose();
      }, AUTO_CLOSE_DELAY);
      return () => clearTimeout(timer);
    }
  }, [state, onClose]);

  const handleSubmit = async () => {
    setState('in-progress');
    try {
      await requestSignup(email);
      setState('success');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Signup request failed');
      setState('error');
    }
  };

  const handleRetry = () => {
    setState('form');
    setError('');
  };

  const HEADER: Record<ModalState, { title: string; description?: string; icon: ReactNode }> = {
    form: {
      title: 'Create your account',
      description: "Enter your email and we'll send a temporary password.",
      icon: (
        <IconTile state='form'>
          <UserPlus size={20} />
        </IconTile>
      ),
    },
    'in-progress': {
      title: 'Create your account',
      description: 'Requesting your invitation…',
      icon: (
        <IconTile state='in-progress'>
          <UserPlus size={20} />
        </IconTile>
      ),
    },
    success: {
      title: 'Check your inbox',
      icon: (
        <IconTile state='success'>
          <CheckCircle2 size={20} />
        </IconTile>
      ),
    },
    error: {
      title: 'Request failed',
      icon: (
        <IconTile state='error'>
          <AlertTriangle size={20} />
        </IconTile>
      ),
    },
  };

  const renderContent = () => {
    switch (state) {
      case 'form':
        return (
          <div className='field'>
            <label htmlFor='signup-email' className='label'>
              Email <span className='text-cyan'>*</span>
            </label>
            <Input
              id='signup-email'
              type='email'
              value={email}
              onChange={e => setEmail(e.target.value)}
              placeholder='you@example.com'
            />
          </div>
        );

      case 'in-progress':
        return (
          <div className='flex flex-col items-center gap-4 py-8'>
            <Spinner size='lg' />
            <p className='text-sm font-medium text-ink-3'>Requesting…</p>
          </div>
        );

      case 'success':
        return (
          <div className='flex flex-col items-center gap-4 py-4 text-center'>
            <span className='inline-flex h-14 w-14 items-center justify-center rounded-full border border-accent-line bg-accent-soft text-cyan'>
              <CheckCircle2 size={28} />
            </span>
            <p className='max-w-[300px] text-[14.5px] leading-[1.55] text-ink-2'>
              We&apos;ve emailed a temporary password to your email address. Sign in with it, then
              set a permanent password.
            </p>
          </div>
        );

      case 'error':
        return (
          <div className='flex flex-col items-center gap-3.5 py-2 text-center'>
            <span className='inline-flex h-14 w-14 items-center justify-center rounded-full border border-rose-line bg-rose-soft text-rose'>
              <XCircle size={26} />
            </span>
            <p className='max-w-[300px] text-[14.5px] leading-[1.55] text-ink-2'>
              {error ||
                "We couldn't send your invitation right now. Please check the address and try again."}
            </p>
          </div>
        );
    }
  };

  const renderFooter = () => {
    switch (state) {
      case 'form':
        return (
          <>
            <Button variant='outline' onClick={onClose}>
              Cancel
            </Button>
            <Button onClick={handleSubmit} disabled={!email.trim()}>
              Request invitation
            </Button>
          </>
        );

      case 'error':
        return (
          <>
            <Button variant='outline' onClick={onClose}>
              Close
            </Button>
            <Button onClick={handleRetry}>Retry</Button>
          </>
        );

      default:
        return null;
    }
  };

  const header = HEADER[state];

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      dismissible={state !== 'in-progress'}
      title={header.title}
      description={header.description}
      icon={header.icon}
      iconColor=''
      footer={renderFooter()}
    >
      {renderContent()}
    </Modal>
  );
}
