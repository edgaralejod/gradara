'use client';
import { useRef } from 'react';
import { ViewportPortal, useReactFlow } from '@xyflow/react';
import { domainColors } from '@/lib/gradara/model';
import { pointsToPath } from '@/lib/gradara/routing';
import type { NetSession } from '@/lib/gradara/net-session';

export default function NetLayer({
  session,
  onChange,
  onCommit,
}: {
  session: NetSession;
  onChange: () => void;
  onCommit: () => void;
}) {
  const flow = useReactFlow();
  const drag = useRef<string | null>(null);
  const preview = session.preview();
  return (
    <ViewportPortal>
      <svg
        className="net-layer"
        style={{
          position: 'absolute',
          overflow: 'visible',
          inset: 0,
          pointerEvents: 'none',
        }}
      >
        {session.guides.map((g, i) =>
          g.axis === 'y' ? (
            <line
              key={`g${i}`}
              x1={-4000}
              x2={8000}
              y1={g.value}
              y2={g.value}
              className="net-guide"
            />
          ) : (
            <line
              key={`g${i}`}
              y1={-4000}
              y2={8000}
              x1={g.value}
              x2={g.value}
              className="net-guide"
            />
          ),
        )}
        {preview.length > 1 && (
          <path d={pointsToPath(preview)} className="net-live" fill="none" />
        )}
        {(session.project.junctions ?? []).map((j) => (
          <circle
            key={j.id}
            cx={j.position.x}
            cy={j.position.y}
            r={5}
            className="net-junction"
            style={{
              fill: domainColors[j.domain],
              pointerEvents: 'auto',
              cursor: 'grab',
            }}
            onPointerDown={(e) => {
              e.stopPropagation();
              (e.target as SVGCircleElement).setPointerCapture(e.pointerId);
              drag.current = j.id;
            }}
            onPointerMove={(e) => {
              if (drag.current !== j.id) return;
              const p = flow.screenToFlowPosition({
                x: e.clientX,
                y: e.clientY,
              });
              session.moveJunction(j.id, p.x, p.y);
              onChange();
            }}
            onPointerUp={(e) => {
              if (drag.current !== j.id) return;
              drag.current = null;
              (e.target as SVGCircleElement).releasePointerCapture(e.pointerId);
              onCommit();
            }}
          />
        ))}
      </svg>
    </ViewportPortal>
  );
}
