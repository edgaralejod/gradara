'use client';
import { useEffect, useRef, useState } from 'react';
import { useReactFlow } from '@xyflow/react';
import type { Net, Project } from '@/lib/gradara/model';
import { netDisplayName } from '@/lib/gradara/names';
import {
  labelPosition,
  nearestLabelAnchor,
  type LabelAnchor,
} from '@/lib/gradara/net-label';

type Props = {
  project: Project;
  net: Net;
  selected: boolean;
  color: string;
  editing?: LabelAnchor;
  onEdit: (anchor?: LabelAnchor) => void;
  onName: (name: string, anchor?: LabelAnchor) => void;
  onCancel: () => void;
  onMove: (anchor?: LabelAnchor) => void;
  onSelect: () => void;
};

export default function NetLabel(props: Props) {
  const { project, net, editing } = props;
  const name = netDisplayName(project, net);
  const flow = useReactFlow();
  const drag = useRef<{
    pointer: number;
    from: { x: number; y: number };
    anchor?: LabelAnchor;
    moved: boolean;
  } | null>(null);
  const frame = useRef<number | null>(null);
  const button = useRef<HTMLButtonElement>(null);
  const [preview, setPreview] = useState<LabelAnchor>();
  useEffect(
    () => () => {
      if (frame.current !== null) cancelAnimationFrame(frame.current);
    },
    [],
  );
  const position = labelPosition(project, net, preview ?? editing ?? net.label);
  const release = () => {
    const g = drag.current;
    drag.current = null;
    if (g && button.current?.hasPointerCapture(g.pointer))
      button.current.releasePointerCapture(g.pointer);
    if (frame.current !== null) cancelAnimationFrame(frame.current);
    frame.current = null;
    setPreview(undefined);
  };
  const move = (event: React.PointerEvent) => {
    const g = drag.current;
    if (!g || g.pointer !== event.pointerId) return;
    if (Math.hypot(event.clientX - g.from.x, event.clientY - g.from.y) > 3)
      g.moved = true;
    if (!g.moved) return;
    g.anchor = nearestLabelAnchor(
      project,
      net,
      flow.screenToFlowPosition(
        { x: event.clientX, y: event.clientY },
        { snapToGrid: false },
      ),
    );
    if (frame.current === null)
      frame.current = requestAnimationFrame(() => {
        frame.current = null;
        if (drag.current) setPreview(drag.current.anchor);
      });
  };
  if (!position || (!editing && net.hidden)) return null;
  const style = {
    left: position.x,
    top: position.y,
    color: props.color,
    transform: position.horizontal
      ? 'translate(-50%, -50%)'
      : position.anchor.side === 1
        ? 'translate(-100%, -50%)'
        : 'translate(0, -50%)',
  };
  if (editing)
    return (
      <NetNameEditor
        key={`${net.id}:${name}`}
        value={name}
        style={style}
        onCommit={(name) => props.onName(name, editing)}
        onCancel={props.onCancel}
      />
    );
  return (
    <button
      ref={button}
      type="button"
      className={`net-label nodrag nopan ${props.selected ? 'is-selected' : ''} ${preview ? 'is-dragging' : ''}`}
      data-net-label={net.id}
      aria-label={`Net ${name}`}
      title={`${name} · ${net.id}\nDrag along the net · Double-click to rename · Home resets placement`}
      style={style}
      onPointerDown={(e) => {
        if (e.button !== 0) return;
        e.preventDefault();
        e.stopPropagation();
        e.currentTarget.focus({ preventScroll: true });
        drag.current = {
          pointer: e.pointerId,
          from: { x: e.clientX, y: e.clientY },
          anchor: position.anchor,
          moved: false,
        };
        e.currentTarget.setPointerCapture(e.pointerId);
        props.onSelect();
      }}
      onPointerMove={(e) => {
        if (drag.current) {
          e.stopPropagation();
          move(e);
        }
      }}
      onPointerUp={(e) => {
        const g = drag.current;
        if (!g || g.pointer !== e.pointerId) return;
        e.preventDefault();
        e.stopPropagation();
        move(e);
        const anchor = g.anchor,
          moved = g.moved;
        release();
        if (moved) props.onMove(anchor);
      }}
      onPointerCancel={release}
      onLostPointerCapture={() => {
        if (drag.current) release();
      }}
      onBlur={() => {
        if (drag.current) release();
      }}
      onClick={(e) => {
        e.stopPropagation();
      }}
      onDoubleClick={(e) => {
        e.stopPropagation();
        release();
        props.onEdit(position.anchor);
      }}
      onKeyDown={(e) => {
        if (e.key === 'Escape') {
          e.preventDefault();
          e.stopPropagation();
          release();
        }
        if (e.key === 'Enter' || e.key === 'F2') {
          e.preventDefault();
          e.stopPropagation();
          props.onEdit(position.anchor);
        }
        if (e.key === 'Home') {
          e.preventDefault();
          e.stopPropagation();
          props.onMove(undefined);
        }
        const delta: Record<string, [number, number]> = {
          ArrowUp: [0, -1],
          ArrowDown: [0, 1],
          ArrowLeft: [-1, 0],
          ArrowRight: [1, 0],
        };
        if (delta[e.key]) {
          e.preventDefault();
          e.stopPropagation();
          const [x, y] = delta[e.key];
          // Across the wire flips sides; along it moves the anchor by 4 (or 20) units.
          const across = position.horizontal ? y : x;
          props.onMove(
            across
              ? {
                  ...position.anchor,
                  side: (position.horizontal ? across > 0 : across < 0)
                    ? 1
                    : -1,
                }
              : nearestLabelAnchor(project, net, {
                  x: position.x + x * (e.shiftKey ? 20 : 4),
                  y: position.y + y * (e.shiftKey ? 20 : 4),
                }),
          );
        }
      }}
    >
      {net.logged && <span title="Logged to Data Inspector" aria-label="Logged signal">● </span>}{name}
    </button>
  );
}

function NetNameEditor({
  value,
  style,
  onCommit,
  onCancel,
}: {
  value: string;
  style: React.CSSProperties;
  onCommit: (value: string) => void;
  onCancel: () => void;
}) {
  const [draft, setDraft] = useState(value);
  const input = useRef<HTMLInputElement>(null),
    finished = useRef(false);
  useEffect(() => {
    input.current?.focus({ preventScroll: true });
    input.current?.select();
  }, []);
  const finish = (cancel = false) => {
    if (finished.current) return;
    finished.current = true;
    if (cancel || draft === value) onCancel();
    else onCommit(draft);
  };
  return (
    <input
      ref={input}
      className="net-label net-label-editor nodrag nopan"
      aria-label="Signal or net name"
      placeholder="Signal name"
      maxLength={120}
      style={{
        ...style,
        width: Math.min(300, Math.max(120, draft.length * 7 + 24)),
      }}
      value={draft}
      onChange={(e) => setDraft(e.target.value)}
      onPointerDown={(e) => e.stopPropagation()}
      onClick={(e) => e.stopPropagation()}
      onDoubleClick={(e) => e.stopPropagation()}
      onBlur={() => finish()}
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.key === 'Enter' || e.key === 'Escape') {
          e.preventDefault();
          finish(e.key === 'Escape');
        }
      }}
    />
  );
}
