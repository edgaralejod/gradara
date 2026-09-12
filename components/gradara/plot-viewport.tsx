'use client';
import { useLayoutEffect, useRef, useState, type ReactNode } from 'react';

/** Give the plot a bounded viewport and publish measurements after observer delivery. */
export default function PlotViewport({
  children,
}: {
  children: (size: { width: number; height: number }) => ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ width: 0, height: 0 });
  useLayoutEffect(() => {
    const element = ref.current;
    if (!element) return;
    let frame = 0;
    const measure = () => {
      const width = element.clientWidth,
        height = element.clientHeight;
      setSize((previous) =>
        previous.width === width && previous.height === height
          ? previous
          : { width, height },
      );
    };
    measure();
    const observer = new ResizeObserver(() => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(measure);
    });
    observer.observe(element);
    return () => {
      observer.disconnect();
      cancelAnimationFrame(frame);
    };
  }, []);
  return (
    <div className="plot-viewport" ref={ref}>
      {size.width > 0 && size.height > 0 && children(size)}
    </div>
  );
}
