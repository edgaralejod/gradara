'use client';
import { useRef, useState } from 'react';
import {
  BaseEdge,
  Position,
  useReactFlow,
  type ConnectionLineComponentProps,
  type EdgeProps,
} from '@xyflow/react';
import {
  pointsToPath,
  rubberBandPath,
  rubberBandPoints,
  wirePath,
} from '@/lib/gradara/routing';
import { parsePath, type Pt } from '@/lib/gradara/wires';
import { TAP_HANDLE } from '@/lib/gradara/net';

function waypointPath(source: Pt, target: Pt, points: Pt[]): string {
  const route = [source, ...points, target];
  let path = `M ${source.x} ${source.y}`;
  for (let i = 1; i < route.length; i++) {
    const a = route[i - 1],
      b = route[i];
    if (a.x !== b.x && a.y !== b.y) {
      path += ` L ${b.x} ${a.y}`;
    }
    path += ` L ${b.x} ${b.y}`;
  }
  return path;
}

type WireData = {
  waypoints?: Pt[];
  junctions?: Pt[];
  railY?: number;
  flow?: 'signal' | 'physical';
  onVerticesCommit?: (points: Pt[]) => void;
  onBranchStart?: (point: Pt) => void;
  onInsertVertex?: (point: Pt) => void;
  onSelect?: () => void;
};

export default function SignalEdge(props: EdgeProps) {
  const data = (props.data ?? {}) as WireData;
  const flow = useReactFlow();
  const source = { x: props.sourceX, y: props.sourceY };
  const target = { x: props.targetX, y: props.targetY };
  const [live, setLive] = useState<Pt[] | null>(null);
  const liveRef = useRef<Pt[] | null>(null);
  const drag = useRef<{ index: number } | null>(null);
  const press = useRef<{ x: number; y: number } | null>(null);
  const points = live ?? data.waypoints;
  const setDraft = (pts: Pt[] | null) => {
    liveRef.current = pts;
    setLive(pts);
  };
  const auto = wirePath({
    sourceX: props.sourceX,
    sourceY: props.sourceY,
    targetX: props.targetX,
    targetY: props.targetY,
    sourcePosition: props.sourcePosition,
    targetPosition: props.targetPosition,
    railY: data.railY,
    flow: data.flow,
  });
  const path = points?.length ? waypointPath(source, target, points) : auto;
  const corners = points?.length
    ? points
    : parsePath(auto).slice(1, -1);
  const junctions = data.junctions;

  function pointerToFlow(e: { clientX: number; clientY: number }) {
    return flow.screenToFlowPosition({ x: e.clientX, y: e.clientY });
  }

  return (
    <>
      <BaseEdge
        id={props.id}
        path={path}
        markerEnd={props.markerEnd}
        style={{
          ...props.style,
          strokeWidth: props.selected ? 2.2 : (props.style?.strokeWidth ?? 1.4),
        }}
        interactionWidth={22}
      />
      <path
        d={path}
        fill="none"
        stroke="transparent"
        strokeWidth={22}
        className="wire-hit nodrag nopan"
        onPointerDown={(e) => {
          if (e.button !== 0) return;
          press.current = { x: e.clientX, y: e.clientY };
        }}
        onPointerMove={(e) => {
          if (!press.current || drag.current) return;
          if (
            Math.hypot(e.clientX - press.current.x, e.clientY - press.current.y) >
            6
          ) {
            press.current = null;
            data.onBranchStart?.(pointerToFlow(e));
          }
        }}
        onPointerUp={() => {
          if (press.current) data.onSelect?.();
          press.current = null;
        }}
        onDoubleClick={(e) => {
          e.stopPropagation();
          data.onInsertVertex?.(pointerToFlow(e));
        }}
      />
      {junctions?.map((p, i) => (
        <circle
          key={`j${i}`}
          cx={p.x}
          cy={p.y}
          r={3.2}
          fill={props.style?.stroke ?? '#336184'}
          className="wire-node"
        />
      ))}
      {props.selected &&
        corners.map((p, i) => (
          <rect
            key={`v${i}`}
            x={p.x - 3.5}
            y={p.y - 3.5}
            width={7}
            height={7}
            className="wire-vertex nodrag nopan"
            fill="#fff"
            stroke={props.style?.stroke ?? '#2477b5'}
            strokeWidth={1.4}
            onPointerDown={(e) => {
              e.stopPropagation();
              e.preventDefault();
              drag.current = { index: i };
              (e.target as SVGRectElement).setPointerCapture(e.pointerId);
              const start = points?.length
                ? [...points]
                : parsePath(auto).slice(1, -1);
              setDraft(start);
            }}
            onPointerMove={(e) => {
              if (!drag.current) return;
              const at = pointerToFlow(e);
              const prev = liveRef.current;
              if (!prev) return;
              const next = prev.slice();
              next[drag.current.index] = {
                x: Math.round(at.x / 10) * 10,
                y: Math.round(at.y / 10) * 10,
              };
              setDraft(next);
            }}
            onPointerUp={(e) => {
              if (!drag.current) return;
              (e.target as SVGRectElement).releasePointerCapture(e.pointerId);
              drag.current = null;
              const pts = liveRef.current;
              setDraft(null);
              if (pts) data.onVerticesCommit?.(pts);
            }}
          />
        ))}
    </>
  );
}

function leaveToward(
  fromX: number,
  fromY: number,
  toX: number,
  toY: number,
  fallback: Position,
) {
  const dx = toX - fromX,
    dy = toY - fromY;
  if (Math.abs(dx) < 6 && Math.abs(dy) < 6) return fallback;
  if (Math.abs(dx) >= Math.abs(dy))
    return dx >= 0 ? Position.Right : Position.Left;
  return dy >= 0 ? Position.Bottom : Position.Top;
}

export function WiringPreview({
  fromX,
  fromY,
  toX,
  toY,
  fromPosition,
  fromHandle,
}: ConnectionLineComponentProps) {
  const exit =
    fromHandle?.id === TAP_HANDLE
      ? leaveToward(fromX, fromY, toX, toY, fromPosition)
      : fromPosition;
  const path = rubberBandPath(
    { x: fromX, y: fromY },
    { x: toX, y: toY },
    exit,
  );
  return (
    <g>
      <path
        d={path}
        fill="none"
        stroke="#336184"
        strokeWidth={1.4}
        className="react-flow__connection-path"
      />
    </g>
  );
}

export function BranchPreview({
  from,
  to,
  exit,
  start,
  corners = [],
}: {
  from: Pt;
  to: Pt;
  exit?: Position;
  start?: Pt;
  corners?: Pt[];
}) {
  const tail = rubberBandPoints(
    from,
    to,
    exit ?? leaveToward(from.x, from.y, to.x, to.y, Position.Right),
  );
  const head = start ? [start, ...corners] : corners;
  const last = head.at(-1);
  const rest =
    last && tail[0] && last.x === tail[0].x && last.y === tail[0].y
      ? tail.slice(1)
      : tail;
  const path = pointsToPath([...head, ...rest]);
  return (
    <svg
      className="branch-preview"
      style={{ overflow: 'visible', position: 'absolute', inset: 0, pointerEvents: 'none' }}
    >
      <path d={path} fill="none" stroke="#336184" strokeWidth={1.4} />
      <circle cx={from.x} cy={from.y} r={3.2} fill="#336184" />
    </svg>
  );
}
