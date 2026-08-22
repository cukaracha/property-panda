import { useState, useEffect, useCallback } from 'react';
import type { ReactNode } from 'react';
import { UserPlus, CheckCircle2, XCircle } from 'lucide-react';
import Modal from '../../../components/modals/Modal';
import { Button } from '../../../components/ui/button';
import { Input } from '../../../components/ui/input';
import { Spinner } from '../../../components/ui/spinner';
import { createUser } from '../../../services/userManagementService';

type ModalState = 'form' | 'in-progress' | 'success' | 'error';

interface AddUserModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: () => void;
}

const AUTO_CLOSE_DELAY = 3000;

function IconTile({ state, children }: { state: ModalState; children: ReactNode }) {
  const tone =
    state === 'error'
      ? 'border-rose-line bg-rose-soft text-rose'
      : 'border-accent-line bg-accent-soft text-cyan';
  return (
    <span
      className={`inline-flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-xl border ${tone}`}
    >
      {children}
    </span>
  );
}

export default function AddUserModal({ isOpen, onClose, onSuccess }: AddUserModalProps) {
  const [email, setEmail] = useState('');
  const [group, setGroup] = useState('Users');
  const [state, setState] = useState<ModalState>('form');
  const [error, setError] = useState('');

  const reset = useCallback(() => {
    setEmail('');
    setGroup('Users');
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
        onSuccess();
      }, AUTO_CLOSE_DELAY);
      return () => clearTimeout(timer);
    }
  }, [state, onSuccess]);

  const handleSubmit = async () => {
    setState('in-progress');
    try {
      await createUser(email, undefined, undefined, group);
      setState('success');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create user');
      setState('error');
    }
  };

  const handleRetry = () => {
    setState('form');
    setError('');
  };

  const renderContent = () => {
    switch (state) {
      case 'form':
        return (
          <div className='flex flex-col gap-4'>
            <div className='field'>
              <label htmlFor='add-user-email' className='label'>
                Email <span className='text-cyan'>*</span>
              </label>
              <Input
                id='add-user-email'
                type='email'
                value={email}
                onChange={e => setEmail(e.target.value)}
                placeholder='user@example.com'
              />
            </div>
            <div className='field'>
              <span className='label'>Group</span>
              <div className='flex gap-5'>
                {['Users', 'Admins'].map(g => (
                  <label key={g} className='flex cursor-pointer items-center gap-2'>
                    <input
                      type='radio'
                      name='group'
                      value={g}
                      checked={group === g}
                      onChange={() => setGroup(g)}
                      className='h-4 w-4 accent-[var(--cyan)]'
                    />
                    <span className='text-sm text-ink-2'>{g}</span>
                  </label>
                ))}
              </div>
            </div>
          </div>
        );

      case 'in-progress':
        return (
          <div className='flex flex-col items-center gap-3 py-6'>
            <Spinner size='lg' />
            <p className='text-sm text-ink-3'>Creating…</p>
          </div>
        );

      case 'success':
        return (
          <div className='flex flex-col items-center gap-3 py-6 text-center'>
            <CheckCircle2 className='text-cyan' size={32} />
            <p className='text-sm text-ink-2'>A temporary password has been sent to the user.</p>
          </div>
        );

      case 'error':
        return (
          <div className='flex flex-col items-center gap-3 py-6 text-center'>
            <XCircle className='text-rose' size={32} />
            <p className='text-sm text-rose'>{error || 'Failed to create user'}</p>
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
              Create User
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
      title='Add User'
      description='Create a new user in the system.'
      icon={
        <IconTile state={state}>
          {state === 'success' ? (
            <CheckCircle2 size={20} />
          ) : state === 'error' ? (
            <XCircle size={20} />
          ) : (
            <UserPlus size={20} />
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
