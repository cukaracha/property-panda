import { useEffect, useState } from 'react';
import { Images } from 'lucide-react';
import Modal from '../modals/Modal';
import PhotoCarousel from './PhotoCarousel';
import { fetchPropertyPhotos } from '../../services/listingsService';
import type { Property } from '../../types/listings';

interface PropertyPhotosModalProps {
  property: Property | null;
  onClose: () => void;
}

/**
 * The development's own photos, over the shared carousel.
 *
 * These are the project's gallery, not the photos of any unit in it: a listing shows
 * the flat someone is selling, this shows the building, the grounds and the facilities
 * around it. The two are scraped from different pages, stored apart and served by
 * different routes, and neither one ever stands in for the other.
 *
 * Snapshot or fetch, by the same rule the listing carousel follows and for the same
 * reason. A search result carries the count alone, since the URLs would add hundreds of
 * kilobytes to a payload the browser re-serialises to sessionStorage on every change. A
 * shortlisted property carries the list, which is what lets its carousel outlive the
 * cache row a fetch would have read.
 */
export default function PropertyPhotosModal({ property, onClose }: PropertyPhotosModalProps) {
  const propertyId = property?.propertyId || '';
  const snapshot = property?.info.photos;
  // The card's thumbnail is gallery photo #1, so opening the carousel on it needs no
  // special casing. Kept as a fallback in case a future source orders them otherwise:
  // the user clicked this image, so it has to be the one that appears.
  const hero = property?.info.imageUrl || '';

  const [photos, setPhotos] = useState<string[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    setError('');
    if (!propertyId) {
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
    fetchPropertyPhotos(propertyId)
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
  }, [propertyId, snapshot]);

  if (!property) return null;

  const ordered = hero && photos.length > 0 && !photos.includes(hero) ? [hero, ...photos] : photos;

  return (
    <Modal
      isOpen
      onClose={onClose}
      title={ordered.length === 1 ? 'Photo' : 'Photos'}
      description={property.name}
      icon={<Images size={20} />}
      iconColor='text-brand'
      maxWidth='max-w-[960px]'
      fillHeight
    >
      <PhotoCarousel
        photos={ordered}
        isLoading={isLoading}
        error={error}
        subject={property.name}
        emptyMessage='This property has no photos.'
      />
    </Modal>
  );
}
