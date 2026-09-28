'use client';
import { createContext, memo, useContext, useMemo } from 'react';
import { blockSize } from '@/lib/gradara/canvas';
import {
  domainColors,
  type Project,
  type SubsystemDefinition,
} from '@/lib/gradara/model';
import { routedPolylines } from '@/lib/gradara/net-draw';

/** Looks up a subsystem's inside, for the hover preview on its block. */
export const SubsystemLookupContext = createContext<
  ((ref: string) => SubsystemDefinition | undefined) | null
>(null);

const W = 240;
const H = 150;
const PAD = 10;

/** A small live drawing of a subsystem's inside: blocks as outlines, wires as lines. */
export const SubsystemPreview = memo(function SubsystemPreview({
  subsystemRef,
}: {
  subsystemRef: string;
}) {
  const lookup = useContext(SubsystemLookupContext);
  const sub = lookup?.(subsystemRef);
  const drawing = useMemo(() => {
    if (!sub?.blocks.length) return null;
    const sheet = {
      version: 2,
      name: sub.name,
      duration: 1,
      revision: 0,
      blocks: sub.blocks,
      wires: sub.wires,
      junctions: sub.junctions ?? [],
      nets: sub.nets,
    } as Project;
    const boxes = sub.blocks.map((b) => ({ b, size: blockSize(b) }));
    const lines = [...routedPolylines(sheet).entries()];
    let x0 = Infinity,
      y0 = Infinity,
      x1 = -Infinity,
      y1 = -Infinity;
    for (const { b, size } of boxes) {
      x0 = Math.min(x0, b.position.x);
      y0 = Math.min(y0, b.position.y);
      x1 = Math.max(x1, b.position.x + size.width);
      y1 = Math.max(y1, b.position.y + size.height);
    }
    for (const [, pts] of lines)
      for (const p of pts) {
        x0 = Math.min(x0, p.x);
        y0 = Math.min(y0, p.y);
        x1 = Math.max(x1, p.x);
        y1 = Math.max(y1, p.y);
      }
    const scale = Math.min(
      (W - 2 * PAD) / (x1 - x0 || 1),
      (H - 2 * PAD) / (y1 - y0 || 1),
      0.6,
    );
    const ox = PAD + (W - 2 * PAD - (x1 - x0) * scale) / 2 - x0 * scale;
    const oy = PAD + (H - 2 * PAD - (y1 - y0) * scale) / 2 - y0 * scale;
    const wireColor = (id: string) => {
      const w = sub.wires.find((w) => w.id === id);
      const block = w && sub.blocks.find((b) => b.id === w.source);
      const port = block?.definition.ports.find(
        (p) => p.id === w!.sourceHandle,
      );
      return port ? domainColors[port.domain] : '#8b9aa6';
    };
    return { boxes, lines, scale, ox, oy, wireColor };
  }, [sub]);
  if (!sub) return null;
  return (
    <div className="subsystem-preview" aria-hidden="true">
      <div className="subsystem-preview-title">
        {sub.name} · {sub.blocks.length} blocks
      </div>
      {drawing ? (
        <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`}>
          {drawing.lines.map(([id, pts]) => (
            <polyline
              key={id}
              points={pts
                .map(
                  (p) =>
                    `${p.x * drawing.scale + drawing.ox},${p.y * drawing.scale + drawing.oy}`,
                )
                .join(' ')}
              fill="none"
              stroke={drawing.wireColor(id)}
              strokeWidth={1}
            />
          ))}
          {drawing.boxes.map(({ b, size }) => (
            <rect
              key={b.id}
              x={b.position.x * drawing.scale + drawing.ox}
              y={b.position.y * drawing.scale + drawing.oy}
              width={size.width * drawing.scale}
              height={size.height * drawing.scale}
              rx={
                b.definition.boundary ? (size.height * drawing.scale) / 2 : 1.5
              }
              fill="white"
              stroke={domainColors[b.definition.domain]}
              strokeWidth={1}
            />
          ))}
        </svg>
      ) : (
        <p>Empty</p>
      )}
    </div>
  );
});

/**
 * The inside of a subsystem drawn small on its own block: a window onto the
 * diagram it holds. Pills and blocks are outlines in their domain colors; wires are
 * hairlines. Returns null when there is nothing inside to show (or no lookup, as in
 * the library), so the caller can draw its own glyph.
 */
export const SubsystemThumbnail = memo(function SubsystemThumbnail({
  subsystemRef,
}: {
  subsystemRef: string;
}) {
  const lookup = useContext(SubsystemLookupContext);
  const sub = lookup?.(subsystemRef);
  const drawing = useMemo(() => {
    const inner = sub?.blocks.filter((b) => !b.definition.boundary) ?? [];
    if (!sub || !inner.length) return null;
    const sheet = {
      version: 2,
      name: sub.name,
      duration: 1,
      revision: 0,
      blocks: sub.blocks,
      wires: sub.wires,
      junctions: sub.junctions ?? [],
      nets: sub.nets,
    } as Project;
    const boxes = sub.blocks.map((b) => ({ b, size: blockSize(b) }));
    const lines = [...routedPolylines(sheet).entries()];
    let x0 = Infinity,
      y0 = Infinity,
      x1 = -Infinity,
      y1 = -Infinity;
    for (const { b, size } of boxes) {
      x0 = Math.min(x0, b.position.x);
      y0 = Math.min(y0, b.position.y);
      x1 = Math.max(x1, b.position.x + size.width);
      y1 = Math.max(y1, b.position.y + size.height);
    }
    const color = (id: string) => {
      const w = sub.wires.find((w) => w.id === id);
      const block = w && sub.blocks.find((b) => b.id === w.source);
      const port = block?.definition.ports.find((p) => p.id === w!.sourceHandle);
      return port ? domainColors[port.domain] : '#8b9aa6';
    };
    const pad = Math.max(x1 - x0, y1 - y0) * 0.04;
    return {
      boxes,
      lines: lines.map(([id, pts]) => ({
        id,
        points: pts.map((p) => `${p.x},${p.y}`).join(' '),
        color: color(id),
      })),
      viewBox: `${x0 - pad} ${y0 - pad} ${x1 - x0 + 2 * pad} ${y1 - y0 + 2 * pad}`,
    };
  }, [sub]);
  if (!drawing) return null;
  return (
    <svg
      className="subsystem-thumb"
      viewBox={drawing.viewBox}
      preserveAspectRatio="xMidYMid meet"
    >
      {drawing.lines.map((l) => (
        <polyline key={l.id} points={l.points} stroke={l.color} />
      ))}
      {drawing.boxes.map(({ b, size }) => (
        <rect
          key={b.id}
          x={b.position.x}
          y={b.position.y}
          width={size.width}
          height={size.height}
          rx={b.definition.boundary ? size.height / 2 : 3}
          stroke={domainColors[b.definition.ports[0]?.domain ?? b.definition.domain]}
        />
      ))}
    </svg>
  );
});
