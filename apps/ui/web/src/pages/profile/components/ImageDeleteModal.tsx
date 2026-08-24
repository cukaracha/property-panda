import { AlertTriangle } from 'lucide-react';
import Modal from '../../../components/modals/Modal';
import { Button } from '../../../components/ui/button';

interface ImageDeleteModalProps {
  isOpen: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}

export default function ImageDeleteModal({ isOpen, onCancel, onConfirm }: ImageDeleteModalProps) {
  return (
    <Modal
      isOpen={isOpen}
      onClose={onCancel}
      title='Remove Profile Picture'
      description='Are you sure you want to remove your profile picture?'
      icon={
        <span className='inline-flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-xl border border-rose-500 bg-danger-subtle text-danger'>
          <AlertTriangle size={20} />
        </span>
      }
      iconColor=''
      footer={
        <>
          <Button variant='outline' onClick={onCancel}>
            Cancel
          </Button>
          <Button variant='destructive' onClick={onConfirm}>
            Remove Picture
          </Button>
        </>
      }
    >
      <div className='rounded-card border border-line bg-sunken p-3'>
        <p className='text-sm text-body'>
          This action will permanently remove your profile picture. You can always upload a new one
          later.
        </p>
      </div>
    </Modal>
  );
}
