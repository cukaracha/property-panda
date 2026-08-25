import { useEffect, useState } from 'react';
import { Images } from 'lucide-react';
import Modal from '../modals/Modal';
import PhotoCarousel from './PhotoCarousel';
import { fetchListingPhotos } from '../../services/listingsService';
import type { ListingRow } from '../../types/listings';
import { formatCurrency } from '../../lib/listingsFormat';

interface PhotoCarouselModalProps {
  row: ListingRow | null;
  onClose: () => void;
}

/**
 * The listing's photos, over the shared carousel.
 *
 * Where they come from depends on the screen, and the difference is the whole reason
 * this fetches at all. A search result carries only the count, because a listing has
 * seventeen photos on average and putting the URLs on every unit would add megabytes to
 * a payload the browser keeps in sessionStorage, so the list is asked for on open. A
 * shortlisted unit already carries the photos, snapshotted when it was hearted, and
 * those are preferred: they are what lets the shortlist keep working past the day the
 * server holds the fetchable copy for.
 *
 * These are the unit's own photos. PropertyPhotosModal shows the development's, which
 * is a separate set from a separate page, and the two are never merged.
 */
export default function PhotoCarouselModal({ row, onClose }: PhotoCarouselModalProps) {
  const listingId = row ? String(row.listingId) : '';
  const snapshot = row?.photos;

  const [photos, setPhotos] = useState<string[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    setError('');
    if (!listingId) {
      setPhotos([]);
      return;
    }
    if (snapshot && snapshot.length > 0) {
      setPhotos(snapshot);
      return;
    }

    let cancelled = false;
    setPhotos([]);
    setIsLoading(true);
    fetchListingPhotos(listingId)
      .then(result => {
        if (!cancelled) setPhotos(result.photos);
      })
      .catch(err => {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Failed to load the photos');
      })
      .finally(() => {
        if (!cancelled) setIsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [listingId, snapshot]);

  if (!row) return null;

  return (
    <Modal
      isOpen
      onClose={onClose}
      title={photos.length === 1 ? 'Photo' : 'Photos'}
      description={`${row.unitTypeLabel} at ${formatCurrency(row.price)}`}
      icon={<Images size={20} />}
      iconColor='text-brand'
      // A photo is the whole point of this dialog, so it takes the room rather than
      // being shrink-wrapped to whatever the first image happens to be shaped like.
      maxWidth='max-w-[960px]'
      fillHeight
    >
      <PhotoCarousel
        photos={photos}
        isLoading={isLoading}
        error={error}
        subject={`this ${row.unitTypeLabel} unit`}
        emptyMessage='This listing has no photos.'
      />
    </Modal>
  );
}
