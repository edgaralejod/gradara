'use client';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { dialogSize } from '@/lib/gradara/pane-sizes';
import { RESET_LAYOUT_EVENT } from './resizable-columns';
import { useStored } from './use-stored';

const MIN_WIDTH = 320,
  MIN_HEIGHT = 220,
  MARGIN = 32;

function parse(raw: string | null): [number, number] | null {
  try {
    const value: unknown = JSON.parse(raw ?? 'null');
    if (
      Array.isArray(value) &&
      value.length === 2 &&
      value.every((n) => typeof n === 'number' && Number.isFinite(n) && n > 0)
    )
      return value as [number, number];
  } catch {
    /* A corrupt entry means the dialog's own size. */
  }
  return null;
}

type Side = { x: 'far' | 'near' | null; y: 'far' | 'near' | null };
const handles: { name: string; side: Side }[] = [
  { name: 'right', side: { x: 'far', y: null } },
  { name: 'left', side: { x: 'near', y: null } },
  { name: 'bottom', side: { x: null, y: 'far' } },
  { name: 'top', side: { x: null, y: 'near' } },
  { name: 'bottom-right', side: { x: 'far', y: 'far' } },
  { name: 'bottom-left', side: { x: 'near', y: 'far' } },
  { name: 'top-right', side: { x: 'far', y: 'near' } },
  { name: 'top-left', side: { x: 'near', y: 'near' } },
];

/**
 * A dialog whose edges and corners can be dragged. It stays centred, so dragging one
 * edge moves the opposite edge too, and the size is remembered per dialog in this
 * browser. Without a key the dialog keeps the size its content gives it.
 */
export function useDialogResize(key: string | undefined) {
  const [raw, write] = useStored(`gradara:dialog:${key ?? 'none'}`);
  const custom = useMemo(() => (key ? parse(raw) : null), [raw, key]);
  const [live, setLive] = useState<[number, number] | null>(null);
  // A callback ref keeps the element in state, so rendering never reads a ref object.
  const [node, setNode] = useState<HTMLElement | null>(null);
  const size = live ?? custom;
  const reset = useCallback(() => write(null), [write]);
  useEffect(() => {
    if (!key) return;
    window.addEventListener(RESET_LAYOUT_EVENT, reset);
    return () => window.removeEventListener(RESET_LAYOUT_EVENT, reset);
  }, [key, reset]);

  const begin = (side: Side, e: React.PointerEvent<HTMLElement>) => {
    if (!node) return;
    e.preventDefault();
    const target = e.currentTarget;
    target.setPointerCapture(e.pointerId);
    const box = node.getBoundingClientRect();
    const start = { x: e.clientX, y: e.clientY, w: box.width, h: box.height };
    let latest: [number, number] = [start.w, start.h];
    let frame = 0;
    const move = (m: PointerEvent) => {
      latest = [
        side.x
          ? dialogSize(start.w, m.clientX - start.x, side.x, MIN_WIDTH, window.innerWidth - MARGIN)
          : start.w,
        side.y
          ? dialogSize(start.h, m.clientY - start.y, side.y, MIN_HEIGHT, window.innerHeight - MARGIN)
          : start.h,
      ];
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => setLive(latest));
    };
    const up = () => {
      cancelAnimationFrame(frame);
      target.removeEventListener('pointermove', move);
      target.removeEventListener('pointerup', up);
      target.removeEventListener('pointercancel', up);
      write(JSON.stringify(latest));
      setLive(null);
    };
    target.addEventListener('pointermove', move);
    target.addEventListener('pointerup', up);
    target.addEventListener('pointercancel', up);
  };

  const nudge = (e: React.KeyboardEvent<HTMLElement>) => {
    const step = (e.shiftKey ? 40 : 10) * 2;
    const grow = { ArrowRight: [step, 0], ArrowLeft: [-step, 0], ArrowDown: [0, step], ArrowUp: [0, -step] }[e.key];
    if (!node || !grow) return;
    e.preventDefault();
    e.stopPropagation();
    const box = node.getBoundingClientRect();
    write(
      JSON.stringify([
        dialogSize(box.width, grow[0] / 2, 'far', MIN_WIDTH, window.innerWidth - MARGIN),
        dialogSize(box.height, grow[1] / 2, 'far', MIN_HEIGHT, window.innerHeight - MARGIN),
      ]),
    );
  };

  return {
    attach: setNode,
    enabled: !!key,
    sized: !!size,
    className: size ? 'dialog-sized' : '',
    style: size
      ? { width: size[0], height: size[1], maxWidth: `calc(100vw - ${MARGIN}px)`, maxHeight: `calc(100vh - ${MARGIN}px)` }
      : undefined,
    handles: !key ? null : (
      <>
        {handles.map(({ name, side }) => {
          const corner = name === 'bottom-right';
          return (
            <button
              key={name}
              type="button"
              className={`dialog-resizer is-${name}`}
              tabIndex={corner ? 0 : -1}
              aria-label={
                corner
                  ? 'Resize this window: arrow keys, or double-click to reset'
                  : `Resize this window from its ${name} edge`
              }
              onPointerDown={(e) => begin(side, e)}
              onKeyDown={corner ? nudge : undefined}
              onDoubleClick={reset}
            />
          );
        })}
      </>
    ),
  };
}
