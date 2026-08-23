import { Ruler } from 'lucide-react';
import Modal from '../modals/Modal';
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
      iconColor='text-cyan'
      maxWidth='max-w-[720px]'
    >
      <div className='flex max-h-[70vh] flex-col gap-4 overflow-y-auto'>
        {plans.map((src, index) => (
          <figure key={src} className='flex flex-col gap-2'>
            {plans.length > 1 && (
              <figcaption className='type-ui-eyebrow'>{`${index + 1} of ${plans.length}`}</figcaption>
            )}
            <img
              src={src}
              alt={`Floorplan ${index + 1} of ${plans.length} for this ${row.unitTypeLabel} unit`}
              className='w-full rounded-surface border border-line bg-panel-2'
            />
          </figure>
        ))}
      </div>
    </Modal>
  );
}
