import { Ruler } from 'lucide-react';
import Modal from '../modals/Modal';
import PhotoCarousel from './PhotoCarousel';
import type { ListingRow } from '../../types/listings';
import { formatCurrency } from '../../lib/listingsFormat';

interface FloorplanModalProps {
  row: ListingRow | null;
  onClose: () => void;
}

/**
 * The floorplan images the listing itself carries. Plans are numbered rather than
 * captioned, because the source repeats one SEO string across every image in a
 * listing and it cannot tell two plans apart.
 *
 * Results scraped before the parser kept these have no images at all, so this
 * renders nothing rather than an empty frame.
 *
 * Shown over the shared carousel, which is what gives a plan its zoom. A floorplan is
 * a line drawing full of dimensions printed small, so of the three image dialogs this
 * is the one that most needs to be looked at closely. The plans ride along on the row,
 * so there is nothing to fetch and no failure to report.
 */
export default function FloorplanModal({ row, onClose }: FloorplanModalProps) {
  const plans = row?.floorplans ?? [];
  if (!row || plans.length === 0) return null;

  return (
    <Modal
      isOpen
      onClose={onClose}
      title={plans.length > 1 ? 'Floorplans' : 'Floorplan'}
      description={`${row.unitTypeLabel} at ${formatCurrency(row.price)}`}
      icon={<Ruler size={20} />}
      iconColor='text-brand'
      maxWidth='max-w-[960px]'
      fillHeight
    >
      <PhotoCarousel
        photos={plans}
        isLoading={false}
        error=''
        subject={`this ${row.unitTypeLabel} unit's floorplans`}
        emptyMessage='This listing has no floorplans.'
      />
    </Modal>
  );
}
