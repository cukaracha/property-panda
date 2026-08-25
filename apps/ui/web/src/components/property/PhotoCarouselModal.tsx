import { useCallback, useEffect, useState } from 'react';
import { ChevronLeft, ChevronRight, Images } from 'lucide-react';
import Modal from '../modals/Modal';
import { Button } from '../ui/button';
import { Spinner } from '../ui/spinner';
import { cn } from '../../lib/utils';
import { fetchListingPhotos } from '../../services/listingsService';
import type { ListingRow } from '../../types/listings';
import { formatCurrency } from '../../lib/listingsFormat';

interface PhotoCarouselModalProps {
  row: ListingRow | null;
  onClose: () => void;
}

/**
 * The listing's photos, one at a time over a strip of thumbnails.
 *
 * Where they come from depends on the screen, and the difference is the whole reason
 * this fetches at all. A search result carries only the count, because a listing has
 * seventeen photos on average and putting the URLs on every unit would add megabytes to
 * a payload the browser keeps in sessionStorage, so the list is asked for on open. A
 * shortlisted unit already carries the photos, snapshotted when it was hearted, and
 * those are preferred: they are what lets the shortlist keep working past the day the
 * server holds the fetchable copy for.
 *
 * Numbered rather than captioned, for the reason FloorplanModal gives -- the source
 * repeats one SEO string across every image in a listing.
 */
export default function PhotoCarouselModal({ row, onClose }: PhotoCarouselModalProps) {
  const listingId = row ? String(row.listingId) : '';
  const snapshot = row?.photos;

  const [photos, setPhotos] = useState<string[]>([]);
  const [index, setIndex] = useState(0);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    setIndex(0);
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

  const count = photos.length;

  // Wraps at both ends, so holding an arrow key never dead-ends on the last photo.
  const show = useCallback(
    (next: number) => {
      if (count === 0) return;
      setIndex((next + count) % count);
    },
    [count]
  );

  useEffect(() => {
    if (!listingId || count < 2) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'ArrowLeft') show(index - 1);
      else if (event.key === 'ArrowRight') show(index + 1);
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [listingId, count, index, show]);

  if (!row) return null;

  return (
    <Modal
      isOpen
      onClose={onClose}
      title={count === 1 ? 'Photo' : 'Photos'}
      description={`${row.unitTypeLabel} at ${formatCurrency(row.price)}`}
      icon={<Images size={20} />}
      iconColor='text-brand'
      // A photo is the whole point of this dialog, so it takes the room rather than
      // being shrink-wrapped to whatever the first image happens to be shaped like.
      maxWidth='max-w-[960px]'
      fillHeight
    >
      {isLoading ? (
        <div className='flex flex-1 items-center justify-center'>
          <Spinner />
        </div>
      ) : error ? (
        <div className='flex flex-1 items-center justify-center px-6 text-center'>
          <p className='text-sm text-danger'>{error}</p>
        </div>
      ) : count === 0 ? (
        <div className='flex flex-1 items-center justify-center px-6 text-center'>
          <p className='text-sm text-muted'>This listing has no photos.</p>
        </div>
      ) : (
        <div className='flex min-h-0 flex-1 flex-col gap-3'>
          <div className='relative flex min-h-0 flex-1 items-center justify-center overflow-hidden rounded-photo border border-line bg-photo'>
            <img
              src={photos[index]}
              alt={`Photo ${index + 1} of ${count} of this ${row.unitTypeLabel} unit`}
              className='max-h-full max-w-full object-contain'
            />
            {count > 1 && (
              <>
                <Button
                  variant='secondary'
                  size='icon'
                  className='absolute left-3 top-1/2 -translate-y-1/2'
                  title='Previous photo'
                  aria-label='Previous photo'
                  onClick={() => show(index - 1)}
                >
                  <ChevronLeft size={18} />
                </Button>
                <Button
                  variant='secondary'
                  size='icon'
                  className='absolute right-3 top-1/2 -translate-y-1/2'
                  title='Next photo'
                  aria-label='Next photo'
                  onClick={() => show(index + 1)}
                >
                  <ChevronRight size={18} />
                </Button>
              </>
            )}
          </div>

          <div className='type-ui-eyebrow text-center'>{`${index + 1} of ${count}`}</div>

          {count > 1 && (
            <div className='flex shrink-0 gap-2 overflow-x-auto pb-1'>
              {photos.map((src, position) => (
                <button
                  key={src}
                  type='button'
                  className={cn(
                    'h-14 w-20 shrink-0 overflow-hidden rounded-photo border bg-photo',
                    position === index ? 'border-line-brand' : 'border-line'
                  )}
                  title={`Photo ${position + 1}`}
                  aria-label={`Show photo ${position + 1} of ${count}`}
                  aria-current={position === index}
                  onClick={() => show(position)}
                >
                  {/* Lazily loaded: a listing can carry three dozen of these. */}
                  <img src={src} alt='' loading='lazy' className='h-full w-full object-cover' />
                </button>
              ))}
            </div>
          )}
        </div>
      )}
    </Modal>
  );
}
