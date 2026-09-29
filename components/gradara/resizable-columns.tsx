'use client';
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
} from 'react';
import { useStored } from './use-stored';

/** Remembered widths, per table, in this browser; anything malformed means the defaults. */
function parse(raw: string | null, defaults: number[]) {
  try {
    const saved: unknown = JSON.parse(raw ?? 'null');
    if (
      Array.isArray(saved) &&
      saved.length === defaults.length &&
      saved.every((w) => typeof w === 'number' && w > 0)
    )
      return saved as number[];
  } catch {
    /* A corrupt entry falls back to the defaults. */
  }
  return defaults;
}

/** Every remembered pane size and column width returns to its default. */
export const RESET_LAYOUT_EVENT = 'gradara:reset-layout';
export function resetLayout() {
  window.dispatchEvent(new Event(RESET_LAYOUT_EVENT));
}

let canvas: HTMLCanvasElement | undefined;
/** The rendered width of `text` in the font of `sample`. */
export function textWidth(text: string, sample: Element | null) {
  canvas ??= document.createElement('canvas');
  const ctx = canvas.getContext('2d');
  if (!ctx) return text.length * 8;
  const style = sample ? getComputedStyle(sample) : undefined;
  ctx.font = style
    ? `${style.fontWeight} ${style.fontSize} ${style.fontFamily}`
    : '13px sans-serif';
  return ctx.measureText(text).width;
}

/**
 * Column widths a user can drag, double-click to fit the longest entry, and that are
 * remembered. The table scrolls sideways when the columns are wider than the panel, so
 * any text can be brought fully into view.
 */
export function useColumns(key: string, defaults: number[], min = 40) {
  const [raw, write] = useStored(`gradara:columns:${key}`);
  const [initial] = useState(defaults);
  const widths = useMemo(() => parse(raw, initial), [raw, initial]);
  const latest = useRef(widths);
  useEffect(() => {
    latest.current = widths;
  }, [widths]);
  const resize = useCallback(
    (index: number, width: number) => {
      const next = latest.current.map((v, i) =>
        i === index ? Math.max(min, Math.round(width)) : v,
      );
      latest.current = next;
      write(JSON.stringify(next));
    },
    [write, min],
  );
  const reset = useCallback(() => write(null), [write]);
  useEffect(() => {
    window.addEventListener(RESET_LAYOUT_EVENT, reset);
    return () => window.removeEventListener(RESET_LAYOUT_EVENT, reset);
  }, [reset]);
  return {
    widths,
    template: widths.map((w) => `${w}px`).join(' '),
    total: widths.reduce((t, w) => t + w, 0) + 8 * (widths.length - 1) + 24,
    resize,
    reset,
    current: latest,
  };
}

/** A column heading with a drag handle on its right edge. */
export function ColumnHead({
  label,
  index,
  columns,
  fit,
}: {
  label: string;
  index: number;
  columns: ReturnType<typeof useColumns>;
  /** The texts in this column, for double-click to fit. */
  fit?: () => string[];
}) {
  const ref = useRef<HTMLSpanElement>(null);
  return (
    <span className="column-head" ref={ref}>
      <span className="column-label">{label}</span>
      <button
        type="button"
        className="column-resizer"
        aria-label={`Resize the ${label || 'last'} column: drag, arrow keys, or double-click to fit`}
        onKeyDown={(e) => {
          if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
          e.preventDefault();
          e.stopPropagation();
          const step = e.shiftKey ? 40 : 10;
          columns.resize(
            index,
            columns.current.current[index] +
              (e.key === 'ArrowRight' ? step : -step),
          );
        }}
        onPointerDown={(e) => {
          e.preventDefault();
          const start = e.clientX;
          const width = columns.current.current[index];
          const target = e.currentTarget;
          target.setPointerCapture(e.pointerId);
          const move = (m: PointerEvent) =>
            columns.resize(index, width + m.clientX - start);
          const up = () => {
            target.removeEventListener('pointermove', move);
            target.removeEventListener('pointerup', up);
            target.removeEventListener('pointercancel', up);
          };
          target.addEventListener('pointermove', move);
          target.addEventListener('pointerup', up);
          target.addEventListener('pointercancel', up);
        }}
        onDoubleClick={() => {
          if (!fit) return;
          // Measure in the rows' font: the first row cell, or the heading itself.
          const table = ref.current?.closest('.table-scroll');
          const sample =
            table?.querySelector('.table-row > span') ?? ref.current;
          const widest = Math.max(
            textWidth(label, ref.current),
            ...fit().map((t) => textWidth(t, sample)),
          );
          columns.resize(index, widest + 20);
        }}
      />
    </span>
  );
}

/** A draggable border between two panes; `onResize` gets the pointer's travel. */
export function PaneResizer({
  label,
  onResize,
  onReset,
  className = '',
  style,
}: {
  label: string;
  className?: string;
  style?: CSSProperties;
  onResize: (delta: number, start: boolean) => void;
  onReset: () => void;
}) {
  return (
    <button
      type="button"
      className={`pane-resizer ${className}`}
      style={style}
      aria-label={`${label}: drag, arrow keys, or double-click to reset`}
      onKeyDown={(e) => {
        if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
        e.preventDefault();
        e.stopPropagation();
        onResize(0, true);
        onResize(
          (e.key === 'ArrowRight' ? 1 : -1) * (e.shiftKey ? 40 : 10),
          false,
        );
      }}
      onDoubleClick={onReset}
      onPointerDown={(e) => {
        e.preventDefault();
        const start = e.clientX;
        const target = e.currentTarget;
        target.setPointerCapture(e.pointerId);
        onResize(0, true);
        const move = (m: PointerEvent) => onResize(m.clientX - start, false);
        const up = () => {
          target.removeEventListener('pointermove', move);
          target.removeEventListener('pointerup', up);
          target.removeEventListener('pointercancel', up);
        };
        target.addEventListener('pointermove', move);
        target.addEventListener('pointerup', up);
        target.addEventListener('pointercancel', up);
      }}
    />
  );
}
