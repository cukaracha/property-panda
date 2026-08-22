import { AlertTriangle } from 'lucide-react';
import Modal from '../../../components/modals/Modal';
import { Button } from '../../../components/ui/button';
import { Input } from '../../../components/ui/input';

interface DeleteAccountModalProps {
  isOpen: boolean;
  password: string;
  onPasswordChange: (value: string) => void;
  onCancel: () => void;
  onConfirm: () => void;
  isDeleting: boolean;
}

/**
 * Delete-account confirmation. Demo-only: onConfirm simulates the request — no
 * account is actually deleted (there is no delete-account backend endpoint).
 */
export default function DeleteAccountModal({
  isOpen,
  password,
  onPasswordChange,
  onCancel,
  onConfirm,
  isDeleting,
}: DeleteAccountModalProps) {
  return (
    <Modal
      isOpen={isOpen}
      onClose={onCancel}
      dismissible={!isDeleting}
      title='Delete Account'
      description='This action cannot be undone. Please enter your password to confirm.'
      icon={
        <span className='inline-flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-xl border border-rose-line bg-rose-soft text-rose'>
          <AlertTriangle size={20} />
        </span>
      }
      iconColor=''
      footer={
        <>
          <Button variant='outline' onClick={onCancel} disabled={isDeleting}>
            Cancel
          </Button>
          <Button
            variant='destructive'
            onClick={onConfirm}
            disabled={!password.trim()}
            loading={isDeleting}
          >
            {isDeleting ? 'Deleting…' : 'Delete Account'}
          </Button>
        </>
      }
    >
      <div className='flex flex-col gap-4'>
        <div className='field'>
          <label htmlFor='delete-password' className='label'>
            Password <span className='text-cyan'>*</span>
          </label>
          <Input
            id='delete-password'
            type='password'
            value={password}
            onChange={e => onPasswordChange(e.target.value)}
            placeholder='Enter your password'
          />
        </div>
        <div className='rounded-surface border border-rose-line bg-rose-soft p-3'>
          <p className='text-sm text-rose'>
            <strong>Warning:</strong> Deleting your account will permanently remove all your data,
            including profile information and course progress. This action cannot be undone.
          </p>
        </div>
      </div>
    </Modal>
  );
}
