import ConfirmationModal from '../../../components/modals/ConfirmationModal';
import type { SavedSearch } from '../types/listings';

export interface DeleteSearchConfirmModalProps {
  search: SavedSearch | null;
  onClose: () => void;
  onConfirm: () => Promise<void>;
}

/**
 * Confirms forgetting one saved search. Unlike hiding, this one does not come back,
 * so the copy says the filters have to be typed again rather than pointing at a panel.
 */
export default function DeleteSearchConfirmModal({
  search,
  onClose,
  onConfirm,
}: DeleteSearchConfirmModalProps) {
  if (!search) return null;

  return (
    <ConfirmationModal
      isOpen
      onClose={onClose}
      onConfirm={onConfirm}
      title='Delete saved search'
      description={`You are about to delete "${search.name}". Its filters and the items it hides are not kept anywhere else, so getting it back means setting them up again.`}
      confirmLabel='Delete search'
      checkboxLabel='I understand this saved search will be deleted.'
      successMessage={`"${search.name}" has been deleted.`}
    />
  );
}
