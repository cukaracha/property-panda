import { useEffect, useMemo, useRef, useState } from 'react';
import type { PointerEvent as ReactPointerEvent } from 'react';
import { ArrowDown, ArrowLeft, ArrowRight, ArrowUp, Minus, Plus, RotateCcw } from 'lucide-react';
import { cn } from '../../lib/utils';
import RegionQuickSelect from './RegionQuickSelect';
import { DISTRICT_SHAPES, DISTRICT_VIEW_BOX } from '../../data/singaporeDistricts';

export interface MapViewport {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

export interface DistrictMarker {
  id: string;
  x: number;
  y: number;
  /** Positioned by district rather than by its own coordinates, so drawn as approximate. */
  dimmed?: boolean;
  /** The district holding it, which is what pins consolidate by while zoomed out. */
  district?: string;
}

export interface DistrictMapProps {
  selected?: string[];
  /** Omitted makes the map read-only: no toggling, no keyboard targets. */
  onSelectionChange?: (codes: string[]) => void;
  markers?: DistrictMarker[];
  /** Fires with null at the default fit, debounced. See emitViewport below. */
  onViewportChange?: (viewport: MapViewport | null) => void;
  showQuickSelect?: boolean;
  /** Names by district code, for tooltips and the screen-reader summary. */
  districtNames?: Record<string, string>;
  className?: string;
}

interface View {
  x: number;
  y: number;
  k: number;
}

const [VIEW_WIDTH, VIEW_HEIGHT] = (() => {
  const parts = DISTRICT_VIEW_BOX.split(' ').map(Number);
  return [parts[2], parts[3]];
})();

const DEFAULT_VIEW: View = { x: 0, y: 0, k: 1 };
const EMPTY_SELECTION: string[] = [];
const MIN_SCALE = 1;
const MAX_SCALE = 8;
const ZOOM_SENSITIVITY = 0.002;
/** One press of a zoom button, as a multiplier. */
const ZOOM_STEP = 1.5;
/** One press of a pan arrow, as a fraction of what is currently visible. */
const PAN_STEP = 0.18;
/** Total pointer travel below which a drag counts as a click rather than a pan. */
const CLICK_TRAVEL_PX = 4;
const VIEWPORT_DEBOUNCE_MS = 120;
/** A district gets a label once `labelExtent * zoom` clears this. See DistrictShape. */
const LABEL_MIN_EXTENT = 60;
/**
 * Below this, a district holding more than one property draws a single disc with the
 * count. Above it every property gets its own pin. Zoomed out the pins overlap into an
 * unreadable smear, and a count is the honest thing to draw instead.
 */
const PIN_SPLIT_SCALE = 2.4;

function clamp(value: number, low: number, high: number) {
  return Math.min(high, Math.max(low, value));
}

/**
 * Keep the content covering the frame: at zoom k the content spans W*k, so the pan offset
 * lives in [W*(1-k), 0]. At k=1 that pins x and y to exactly 0, which is what makes
 * "zoomed out" a single unambiguous state rather than a range of near-identical ones.
 */
function clampView(view: View): View {
  const k = clamp(view.k, MIN_SCALE, MAX_SCALE);
  return {
    k,
    x: clamp(view.x, VIEW_WIDTH * (1 - k), 0),
    y: clamp(view.y, VIEW_HEIGHT * (1 - k), 0),
  };
}

function isDefaultView(view: View) {
  return view.k === DEFAULT_VIEW.k && view.x === DEFAULT_VIEW.x && view.y === DEFAULT_VIEW.y;
}

/**
 * The visible rectangle in content coordinates, or null when nothing is zoomed.
 *
 * Null rather than the full-island rectangle on purpose: it separates "has not zoomed" from
 * "zoomed to a box that happens to contain everything", so an untouched map can be made to
 * filter nothing at all instead of filtering by a box that only mostly matches.
 */
function viewportOf(view: View): MapViewport | null {
  if (isDefaultView(view)) return null;
  return {
    minX: -view.x / view.k,
    minY: -view.y / view.k,
    maxX: (VIEW_WIDTH - view.x) / view.k,
    maxY: (VIEW_HEIGHT - view.y) / view.k,
  };
}

interface Pin {
  key: string;
  x: number;
  y: number;
  count: number;
  dimmed: boolean;
}

/**
 * Singapore's 28 postal districts, pannable and zoomable, with optional pins.
 *
 * One component, mounted twice: the results rail and the search form's picker differ only
 * in the model handed in, so both get the region buttons, the frame, the labels, the pins,
 * the live region and the same controls.
 *
 * The frame and its control bar are one conjoined object. A single wrapper carries the
 * border, the radius and `overflow:hidden`, and neither half carries a radius of its own,
 * so the seam between them is a single hairline: the bar's top border when the pair is
 * stacked, its left border when they sit side by side. Which of those happens is a 520px
 * container query, so the same component reads correctly in a 360px rail and in a wide,
 * shallow dialog.
 *
 * Selection is controlled, so the search form and the results page drive it the same way.
 * The component knows nothing about properties or filter state: callers project their own
 * data into DistrictMarker and read back plain district codes and a viewport rectangle.
 */
export default function DistrictMap({
  selected = EMPTY_SELECTION,
  onSelectionChange,
  markers,
  onViewportChange,
  showQuickSelect = true,
  districtNames,
  className,
}: DistrictMapProps) {
  const [view, setView] = useState<View>(DEFAULT_VIEW);
  const [hovered, setHovered] = useState<string | null>(null);
  const svgRef = useRef<SVGSVGElement | null>(null);
  const layerRef = useRef<SVGGElement | null>(null);
  const gestureRef = useRef<{
    pointerId: number;
    lastX: number;
    lastY: number;
    travel: number;
  } | null>(null);
  const onViewportChangeRef = useRef(onViewportChange);

  const interactive = Boolean(onSelectionChange);
  const chosen = useMemo(() => new Set(selected), [selected]);

  useEffect(() => {
    onViewportChangeRef.current = onViewportChange;
  });

  // Debounced, because on the results page every emission re-filters and re-renders the
  // whole property list. The transform itself is never debounced -- it is driven by `view`
  // directly, so the map keeps up with the gesture while only the commit lags.
  useEffect(() => {
    const handle = window.setTimeout(() => {
      onViewportChangeRef.current?.(viewportOf(view));
    }, VIEWPORT_DEBOUNCE_MS);
    return () => window.clearTimeout(handle);
  }, [view]);

  // React registers onWheel passively, where preventDefault silently does nothing and the
  // page scrolls away underneath the gesture. This has to be a manual non-passive listener.
  useEffect(() => {
    const svg = svgRef.current;
    if (!svg) return;

    const handleWheel = (event: WheelEvent) => {
      event.preventDefault();
      const rect = svg.getBoundingClientRect();
      if (!rect.width || !rect.height) return;
      const pointX = ((event.clientX - rect.left) / rect.width) * VIEW_WIDTH;
      const pointY = ((event.clientY - rect.top) / rect.height) * VIEW_HEIGHT;

      setView(current => {
        const nextK = clamp(
          current.k * Math.exp(-event.deltaY * ZOOM_SENSITIVITY),
          MIN_SCALE,
          MAX_SCALE
        );
        // Solve for the offset that leaves whatever sits under the cursor under it still.
        const contentX = (pointX - current.x) / current.k;
        const contentY = (pointY - current.y) / current.k;
        return clampView({
          x: pointX - contentX * nextK,
          y: pointY - contentY * nextK,
          k: nextK,
        });
      });
    };

    svg.addEventListener('wheel', handleWheel, { passive: false });
    return () => svg.removeEventListener('wheel', handleWheel);
  }, []);

  /**
   * Which district lies under a screen point, by asking the paths themselves.
   *
   * isPointInFill rather than elementFromPoint because the labels and pins sit on top of
   * the paths, and elementFromPoint would keep returning those instead of the district.
   */
  const districtAt = (clientX: number, clientY: number) => {
    const layer = layerRef.current;
    const ctm = layer?.getScreenCTM();
    if (!layer || !ctm) return null;
    const point = new DOMPoint(clientX, clientY).matrixTransform(ctm.inverse());
    const paths = Array.from(layer.querySelectorAll<SVGPathElement>('path[data-code]'));
    // Districts do not overlap, so the first hit is the only hit.
    return paths.find(path => path.isPointInFill(point))?.dataset.code ?? null;
  };

  const toggleDistrict = (code: string) => {
    if (!onSelectionChange) return;
    onSelectionChange(
      chosen.has(code) ? selected.filter(item => item !== code) : [...selected, code].sort()
    );
  };

  const handlePointerDown = (event: ReactPointerEvent<SVGSVGElement>) => {
    if (event.button !== 0) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    gestureRef.current = {
      pointerId: event.pointerId,
      lastX: event.clientX,
      lastY: event.clientY,
      travel: 0,
    };
  };

  const handlePointerMove = (event: ReactPointerEvent<SVGSVGElement>) => {
    const gesture = gestureRef.current;
    if (!gesture || gesture.pointerId !== event.pointerId) return;

    const deltaX = event.clientX - gesture.lastX;
    const deltaY = event.clientY - gesture.lastY;
    gesture.lastX = event.clientX;
    gesture.lastY = event.clientY;
    gesture.travel += Math.abs(deltaX) + Math.abs(deltaY);

    const rect = event.currentTarget.getBoundingClientRect();
    if (!rect.width) return;
    const unitsPerPixel = VIEW_WIDTH / rect.width;
    setView(current =>
      clampView({
        ...current,
        x: current.x + deltaX * unitsPerPixel,
        y: current.y + deltaY * unitsPerPixel,
      })
    );
  };

  const handlePointerUp = (event: ReactPointerEvent<SVGSVGElement>) => {
    const gesture = gestureRef.current;
    gestureRef.current = null;
    if (!gesture || gesture.pointerId !== event.pointerId) return;
    if (!interactive || gesture.travel > CLICK_TRAVEL_PX) return;

    const code = districtAt(event.clientX, event.clientY);
    if (code) toggleDistrict(code);
  };

  /** Zoom about the middle of the frame, which is where the eye already is. */
  const zoomTo = (nextK: number) =>
    setView(current => {
      const k = clamp(nextK, MIN_SCALE, MAX_SCALE);
      const midX = VIEW_WIDTH / 2;
      const midY = VIEW_HEIGHT / 2;
      const contentX = (midX - current.x) / current.k;
      const contentY = (midY - current.y) / current.k;
      return clampView({ x: midX - contentX * k, y: midY - contentY * k, k });
    });

  const panBy = (dirX: number, dirY: number) =>
    setView(current =>
      clampView({
        ...current,
        x: current.x - (dirX * VIEW_WIDTH * PAN_STEP) / current.k,
        y: current.y - (dirY * VIEW_HEIGHT * PAN_STEP) / current.k,
      })
    );

  const handleReset = () => {
    setView(DEFAULT_VIEW);
    onSelectionChange?.([]);
  };

  const isAtRest = isDefaultView(view) && selected.length === 0;

  // Zoomed out, a district holding several properties draws one disc with the count
  // rather than a pile of overlapping dots; zoomed in, every property gets its own pin.
  const pins = useMemo<Pin[]>(() => {
    if (!markers?.length) return [];
    const single = (marker: DistrictMarker): Pin => ({
      key: marker.id,
      x: marker.x,
      y: marker.y,
      count: 1,
      dimmed: Boolean(marker.dimmed),
    });
    if (view.k >= PIN_SPLIT_SCALE) return markers.map(single);

    const groups = new Map<string, DistrictMarker[]>();
    const loose: Pin[] = [];
    for (const marker of markers) {
      if (!marker.district) {
        loose.push(single(marker));
        continue;
      }
      const group = groups.get(marker.district);
      if (group) group.push(marker);
      else groups.set(marker.district, [marker]);
    }
    const clustered = [...groups.entries()].map(([code, group]) =>
      group.length === 1
        ? single(group[0])
        : {
            key: `${code}-cluster`,
            x: group.reduce((sum, marker) => sum + marker.x, 0) / group.length,
            y: group.reduce((sum, marker) => sum + marker.y, 0) / group.length,
            count: group.length,
            dimmed: group.every(marker => marker.dimmed),
          }
    );
    return [...clustered, ...loose];
  }, [markers, view.k]);

  const summary = selected.length
    ? `${selected.length} district${selected.length === 1 ? '' : 's'} selected: ${selected
        .map(code => (districtNames?.[code] ? `${code} ${districtNames[code]}` : code))
        .join(', ')}.`
    : 'No districts selected.';

  return (
    <div className={cn('pp-map', className)}>
      {showQuickSelect && interactive ? (
        <RegionQuickSelect selected={selected} onChange={onSelectionChange!} />
      ) : null}

      {/* One wrapper carries the border, the radius and the clip, so the frame and the
          control bar read as a single object with a hairline seam between them. */}
      <div className='pp-map__unit'>
        {/* The container query is asked of this shell, not of the body: an element
            cannot answer its own query, and putting it on the panel root would drop the
            content's width contribution and collapse the column to nothing. */}
        <div className='pp-map__shell'>
          <div className='pp-map__body'>
            <div
              className='pp-map__frame'
              style={{ aspectRatio: `${VIEW_WIDTH} / ${VIEW_HEIGHT}` }}
            >
              <svg
                ref={svgRef}
                viewBox={DISTRICT_VIEW_BOX}
                preserveAspectRatio='xMidYMid meet'
                className={cn(
                  'block h-full w-full select-none',
                  interactive && 'cursor-grab active:cursor-grabbing'
                )}
                style={{ touchAction: 'none' }}
                role='group'
                aria-label='Singapore postal districts'
                onPointerDown={handlePointerDown}
                onPointerMove={handlePointerMove}
                onPointerUp={handlePointerUp}
                onPointerCancel={() => {
                  gestureRef.current = null;
                }}
              >
                <g ref={layerRef} transform={`translate(${view.x} ${view.y}) scale(${view.k})`}>
                  {DISTRICT_SHAPES.map(shape => {
                    const isSelected = chosen.has(shape.code);
                    const isHovered = hovered === shape.code;
                    const name = districtNames?.[shape.code];
                    return (
                      <path
                        key={shape.code}
                        data-code={shape.code}
                        d={shape.d}
                        fill={
                          isSelected
                            ? 'var(--pp-map-sel)'
                            : isHovered
                              ? 'var(--pp-map-fill-hover)'
                              : 'var(--pp-map-fill)'
                        }
                        // Never colour alone: a selected district also carries a heavier
                        // stroke, so the selection survives a colour-blind reading.
                        stroke={
                          isSelected || isHovered ? 'var(--border-brand)' : 'var(--border-subtle)'
                        }
                        strokeWidth={isSelected ? 2 : 1}
                        // Hairlines stay hairlines at 8x, instead of turning into thick bands.
                        vectorEffect='non-scaling-stroke'
                        role={interactive ? 'button' : undefined}
                        tabIndex={interactive ? 0 : undefined}
                        aria-pressed={interactive ? isSelected : undefined}
                        aria-label={name ? `${shape.code} ${name}` : shape.code}
                        onMouseEnter={() => setHovered(shape.code)}
                        onMouseLeave={() =>
                          setHovered(current => (current === shape.code ? null : current))
                        }
                        onKeyDown={event => {
                          if (event.key !== 'Enter' && event.key !== ' ') return;
                          event.preventDefault();
                          toggleDistrict(shape.code);
                        }}
                      >
                        <title>{name ? `${shape.code} ${name}` : shape.code}</title>
                      </path>
                    );
                  })}

                  {/* Labels and pins counter-scale, so they hold their on-screen size while
                      the map grows underneath them. Non-interactive so they never intercept
                      a gesture aimed at the district below. */}
                  <g pointerEvents='none'>
                    {DISTRICT_SHAPES.map(shape =>
                      shape.labelExtent * view.k >= LABEL_MIN_EXTENT ? (
                        <text
                          key={shape.code}
                          x={shape.labelAnchor[0]}
                          y={shape.labelAnchor[1]}
                          textAnchor='middle'
                          dominantBaseline='middle'
                          fontSize={13 / view.k}
                          fill={chosen.has(shape.code) ? 'var(--text-brand)' : 'var(--text-muted)'}
                        >
                          {shape.code}
                        </text>
                      ) : null
                    )}

                    {pins.map(pin => (
                      <g key={pin.key} opacity={pin.dimmed ? 0.45 : 1}>
                        <circle
                          cx={pin.x}
                          cy={pin.y}
                          r={(pin.count > 1 ? 9 : 4.5) / view.k}
                          fill='var(--surface-brand)'
                          stroke='var(--surface-card)'
                          strokeWidth={1.5}
                          vectorEffect='non-scaling-stroke'
                        />
                        {pin.count > 1 && (
                          <text
                            x={pin.x}
                            y={pin.y}
                            textAnchor='middle'
                            dominantBaseline='central'
                            fontSize={9 / view.k}
                            fontWeight={700}
                            fill='var(--action-primary-text)'
                          >
                            {pin.count}
                          </text>
                        )}
                      </g>
                    ))}
                  </g>
                </g>
              </svg>
            </div>

            {/* The controls are structurally beside the map, never over it: at rail size
                a floating cluster covers a fifth of the island and eclipses whole
                districts, and no amount of pointer-events tuning fixes a control that is
                physically on top of its target. */}
            <div className='pp-map__bar'>
              <div className='pp-map__zoom'>
                <button
                  type='button'
                  className='pp-map__btn'
                  aria-label='Zoom out'
                  title='Zoom out'
                  disabled={view.k <= MIN_SCALE}
                  onClick={() => zoomTo(view.k / ZOOM_STEP)}
                >
                  <Minus size={15} />
                </button>
                <input
                  type='range'
                  className='pp-map__slider'
                  min={MIN_SCALE}
                  max={MAX_SCALE}
                  step={0.1}
                  value={view.k}
                  aria-label='Zoom'
                  onChange={event => zoomTo(Number(event.target.value))}
                />
                <button
                  type='button'
                  className='pp-map__btn'
                  aria-label='Zoom in'
                  title='Zoom in'
                  disabled={view.k >= MAX_SCALE}
                  onClick={() => zoomTo(view.k * ZOOM_STEP)}
                >
                  <Plus size={15} />
                </button>
              </div>

              {/* Reset sits at the centre of the pan pad rather than in a footer of its
                  own: it is the same action, and two of them is one too many. */}
              <div className='pp-map__pad'>
                <button
                  type='button'
                  className='pp-map__btn pp-map__pad-up'
                  aria-label='Pan up'
                  title='Pan up'
                  onClick={() => panBy(0, -1)}
                >
                  <ArrowUp size={15} />
                </button>
                <button
                  type='button'
                  className='pp-map__btn pp-map__pad-left'
                  aria-label='Pan left'
                  title='Pan left'
                  onClick={() => panBy(-1, 0)}
                >
                  <ArrowLeft size={15} />
                </button>
                <button
                  type='button'
                  className='pp-map__btn pp-map__pad-reset'
                  aria-label='Reset map'
                  title='Reset map'
                  disabled={isAtRest}
                  onClick={handleReset}
                >
                  <RotateCcw size={15} />
                </button>
                <button
                  type='button'
                  className='pp-map__btn pp-map__pad-right'
                  aria-label='Pan right'
                  title='Pan right'
                  onClick={() => panBy(1, 0)}
                >
                  <ArrowRight size={15} />
                </button>
                <button
                  type='button'
                  className='pp-map__btn pp-map__pad-down'
                  aria-label='Pan down'
                  title='Pan down'
                  onClick={() => panBy(0, 1)}
                >
                  <ArrowDown size={15} />
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>

      <p className='sr-only' aria-live='polite'>
        {summary}
      </p>
    </div>
  );
}
