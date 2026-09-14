'use client';
import { useContext, useEffect, useRef, useState } from 'react';
import { useReactFlow } from '@xyflow/react';
import type { Block } from '@/lib/gradara/model';
import { LabelEditingContext } from './label-editing-context';

type Offset = NonNullable<Block['labelOffset']>;
type Drag = {
  pointer: number;
  from: Offset;
  initial: Offset;
  current: Offset;
  moved: boolean;
};
const zero = { x: 0, y: 0 };

/** Local pointer preview; the document receives exactly one label-position edit on release. */
export default function BlockLabel({
  id,
  name,
  offset,
}: {
  id: string;
  name: string;
  offset?: Offset;
}) {
  const editing = useContext(LabelEditingContext),
    flow = useReactFlow();
  const element = useRef<HTMLButtonElement>(null),
    drag = useRef<Drag | null>(null),
    frame = useRef<number | null>(null);
  const [preview, setPreview] = useState<Offset | null>(null);
  useEffect(
    () => () => {
      if (frame.current !== null) cancelAnimationFrame(frame.current);
    },
    [],
  );
  const position = preview ?? offset ?? zero;
  const world = (event: React.PointerEvent) =>
    flow.screenToFlowPosition(
      { x: event.clientX, y: event.clientY },
      { snapToGrid: false },
    );
  const release = () => {
    const g = drag.current;
    drag.current = null;
    if (g && element.current?.hasPointerCapture(g.pointer))
      element.current.releasePointerCapture(g.pointer);
    if (frame.current !== null) cancelAnimationFrame(frame.current);
    frame.current = null;
    setPreview(null);
  };
  const update = (event: React.PointerEvent) => {
    const g = drag.current;
    if (!g || g.pointer !== event.pointerId) return;
    const at = world(event),
      zoom = flow.getZoom();
    if (Math.hypot(at.x - g.from.x, at.y - g.from.y) * zoom > 3) g.moved = true;
    if (!g.moved) return;
    const x = g.initial.x + at.x - g.from.x,
      y = g.initial.y + at.y - g.from.y;
    g.current = {
      x: Math.abs(x) * zoom <= 6 ? 0 : x,
      y: Math.abs(y) * zoom <= 6 ? 0 : y,
    };
    if (frame.current === null)
      frame.current = requestAnimationFrame(() => {
        frame.current = null;
        if (drag.current) setPreview({ ...drag.current.current });
      });
  };
  return (
    <button
      ref={element}
      className={`block-name nodrag nopan ${preview ? 'is-dragging' : ''}`}
      data-label-id={id}
      type="button"
      tabIndex={0}
      aria-label={`Move ${name} label`}
      title="Drag to move name · Double-click to reset · Arrow keys to nudge"
      style={{
        transform: `translate(calc(-50% + ${position.x}px), ${position.y}px)`,
      }}
      onPointerDown={(event) => {
        if (event.button !== 0 || !editing) return;
        event.preventDefault();
        event.stopPropagation();
        event.currentTarget.focus({ preventScroll: true });
        const initial = offset ?? zero;
        drag.current = {
          pointer: event.pointerId,
          from: world(event),
          initial,
          current: initial,
          moved: false,
        };
        event.currentTarget.setPointerCapture(event.pointerId);
        editing.onSelect(id);
      }}
      onPointerMove={(event) => {
        if (drag.current) {
          event.stopPropagation();
          update(event);
        }
      }}
      onPointerUp={(event) => {
        const g = drag.current;
        if (!g || g.pointer !== event.pointerId) return;
        event.preventDefault();
        event.stopPropagation();
        update(event);
        const next = g.current,
          moved = g.moved;
        release();
        if (moved) editing?.onMove(id, next);
      }}
      onPointerCancel={release}
      onLostPointerCapture={() => {
        if (drag.current) release();
      }}
      onClick={(event) => {
        event.preventDefault();
        event.stopPropagation();
      }}
      onDoubleClick={(event) => {
        event.preventDefault();
        event.stopPropagation();
        release();
        editing?.onMove(id, undefined);
      }}
      onKeyDown={(event) => {
        const key = event.key;
        if (
          drag.current &&
          (key === 'Escape' ||
            ((event.metaKey || event.ctrlKey) && key.toLowerCase() === 'z'))
        ) {
          event.preventDefault();
          event.stopPropagation();
          release();
          return;
        }
        const delta: Record<string, Offset> = {
          ArrowLeft: { x: -1, y: 0 },
          ArrowRight: { x: 1, y: 0 },
          ArrowUp: { x: 0, y: -1 },
          ArrowDown: { x: 0, y: 1 },
        };
        if (delta[key]) {
          event.preventDefault();
          event.stopPropagation();
          const step = event.shiftKey ? 10 : 1;
          editing?.onMove(id, {
            x: position.x + delta[key].x * step,
            y: position.y + delta[key].y * step,
          });
        }
        if (key === 'Home') {
          event.preventDefault();
          event.stopPropagation();
          editing?.onMove(id, undefined);
        }
      }}
    >
      {name}
    </button>
  );
}
