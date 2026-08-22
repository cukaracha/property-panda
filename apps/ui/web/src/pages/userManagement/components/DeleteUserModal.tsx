import ConfirmationModal from '../../../components/modals/ConfirmationModal';
import { deleteUser, type CognitoUser } from '../../../services/userManagementService';

interface DeleteUserModalProps {
  isOpen: boolean;
  user: CognitoUser | null;
  onClose: () => void;
  onSuccess: () => void;
}

export default function DeleteUserModal({
  isOpen,
  user,
  onClose,
  onSuccess,
}: DeleteUserModalProps) {
  if (!user) return null;

  const handleConfirm = async () => {
    await deleteUser(user.username);
  };

  return (
    <ConfirmationModal
      isOpen={isOpen}
      onClose={onClose}
      onConfirm={handleConfirm}
      title='Delete User'
      description={`You are about to permanently delete the user "${user.email}". This action cannot be undone.`}
      confirmLabel='Delete User'
      checkboxLabel='I understand this will permanently delete this user.'
      successMessage={`User "${user.email}" has been deleted.`}
      onSuccess={onSuccess}
    />
  );
}
