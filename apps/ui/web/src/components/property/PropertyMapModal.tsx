import { ExternalLink, MapPin } from 'lucide-react';
import Modal from '../modals/Modal';
import { Button } from '../ui/button';
import type { Property } from '../../types/listings';
import { formatText } from '../../lib/listingsFormat';
import { mapEmbedUrl, mapLinkUrl, mapQuery } from '../../lib/propertyLocation';

interface PropertyMapModalProps {
  property: Property | null;
  onClose: () => void;
}

/**
 * Where one property is, on Google Maps.
 *
 * Different question from the district map in the results rail: that one answers
 * which districts a whole result set falls in, this one answers what is around this
 * single building.
 *
 * The header is load-bearing rather than decorative. The embed drops a plain marker
 * with no place card, so nothing on the map itself says which building it is -- the
 * title and the address are the only labels the user gets.
 *
 * The frame is a cross-origin document, so a blocked or offline embed simply paints
 * nothing and the app cannot tell. That is what the footer link is for: it goes to
 * the same spot, and never depends on the frame having loaded.
 */
export default function PropertyMapModal({ property, onClose }: PropertyMapModalProps) {
  const query = property ? mapQuery(property.info) : null;
  if (!property || !query) return null;

  return (
    <Modal
      isOpen
      onClose={onClose}
      title={property.name}
      description={formatText(property.info.address)}
      icon={<MapPin size={20} />}
      iconColor='text-brand'
      maxWidth='max-w-[860px]'
      fillHeight
      footer={
        <>
          <a
            href={mapLinkUrl(query)}
            target='_blank'
            rel='noreferrer'
            className='btn btn-secondary'
          >
            <ExternalLink size={16} />
            Open in Google Maps
          </a>
          <Button onClick={onClose}>Close</Button>
        </>
      }
    >
      <iframe
        src={mapEmbedUrl(query)}
        title={`Map showing ${property.name}`}
        loading='lazy'
        referrerPolicy='no-referrer-when-downgrade'
        allowFullScreen
        className='min-h-0 w-full flex-1 rounded-photo border border-line bg-sunken'
      />
    </Modal>
  );
}
