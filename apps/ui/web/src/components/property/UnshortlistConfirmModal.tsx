import ConfirmationModal from '../modals/ConfirmationModal';
import type { PendingUnshortlist } from '../../types/listings';
import { formatCurrency } from '../../lib/listingsFormat';

export interface UnshortlistConfirmModalProps {
  pending: PendingUnshortlist | null;
  onClose: () => void;
  onConfirm: () => Promise<void>;
}

/**
 * Confirms taking one unit off the shortlist. Unlike hiding, this one does not come
 * back on its own: the shortlist holds the unit as it stood when it was hearted, and
 * the search that found it is pruned within a day, so the copy says it has to be
 * found again rather than pointing at a panel that would restore it.
 */
export default function UnshortlistConfirmModal({
  pending,
  onClose,
  onConfirm,
}: UnshortlistConfirmModalProps) {
  if (!pending) return null;

  const { property, row } = pending;

  return (
    <ConfirmationModal
      isOpen
      onClose={onClose}
      onConfirm={onConfirm}
      title='Remove from shortlist'
      description={`You are about to take the ${row.unitTypeLabel} unit at ${formatCurrency(row.price)} in "${property.name}" off your shortlist. The shortlist keeps a unit as it stood when you hearted it, so putting this one back means finding it in a search again.`}
      confirmLabel='Remove unit'
      checkboxLabel='I understand this unit will be removed from my shortlist.'
      successMessage='This unit is no longer on your shortlist.'
    />
  );
}
