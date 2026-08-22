/** Measure an element with a ResizeObserver — force-graph needs explicit pixel
 *  width/height, so the graph container is measured and the size passed in.
 *  Uses a callback ref (not useRef + a mount-only effect) so the observer
 *  re-attaches whenever the target mounts: the graph container is rendered
 *  conditionally, so an effect keyed on [] would never see it appear. */
import { useCallback, useRef, useState } from 'react';

export function useElementSize<T extends HTMLElement>() {
  const [size, setSize] = useState({ width: 0, height: 0 });
  const observerRef = useRef<ResizeObserver | null>(null);

  const ref = useCallback((element: T | null) => {
    observerRef.current?.disconnect();
    if (!element) return;
    const observer = new ResizeObserver(entries => {
      const rect = entries[0]?.contentRect;
      if (rect) setSize({ width: Math.round(rect.width), height: Math.round(rect.height) });
    });
    observer.observe(element);
    observerRef.current = observer;
  }, []);

  return { ref, ...size };
}
