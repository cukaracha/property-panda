import { useState } from 'react';
import ConfirmationModal from '../../../components/modals/ConfirmationModal';
import type { PendingHide } from '../../../types/listings';
import { formatCurrency } from '../../../lib/listingsFormat';

interface HideConfirmModalProps {
  pending: PendingHide;
  onClose: () => void;
  onConfirm: (alwaysHide: boolean) => Promise<void>;
}

interface HideCopy {
  title: string;
  description: string;
  confirmLabel: string;
  checkboxLabel: string;
  alwaysLabel: string;
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
      alwaysLabel: 'Always hide this property, in every search.',
      successMessage: `"${name}" is now hidden.`,
    };
  }

  const { property, row } = pending;
  return {
    title: 'Hide unit',
    description: `You are about to hide the ${row.unitTypeLabel} unit at ${formatCurrency(row.price)} in "${property.name}". It stays in the result set and you can unhide it from the hidden items panel.`,
    confirmLabel: 'Hide unit',
    checkboxLabel: 'I understand this unit will be hidden from the results.',
    alwaysLabel: 'Always hide this unit, in every search.',
    successMessage: 'This unit is now hidden.',
  };
}

/**
 * Confirms hiding one property or one unit. Hiding is reversible, so the copy
 * points at the hidden items panel rather than warning about a teardown.
 *
 * The toggle chooses which list the item joins: this search's own, or the app wide one
 * that every search filters against. The caller mounts this only while it is open, so
 * each opening starts with the toggle off rather than with the last answer.
 */
export default function HideConfirmModal({ pending, onClose, onConfirm }: HideConfirmModalProps) {
  const [alwaysHide, setAlwaysHide] = useState(false);

  const copy = getCopy(pending);

  return (
    <ConfirmationModal
      isOpen
      onClose={onClose}
      onConfirm={() => onConfirm(alwaysHide)}
      title={copy.title}
      description={copy.description}
      confirmLabel={copy.confirmLabel}
      checkboxLabel={copy.checkboxLabel}
      successMessage={
        alwaysHide
          ? `${copy.successMessage} It is now hidden in every search.`
          : copy.successMessage
      }
      extraOption={{ label: copy.alwaysLabel, checked: alwaysHide, onChange: setAlwaysHide }}
    />
  );
}
