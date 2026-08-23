import ConfirmationModal from '../../../components/modals/ConfirmationModal';
import type { PendingHide } from '../types/listings';
import { formatCurrency } from '../utils/format';

interface HideConfirmModalProps {
  pending: PendingHide | null;
  onClose: () => void;
  onConfirm: () => Promise<void>;
}

interface HideCopy {
  title: string;
  description: string;
  confirmLabel: string;
  checkboxLabel: string;
  successMessage: string;
}

function getCopy(pending: PendingHide): HideCopy {
  if (pending.scope === 'property') {
    const { name } = pending.property;
    return {
      title: 'Hide property',
      description: `You are about to hide "${name}" from the results. It stays in the result set and you can unhide it from the hidden items panel.`,
      confirmLabel: 'Hide property',
      checkboxLabel: 'I understand this property will be hidden from the results.',
      successMessage: `"${name}" is now hidden.`,
    };
  }

  const { property, row } = pending;
  return {
    title: 'Hide unit',
    description: `You are about to hide the ${row.unitTypeLabel} unit at ${formatCurrency(row.price)} in "${property.name}". It stays in the result set and you can unhide it from the hidden items panel.`,
    confirmLabel: 'Hide unit',
    checkboxLabel: 'I understand this unit will be hidden from the results.',
    successMessage: 'This unit is now hidden.',
  };
}

/**
 * Confirms hiding one property or one unit. Hiding is reversible, so the copy
 * points at the hidden items panel rather than warning about a teardown.
 */
export default function HideConfirmModal({ pending, onClose, onConfirm }: HideConfirmModalProps) {
  if (!pending) return null;

  const copy = getCopy(pending);

  return (
    <ConfirmationModal
      isOpen
      onClose={onClose}
      onConfirm={onConfirm}
      title={copy.title}
      description={copy.description}
      confirmLabel={copy.confirmLabel}
      checkboxLabel={copy.checkboxLabel}
      successMessage={copy.successMessage}
    />
  );
}
