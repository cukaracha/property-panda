import ConfirmationModal from '../modals/ConfirmationModal';
import type { HiddenEntity } from '../../types/listings';

export interface UnhideConfirmModalProps {
  /** The row waiting on an answer, or null when nothing is. */
  pending: HiddenEntity | null;
  /** True for an item on the app-wide list, which comes back in every search at once. */
  isAlways: boolean;
  onClose: () => void;
  onConfirm: () => Promise<void>;
}

/**
 * The gate in front of bringing a hidden item back.
 *
 * A search-scoped unhide destroys nothing, so this is the reversible tone: a bamboo
 * block, no acknowledgement to tick, and a primary confirm. The app-wide one is the
 * same tone for the same reason, but its copy says out loud what the click actually
 * does, because it changes every search the person will ever run and the footnote that
 * used to say so was one nobody read.
 */
export default function UnhideConfirmModal({
  pending,
  isAlways,
  onClose,
  onConfirm,
}: UnhideConfirmModalProps) {
  const label = pending?.label ?? '';

  return (
    <ConfirmationModal
      isOpen={pending !== null}
      onClose={onClose}
      onConfirm={onConfirm}
      tone='brand'
      title={isAlways ? 'Unhide in every search' : 'Unhide this item'}
      description={
        isAlways
          ? `You are about to bring "${label}" back. It is hidden in every search, so unhiding it here brings it back everywhere, not only in these results.`
          : `You are about to bring "${label}" back into these results. It stays in the result set either way.`
      }
      confirmLabel={isAlways ? 'Unhide everywhere' : 'Unhide'}
      successMessage={
        isAlways
          ? `"${label}" is no longer hidden in any search.`
          : `"${label}" is back in these results.`
      }
    />
  );
}
