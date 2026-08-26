/**
 * useImageZoom — wheel to zoom about the cursor, drag to pan, over one image.
 *
 * The same interaction DistrictMap carries, in CSS pixels rather than viewBox units.
 * It is a hook rather than a shared component because the two clamp differently: the
 * map keeps its content covering the frame, while a photo letterboxes inside its stage
 * and has to be bounded by its own rendered box, which is narrower than the box it sits
 * in. Everything else -- the view triple, the exponential wheel, the offset that holds
 * the point under the cursor still -- is the map's, line for line.
 *
 * The caller hands the stage in through `setStage` and the image through `imageRef`,
 * spreads `panHandlers` on whatever should be draggable and puts `imageStyle` on the
 * image. Every measurement is taken when a gesture fires, so a photo that has not
 * loaded yet, or one that failed, simply does not move.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import type { CSSProperties, PointerEvent as ReactPointerEvent } from 'react';

interface View {
  x: number;
  y: number;
  k: number;
}

/**
 * The stage and the image as they are laid out right now, in CSS pixels, with the
 * stage's centre in client coordinates. offsetWidth/offsetHeight rather than a
 * bounding rect for the image: those are layout sizes, so the transform this hook
 * applies does not feed back into the numbers that decide the transform.
 */
interface Bounds {
  centreX: number;
  centreY: number;
  stageW: number;
  stageH: number;
  imageW: number;
  imageH: number;
}

const DEFAULT_VIEW: View = { x: 0, y: 0, k: 1 };
const MIN_SCALE = 1;
const MAX_SCALE = 6;
const ZOOM_SENSITIVITY = 0.002;
/** One press of a zoom button, as a multiplier. */
const ZOOM_STEP = 1.5;

function clamp(value: number, low: number, high: number) {
  return Math.min(high, Math.max(low, value));
}

/**
 * Keep the photo's own edge out of the frame: at zoom k it spans imageW*k, so the offset
 * lives within half the overhang either way. An axis with nothing to spare is pinned to
 * centred, which is what makes k=1 a single unambiguous state rather than a range of
 * near-identical ones.
 */
function clampView(view: View, bounds: Bounds): View {
  const k = clamp(view.k, MIN_SCALE, MAX_SCALE);
  const limitX = Math.max(0, (bounds.imageW * k - bounds.stageW) / 2);
  const limitY = Math.max(0, (bounds.imageH * k - bounds.stageH) / 2);
  return {
    k,
    x: clamp(view.x, -limitX, limitX),
    y: clamp(view.y, -limitY, limitY),
  };
}

export function useImageZoom() {
  const [view, setView] = useState<View>(DEFAULT_VIEW);
  /**
   * The stage arrives as state rather than as a ref because the carousel returns early
   * while its photos are loading: on the render that mounts the stage a ref would already
   * have been read, and the wheel listener below would never attach.
   */
  const [stage, setStage] = useState<HTMLDivElement | null>(null);
  const imageRef = useRef<HTMLImageElement | null>(null);
  const gestureRef = useRef<{ pointerId: number; lastX: number; lastY: number } | null>(null);

  const attachStage = useCallback((node: HTMLDivElement | null) => setStage(node), []);

  const measure = useCallback((): Bounds | null => {
    const image = imageRef.current;
    if (!stage || !image) return null;
    const rect = stage.getBoundingClientRect();
    if (!rect.width || !rect.height || !image.offsetWidth || !image.offsetHeight) return null;
    return {
      centreX: rect.left + rect.width / 2,
      centreY: rect.top + rect.height / 2,
      stageW: rect.width,
      stageH: rect.height,
      imageW: image.offsetWidth,
      imageH: image.offsetHeight,
    };
  }, [stage]);

  // React registers onWheel passively, where preventDefault silently does nothing and the
  // page scrolls away underneath the gesture. This has to be a manual non-passive listener.
  useEffect(() => {
    if (!stage) return;

    const handleWheel = (event: WheelEvent) => {
      event.preventDefault();
      const bounds = measure();
      if (!bounds) return;
      // Measured from the middle, because that is where the transform's origin sits.
      const pointX = event.clientX - bounds.centreX;
      const pointY = event.clientY - bounds.centreY;

      setView(current => {
        const nextK = clamp(
          current.k * Math.exp(-event.deltaY * ZOOM_SENSITIVITY),
          MIN_SCALE,
          MAX_SCALE
        );
        // Solve for the offset that leaves whatever sits under the cursor under it still.
        const contentX = (pointX - current.x) / current.k;
        const contentY = (pointY - current.y) / current.k;
        return clampView(
          { x: pointX - contentX * nextK, y: pointY - contentY * nextK, k: nextK },
          bounds
        );
      });
    };

    stage.addEventListener('wheel', handleWheel, { passive: false });
    return () => stage.removeEventListener('wheel', handleWheel);
  }, [stage, measure]);

  const handlePointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    // Nothing to drag at rest, so a plain click on an unzoomed photo stays a plain click.
    if (event.button !== 0 || view.k <= MIN_SCALE) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    gestureRef.current = {
      pointerId: event.pointerId,
      lastX: event.clientX,
      lastY: event.clientY,
    };
  };

  const handlePointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    const gesture = gestureRef.current;
    if (!gesture || gesture.pointerId !== event.pointerId) return;
    const bounds = measure();
    if (!bounds) return;

    const deltaX = event.clientX - gesture.lastX;
    const deltaY = event.clientY - gesture.lastY;
    gesture.lastX = event.clientX;
    gesture.lastY = event.clientY;

    setView(current =>
      clampView({ ...current, x: current.x + deltaX, y: current.y + deltaY }, bounds)
    );
  };

  const endGesture = () => {
    gestureRef.current = null;
  };

  /** Zoom about the middle of the frame, which is where the eye already is. */
  const zoomTo = (nextK: number) => {
    const bounds = measure();
    if (!bounds) return;
    setView(current => {
      const k = clamp(nextK, MIN_SCALE, MAX_SCALE);
      // The middle is this frame's origin, so holding it still is a straight rescale.
      return clampView(
        { x: (current.x * k) / current.k, y: (current.y * k) / current.k, k },
        bounds
      );
    });
  };

  const reset = useCallback(() => setView(DEFAULT_VIEW), []);

  const imageStyle: CSSProperties = {
    transform: `translate(${view.x}px, ${view.y}px) scale(${view.k})`,
    transformOrigin: 'center',
  };

  return {
    scale: view.k,
    isZoomed: view.k > MIN_SCALE,
    canZoomIn: view.k < MAX_SCALE,
    canZoomOut: view.k > MIN_SCALE,
    setStage: attachStage,
    imageRef,
    imageStyle,
    panHandlers: {
      onPointerDown: handlePointerDown,
      onPointerMove: handlePointerMove,
      onPointerUp: endGesture,
      onPointerCancel: endGesture,
    },
    zoomIn: () => zoomTo(view.k * ZOOM_STEP),
    zoomOut: () => zoomTo(view.k / ZOOM_STEP),
    reset,
  };
}
