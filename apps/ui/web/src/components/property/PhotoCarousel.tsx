import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ChevronLeft,
  ChevronRight,
  CircleAlert,
  ImageOff,
  Images,
  Minus,
  Plus,
  RotateCcw,
} from 'lucide-react';
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
 * Which image each of the two stacked stage layers holds, and which of them is the
 * one on show. A photo change writes the new image into the layer that is dark and
 * then makes that layer the live one, which is what gives the change something to
 * fade up from. The dark layer starts empty, so the first photo simply appears.
 */
interface StageLayers {
  slots: [number | null, number | null];
  live: 0 | 1;
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
 * The strip is one component in two arrangements: a rail beside the stage where the
 * dialog has the width for it, and a row under the stage where it does not. The counter
 * travels with it, so it reads beside the thumbnails in the first and under the stage in
 * the second -- and under the stage on its own when a set holds a single image.
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
  const [layers, setLayers] = useState<StageLayers>({ slots: [0, null], live: 0 });
  /**
   * A CDN URL can go stale between the scrape that captured it and the render, and a
   * stage filled with the browser's broken-image glyph reads as a broken dialog rather
   * than as one photo that has moved. Kept per source rather than as a flag, so paging
   * past a dead photo to a live one still shows the live one.
   */
  const [failed, setFailed] = useState<Set<string>>(new Set());
  const stripRef = useRef<HTMLDivElement | null>(null);
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
  const index = layers.slots[layers.live] ?? 0;

  // Wraps at both ends, so holding an arrow key never dead-ends on the last photo. Every
  // way of changing photo funnels through here, which is what makes this the one place
  // the zoom has to be dropped: the next photo is a different picture, not a new view of
  // the one being inspected. It also leaves both layers at identity for the cross-fade.
  const show = useCallback(
    (next: number) => {
      if (count === 0) return;
      reset();
      setLayers(current => {
        const target = (next + count) % count;
        // Asking for the photo already on show -- clicking its own thumbnail -- must not
        // flip the layers, or it would fade the image out and back in under itself.
        if (target === current.slots[current.live]) return current;
        const live: 0 | 1 = current.live === 0 ? 1 : 0;
        return {
          slots: live === 0 ? [target, current.slots[1]] : [current.slots[0], target],
          live,
        };
      });
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

  /**
   * Keep the current thumbnail inside the strip's own view -- three dozen of them do not
   * fit either arrangement. Written as scroll offsets rather than scrollIntoView, which
   * would scroll every ancestor as well and slide the dialog around under the photo.
   * Whichever axis actually overflows is the one the strip is scrolling on.
   */
  useEffect(() => {
    const strip = stripRef.current;
    if (!strip) return;
    const thumb = strip.children[index];
    if (!(thumb instanceof HTMLElement)) return;
    if (strip.scrollHeight > strip.clientHeight) {
      strip.scrollTop = thumb.offsetTop - (strip.clientHeight - thumb.offsetHeight) / 2;
    } else {
      strip.scrollLeft = thumb.offsetLeft - (strip.clientWidth - thumb.offsetWidth) / 2;
    }
  }, [count, index]);

  const markFailed = (src: string) => {
    setFailed(previous => (previous.has(src) ? previous : new Set(previous).add(src)));
  };

  if (isLoading) {
    return (
      <div
        role='status'
        aria-busy='true'
        aria-label='Loading'
        className='flex min-h-0 flex-1 flex-col items-center justify-center gap-4'
      >
        {/* Hidden from the reader: the wrapper is already the busy status, and the
            spinner carries a status role of its own that would announce twice. */}
        <Spinner size='lg' aria-hidden />
        <span className='text-sm text-muted'>Asking the local server for the images.</span>
      </div>
    );
  }

  if (error) {
    return (
      <div
        role='alert'
        className='flex min-h-0 flex-1 flex-col items-center justify-center gap-3 px-6'
      >
        <span className='pp-photo__tile pp-photo__tile--danger'>
          <CircleAlert size={21} />
        </span>
        <p className='pp-photo__note text-danger'>{error}</p>
      </div>
    );
  }

  if (count === 0) {
    return (
      <div className='flex min-h-0 flex-1 flex-col items-center justify-center gap-3 px-6'>
        <span className='pp-photo__tile'>
          <Images size={21} />
        </span>
        <p className='pp-photo__note text-muted'>{emptyMessage}</p>
      </div>
    );
  }

  const current = photos[index];
  /* Mono and tabular, so the number holds still as the set is paged through. */
  const counter = (
    <span className='type-data-xs inline-flex h-[26px] flex-none items-center justify-center whitespace-nowrap rounded-pill border border-line bg-sunken px-[11px] tabular-nums'>
      {`${index + 1} of ${count}`}
    </span>
  );

  return (
    <div className={cn('flex min-h-0 flex-1 flex-col gap-3', count > 1 && 'md:flex-row')}>
      {/* The stage is the wheel target and the frame the photo is clipped to; the
          viewport inside it is what the pan gesture runs on. The nav buttons and the
          zoom cluster are siblings of that viewport rather than children, the same
          trick the map's control panel uses: a gesture that starts on a button never
          reaches the pan handler, while the wheel still bubbles up from anywhere. */}
      <div
        ref={setStage}
        className='relative min-h-0 min-w-0 flex-1 overflow-hidden rounded-photo border border-line bg-photo shadow-hairline'
      >
        <div
          className={cn('pp-photo__viewport', isZoomed && 'cursor-grab active:cursor-grabbing')}
          {...panHandlers}
        >
          {layers.slots.map((position, slot) => {
            const live = slot === layers.live;
            const src = position === null ? undefined : photos[position];
            return (
              <div
                key={slot}
                aria-hidden={live ? undefined : true}
                className={cn('pp-photo__layer', live ? 'opacity-100' : 'opacity-0')}
              >
                {src &&
                  (failed.has(src) ? (
                    <div className='flex flex-col items-center gap-2.5 px-6 text-center'>
                      <ImageOff size={28} className='text-subtle' />
                      <p className='text-sm text-muted'>This image is no longer available.</p>
                    </div>
                  ) : (
                    <img
                      /* Only the layer on show is zoomed, described, and pannable. */
                      ref={live ? imageRef : undefined}
                      src={src}
                      alt={live ? `Image ${index + 1} of ${count} of ${subject}` : ''}
                      /* Off, or the browser's own image drag fights the pan. */
                      draggable={false}
                      style={live ? imageStyle : undefined}
                      onError={() => markFailed(src)}
                      className='max-h-full max-w-full rounded-photo object-contain shadow-hairline'
                    />
                  ))}
              </div>
            );
          })}
        </div>
        {count > 1 && (
          <>
            <Button
              variant='secondary'
              size='icon'
              className='absolute left-3 top-1/2 -translate-y-1/2 rounded-pill shadow-sm'
              title='Previous image'
              aria-label='Previous image'
              onClick={() => show(index - 1)}
            >
              <ChevronLeft size={18} />
            </Button>
            <Button
              variant='secondary'
              size='icon'
              className='absolute right-3 top-1/2 -translate-y-1/2 rounded-pill shadow-sm'
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

      {count > 1 ? (
        <div className='flex flex-none flex-col items-center gap-2.5 md:w-[120px]'>
          {counter}
          {/* The only scroller in the dialog, and relative so the reveal above can read
              its thumbnails' offsets against it. */}
          <div
            ref={stripRef}
            className='relative flex max-w-full gap-2 overflow-x-auto overflow-y-hidden p-1 md:min-h-0 md:w-full md:flex-1 md:flex-col md:items-center md:overflow-x-hidden md:overflow-y-auto'
          >
            {photos.map((src, position) => (
              <button
                /* Position first: one set can carry the same URL twice. */
                key={`${position}-${src}`}
                type='button'
                className='pp-photo__thumb h-[62px] w-[92px] md:h-[66px] md:w-[100px]'
                title={`Image ${position + 1}`}
                aria-label={`Show image ${position + 1} of ${count}`}
                aria-current={position === index ? true : undefined}
                onClick={() => show(position)}
              >
                {failed.has(src) ? (
                  <ImageOff size={15} className='text-subtle' />
                ) : (
                  /* Lazily loaded: a listing can carry three dozen of these. */
                  <img
                    src={src}
                    alt=''
                    loading='lazy'
                    decoding='async'
                    onError={() => markFailed(src)}
                    className='h-full w-full object-cover'
                  />
                )}
              </button>
            ))}
          </div>
        </div>
      ) : (
        <div className='flex flex-none justify-center'>{counter}</div>
      )}
    </div>
  );
}
