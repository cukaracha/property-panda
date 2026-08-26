import { useCallback, useEffect, useState } from 'react';
import { ChevronLeft, ChevronRight, ImageOff, Minus, Plus, RotateCcw } from 'lucide-react';
import { Button } from '../ui/button';
import { Spinner } from '../ui/spinner';
import { cn } from '../../lib/utils';
import { useImageZoom } from '../../hooks/useImageZoom';

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
 * A set of images, one at a time over a strip of thumbnails, with the loading, error
 * and empty states of whatever is fetching them.
 *
 * It is the body of all three image dialogs and holds no fetch and no modal chrome of
 * its own, because they differ only in where their images come from: the unit that is
 * for sale, the development around it, or that unit's floorplans. Those three sets are
 * stored and served apart and are never merged, but they are looked at in the same way.
 * Its copy says "image" rather than "photo" for the same reason.
 *
 * Numbered rather than captioned, for the reason FloorplanModal gives -- the source
 * repeats one SEO string across every image it carries.
 *
 * The stage zooms and pans like the district map, through useImageZoom. A scraped photo
 * is often the only look at a room anyone gets, and letterboxed into a dialog there is
 * no other way to read a detail in one.
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
  const {
    scale,
    isZoomed,
    canZoomIn,
    canZoomOut,
    setStage,
    imageRef,
    imageStyle,
    panHandlers,
    zoomIn,
    zoomOut,
    reset,
  } = useImageZoom();

  const count = photos.length;

  // Wraps at both ends, so holding an arrow key never dead-ends on the last photo. Every
  // way of changing photo funnels through here, which is what makes this the one place
  // the zoom has to be dropped: the next photo is a different picture, not a new view of
  // the one being inspected.
  const show = useCallback(
    (next: number) => {
      if (count === 0) return;
      reset();
      setIndex((next + count) % count);
    },
    [count, reset]
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
      {/* The stage is the wheel target and the frame the photo is clipped to; the
          viewport inside it is what the pan gesture runs on. The nav buttons and the
          zoom cluster are siblings of that viewport rather than children, the same
          trick the map's control panel uses: a gesture that starts on a button never
          reaches the pan handler, while the wheel still bubbles up from anywhere. */}
      <div
        ref={setStage}
        className='relative flex min-h-0 flex-1 flex-col overflow-hidden rounded-photo border border-line bg-photo'
      >
        {failed.has(current) ? (
          <div className='flex flex-1 flex-col items-center justify-center gap-2 px-6 text-center'>
            <ImageOff size={28} className='text-subtle' />
            <p className='text-sm text-muted'>This image is no longer available.</p>
          </div>
        ) : (
          <div
            className={cn('pp-photo__viewport', isZoomed && 'cursor-grab active:cursor-grabbing')}
            {...panHandlers}
          >
            <img
              ref={imageRef}
              src={current}
              alt={`Image ${index + 1} of ${count} of ${subject}`}
              /* Off, or the browser's own image drag fights the pan. */
              draggable={false}
              style={imageStyle}
              onError={() => markFailed(current)}
              className='max-h-full max-w-full object-contain'
            />
          </div>
        )}
        {count > 1 && (
          <>
            <Button
              variant='secondary'
              size='icon'
              className='absolute left-3 top-1/2 -translate-y-1/2'
              title='Previous image'
              aria-label='Previous image'
              onClick={() => show(index - 1)}
            >
              <ChevronLeft size={18} />
            </Button>
            <Button
              variant='secondary'
              size='icon'
              className='absolute right-3 top-1/2 -translate-y-1/2'
              title='Next image'
              aria-label='Next image'
              onClick={() => show(index + 1)}
            >
              <ChevronRight size={18} />
            </Button>
          </>
        )}

        {/* Glass in the corner for the people who will not find the gesture. Hidden on a
            photo that never arrived, where there is nothing to zoom into. */}
        {!failed.has(current) && (
          <div className='pp-photo__controls'>
            <div className='pp-photo__zoom'>
              <button
                type='button'
                className='pp-photo__btn'
                aria-label='Zoom out'
                title='Zoom out'
                disabled={!canZoomOut}
                onClick={zoomOut}
              >
                <Minus size={15} />
              </button>
              <span className='pp-photo__level type-ui-eyebrow' aria-live='polite'>
                {`${Math.round(scale * 100)}%`}
              </span>
              <button
                type='button'
                className='pp-photo__btn'
                aria-label='Zoom in'
                title='Zoom in'
                disabled={!canZoomIn}
                onClick={zoomIn}
              >
                <Plus size={15} />
              </button>
            </div>
            <button
              type='button'
              className='pp-photo__btn'
              aria-label='Reset zoom'
              title='Reset zoom'
              disabled={!isZoomed}
              onClick={reset}
            >
              <RotateCcw size={15} />
            </button>
          </div>
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
              title={`Image ${position + 1}`}
              aria-label={`Show image ${position + 1} of ${count}`}
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
