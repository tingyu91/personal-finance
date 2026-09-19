import { useLayoutEffect, useRef, useState } from 'react';

/**
 * The rendered width of an element, so SVG marks can be laid out in real pixels (thin bars,
 * a 4px rounded data end) instead of being stretched by a viewBox. Falls back to `initial`
 * where there is no layout (tests, the first paint).
 */
export function useWidth<T extends HTMLElement>(initial: number) {
  const ref = useRef<T>(null);
  const [width, setWidth] = useState(initial);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const read = () => {
      const w = el.getBoundingClientRect().width;
      if (w > 0) setWidth(Math.round(w));
    };
    read();
    if (typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(read);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, width] as const;
}
