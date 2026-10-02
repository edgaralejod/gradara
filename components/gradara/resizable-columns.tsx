'use client';
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
} from 'react';
import { moveDivider } from '@/lib/gradara/pane-sizes';
import { useStored } from './use-stored';

/** Remembered widths, per table, in this browser; null when nothing valid is saved. */
function saved(raw: string | null, length: number): number[] | null {
  try {
    const value: unknown = JSON.parse(raw ?? 'null');
    if (
      Array.isArray(value) &&
      value.length === length &&
      value.every((w) => typeof w === 'number' && Number.isFinite(w) && w > 0)
    )
      return value as number[];
  } catch {
    /* A corrupt entry falls back to the defaults. */
  }
  return null;
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
  const custom = useMemo(() => saved(raw, initial.length), [raw, initial]);
  const widths = custom ?? initial;
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
    /** The user has set these sizes; otherwise they are the defaults. */
    stored: custom !== null,
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

/**
 * A draggable border between two panes; `onResize` gets the pointer's travel along the
 * axis. `x` (the default) divides side-by-side panes and `y` divides stacked ones; arrow
 * keys along that axis move it, Shift for bigger steps, and a double-click resets.
 */
export function PaneResizer({
  label,
  onResize,
  onReset,
  className = '',
  style,
  axis = 'x',
}: {
  label: string;
  className?: string;
  style?: CSSProperties;
  axis?: 'x' | 'y';
  onResize: (delta: number, start: boolean) => void;
  onReset: () => void;
}) {
  const rows = axis === 'y';
  const [less, more] = rows ? ['ArrowUp', 'ArrowDown'] : ['ArrowLeft', 'ArrowRight'];
  return (
    <button
      type="button"
      className={`${rows ? 'pane-splitter' : 'pane-resizer'} ${className}`}
      style={style}
      aria-label={`${label}: drag, ${rows ? 'up and down' : 'left and right'} arrow keys, or double-click to reset`}
      onKeyDown={(e) => {
        if (e.key !== less && e.key !== more) return;
        e.preventDefault();
        e.stopPropagation();
        onResize(0, true);
        onResize((e.key === more ? 1 : -1) * (e.shiftKey ? 40 : 10), false);
      }}
      onDoubleClick={onReset}
      onPointerDown={(e) => {
        e.preventDefault();
        const origin = rows ? e.clientY : e.clientX;
        const target = e.currentTarget;
        target.setPointerCapture(e.pointerId);
        onResize(0, true);
        const move = (m: PointerEvent) =>
          onResize((rows ? m.clientY : m.clientX) - origin, false);
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

/**
 * One remembered pane size (a width or a height in pixels) and the handler a
 * `PaneResizer` needs. `sign` is 1 when the resized pane comes before the handle (its
 * size grows as the handle moves right or down) and -1 when it comes after.
 */
export function useSize(key: string, fallback: number, min = 60, max = 4000) {
  const columns = useColumns(key, [fallback], min);
  const origin = useRef(fallback);
  const [element, setElement] = useState<HTMLElement | null>(null);
  return {
    /** Hand this to the pane's `ref`: its rendered height is the start until the user sets one. */
    attach: setElement,
    size: Math.min(columns.widths[0], max),
    stored: columns.stored,
    reset: columns.reset,
    resizer: (sign: 1 | -1 = 1) => ({
      onReset: columns.reset,
      onResize: (delta: number, start: boolean) => {
        if (start)
          origin.current =
            (!columns.stored && element?.offsetHeight) || columns.current.current[0];
        columns.resize(0, Math.min(max, origin.current + sign * delta));
      },
    }),
  };
}

/**
 * How a stack of panes shares its space, as fractions that add up to one. Dragging a
 * divider moves space between its two neighbours; no pane shrinks below `min`. The
 * split is remembered under `key`, and `count` changes (a new layout) start even.
 */
export function useFractions(key: string, count: number, min = 0.12) {
  const even = useMemo(() => Array.from({ length: count }, () => 1 / count), [count]);
  const [raw, write] = useStored(`gradara:columns:${key}`);
  const custom = useMemo(() => {
    const value = saved(raw, count);
    return value && Math.abs(value.reduce((t, v) => t + v, 0) - 1) < 1e-6 ? value : null;
  }, [raw, count]);
  const fractions = custom ?? even;
  const latest = useRef(fractions);
  useEffect(() => {
    latest.current = fractions;
  }, [fractions]);
  const origin = useRef(fractions);
  const [element, setElement] = useState<HTMLElement | null>(null);
  const reset = useCallback(() => write(null), [write]);
  useEffect(() => {
    window.addEventListener(RESET_LAYOUT_EVENT, reset);
    return () => window.removeEventListener(RESET_LAYOUT_EVENT, reset);
  }, [reset]);
  return {
    fractions,
    /** Hand this to the stack's `ref`, so a divider can turn the pointer's travel into a fraction. */
    attach: setElement,
    stored: custom !== null,
    reset,
    /** The divider after pane `index`, in a stack laid out along `axis` (`x` side by side, `y` stacked). */
    divider: (index: number, axis: 'x' | 'y') => ({
      onReset: reset,
      onResize: (delta: number, start: boolean) => {
        if (start) origin.current = latest.current;
        const next = moveDivider(
          origin.current,
          index,
          delta /
            Math.max(
              1,
              (axis === 'x' ? element?.clientWidth : element?.clientHeight) ?? 1,
            ),
          min,
        );
        latest.current = next;
        write(JSON.stringify(next));
      },
    }),
  };
}
