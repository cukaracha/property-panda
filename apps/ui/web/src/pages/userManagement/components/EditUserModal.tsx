import { useState, useEffect } from 'react';
import { Pencil } from 'lucide-react';
import Modal from '../../../components/modals/Modal';
import { Button } from '../../../components/ui/button';
import { Input } from '../../../components/ui/input';
import { Badge } from '../../../components/ui/badge';
import { DropdownMenu } from '../../../components/inputs/DropdownMenu';
import { updateUser, type CognitoUser } from '../../../services/userManagementService';

interface EditUserModalProps {
  isOpen: boolean;
  user: CognitoUser | null;
  onClose: () => void;
  onSuccess: () => void;
}

export default function EditUserModal({ isOpen, user, onClose, onSuccess }: EditUserModalProps) {
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [group, setGroup] = useState('Users');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (user) {
      setFirstName(user.firstName || '');
      setLastName(user.lastName || '');
      setGroup(user.groups[0] || 'Users');
      setError('');
    }
  }, [user]);

  const handleSubmit = async () => {
    if (!user) return;

    setError('');
    setIsSubmitting(true);
    try {
      const attributes: { firstName?: string; lastName?: string } = {};
      if (firstName !== user.firstName) attributes.firstName = firstName;
      if (lastName !== user.lastName) attributes.lastName = lastName;

      const newGroup = group !== user.groups[0] ? group : undefined;

      await updateUser(
        user.username,
        Object.keys(attributes).length > 0 ? attributes : undefined,
        newGroup
      );
      onSuccess();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update user');
    } finally {
      setIsSubmitting(false);
    }
  };

  if (!user) return null;

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title='Edit User'
      description={user.email}
      icon={
        <span className='inline-flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-xl border border-accent-line bg-accent-soft text-cyan'>
          <Pencil size={20} />
        </span>
      }
      iconColor=''
      footer={
        <>
          <Button variant='outline' onClick={onClose} disabled={isSubmitting}>
            Cancel
          </Button>
          <Button onClick={handleSubmit} loading={isSubmitting}>
            {isSubmitting ? 'Saving…' : 'Save Changes'}
          </Button>
        </>
      }
    >
      <div className='flex flex-col gap-4'>
        {error && (
          <div className='rounded-surface border border-rose-line bg-rose-soft p-3'>
            <p className='text-sm text-rose'>{error}</p>
          </div>
        )}
        <div className='flex items-center gap-2'>
          <span className='text-sm text-ink-3'>Status:</span>
          <Badge tone={user.status === 'CONFIRMED' ? 'positive' : 'neutral'}>{user.status}</Badge>
        </div>
        <div className='grid grid-cols-2 gap-3'>
          <div className='field'>
            <label htmlFor='edit-first-name' className='label'>
              First Name
            </label>
            <Input
              id='edit-first-name'
              value={firstName}
              onChange={e => setFirstName(e.target.value)}
              placeholder='John'
            />
          </div>
          <div className='field'>
            <label htmlFor='edit-last-name' className='label'>
              Last Name
            </label>
            <Input
              id='edit-last-name'
              value={lastName}
              onChange={e => setLastName(e.target.value)}
              placeholder='Doe'
            />
          </div>
        </div>
        <div className='field'>
          <label htmlFor='edit-group' className='label'>
            Group
          </label>
          <DropdownMenu id='edit-group' value={group} onChange={e => setGroup(e.target.value)}>
            <option value='Users'>Users</option>
            <option value='Admins'>Admins</option>
          </DropdownMenu>
        </div>
      </div>
    </Modal>
  );
}
