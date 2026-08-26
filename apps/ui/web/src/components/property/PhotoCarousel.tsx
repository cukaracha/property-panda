import { useCallback, useEffect, useState } from 'react';
import { ChevronLeft, ChevronRight, ImageOff } from 'lucide-react';
import { Button } from '../ui/button';
import { Spinner } from '../ui/spinner';
import { cn } from '../../lib/utils';

export interface PhotoCarouselProps {
  photos: string[];
  isLoading: boolean;
  /** Empty when nothing went wrong. Shown in place of the carousel when it is set. */
  error: string;
  /** Named in each photo's alt text: "this 3 bedroom unit", "Grand Dunman". */
  subject: string;
  emptyMessage: string;
}

/**
 * A set of photos, one at a time over a strip of thumbnails, with the loading, error
 * and empty states of whatever is fetching them.
 *
 * It is the body of both photo dialogs and holds no fetch and no modal chrome of its
 * own, because the two differ only in where their photos come from: one shows the unit
 * that is for sale, the other the development around it. Those two sets are stored and
 * served apart and are never merged, but they are looked at in the same way.
 *
 * Numbered rather than captioned, for the reason FloorplanModal gives -- the source
 * repeats one SEO string across every image it carries.
 */
export default function PhotoCarousel({
  photos,
  isLoading,
  error,
  subject,
  emptyMessage,
}: PhotoCarouselProps) {
  const [index, setIndex] = useState(0);
  /**
   * A CDN URL can go stale between the scrape that captured it and the render, and a
   * stage filled with the browser's broken-image glyph reads as a broken dialog rather
   * than as one photo that has moved. Kept per source rather than as a flag, so paging
   * past a dead photo to a live one still shows the live one.
   */
  const [failed, setFailed] = useState<Set<string>>(new Set());

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
    if (count < 2) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'ArrowLeft') show(index - 1);
      else if (event.key === 'ArrowRight') show(index + 1);
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [count, index, show]);

  const markFailed = (src: string) => {
    setFailed(previous => (previous.has(src) ? previous : new Set(previous).add(src)));
  };

  if (isLoading) {
    return (
      <div className='flex flex-1 items-center justify-center'>
        <Spinner />
      </div>
    );
  }

  if (error) {
    return (
      <div className='flex flex-1 items-center justify-center px-6 text-center'>
        <p className='text-sm text-danger'>{error}</p>
      </div>
    );
  }

  if (count === 0) {
    return (
      <div className='flex flex-1 items-center justify-center px-6 text-center'>
        <p className='text-sm text-muted'>{emptyMessage}</p>
      </div>
    );
  }

  const current = photos[index];

  return (
    <div className='flex min-h-0 flex-1 flex-col gap-3'>
      <div className='relative flex min-h-0 flex-1 items-center justify-center overflow-hidden rounded-photo border border-line bg-photo'>
        {failed.has(current) ? (
          <div className='flex flex-col items-center gap-2 px-6 text-center'>
            <ImageOff size={28} className='text-subtle' />
            <p className='text-sm text-muted'>This photo is no longer available.</p>
          </div>
        ) : (
          <img
            src={current}
            alt={`Photo ${index + 1} of ${count} of ${subject}`}
            onError={() => markFailed(current)}
            className='max-h-full max-w-full object-contain'
          />
        )}
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
        <div className='flex shrink-0 gap-2 overflow-x-auto p-1 -m-1'>
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
              {failed.has(src) ? (
                <span className='flex h-full w-full items-center justify-center'>
                  <ImageOff size={16} className='text-subtle' />
                </span>
              ) : (
                /* Lazily loaded: a listing can carry three dozen of these. */
                <img
                  src={src}
                  alt=''
                  loading='lazy'
                  onError={() => markFailed(src)}
                  className='h-full w-full object-cover'
                />
              )}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
