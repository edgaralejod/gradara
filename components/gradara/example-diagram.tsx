/**
 * A static drawing of a model's top sheet: block faces from the workbench's own
 * renderer, wires along the routes the canvas draws, junction dots, and instance
 * names. Used for the example pictures on gradara.app (scripts/build-block-docs.tsx)
 * to review generated examples (scripts/build-block-examples.ts --review), and for
 * the previews in the workbench's example browser (example-gallery.tsx).
 */
import type { CSSProperties } from 'react';
import { BlockPreview } from './block-face';
import { domainColors, type Domain, type Project } from '@/lib/gradara/model';
import { polylineOfWire } from '@/lib/gradara/net-draw';
import { bodyOf, labelOf } from '@/lib/gradara/router';
import { busWireIds } from '@/lib/gradara/buses';
import { portPoint } from '@/lib/gradara/ports';

const PAD = 24;

function wireDomain(project: Project, wireId: string): Domain {
  const wire = project.wires.find((w) => w.id === wireId)!;
  for (const [id, handle] of [
    [wire.source, wire.sourceHandle],
    [wire.target, wire.targetHandle],
  ]) {
    const port = project.blocks
      .find((b) => b.id === id)
      ?.definition.ports.find((p) => p.id === handle);
    if (port) return port.domain;
  }
  const junction = project.junctions?.find(
    (j) => j.id === wire.source || j.id === wire.target,
  );
  return (junction?.domain as Domain) ?? 'signal';
}

/** The sheet's drawn extent: bodies, names, wires, and junctions. */
export function sheetBounds(project: Project) {
  const xs: number[] = [],
    ys: number[] = [];
  for (const b of project.blocks) {
    for (const r of [bodyOf(b), labelOf(b)]) {
      xs.push(r.x, r.x + r.width);
      ys.push(r.y, r.y + r.height);
    }
  }
  for (const w of project.wires)
    for (const p of polylineOfWire(project, w.id)) {
      xs.push(p.x);
      ys.push(p.y);
    }
  const x = Math.min(...xs) - PAD,
    y = Math.min(...ys) - PAD;
  return {
    x,
    y,
    width: Math.max(...xs) + PAD - x,
    height: Math.max(...ys) + PAD - y,
  };
}

export function ExampleDiagram({ project }: { project: Project }) {
  const box = sheetBounds(project);
  const buses = busWireIds(project);
  return (
    <span
      className="diagram"
      style={{ width: box.width, height: box.height } as CSSProperties}
    >
      <svg
        className="diagram-wires"
        viewBox={`${box.x} ${box.y} ${box.width} ${box.height}`}
        width={box.width}
        height={box.height}
        aria-hidden="true"
      >
        {project.wires.map((w) => {
          const points = polylineOfWire(project, w.id);
          return (
            <polyline
              key={w.id}
              className={buses.has(w.id) ? 'is-bus' : undefined}
              points={points.map((p) => `${p.x},${p.y}`).join(' ')}
              stroke={domainColors[wireDomain(project, w.id)]}
            />
          );
        })}
        {project.blocks.flatMap((b) =>
          (b.terminated ?? []).map((portId) => {
            const at = portPoint(b, portId);
            if (!at) return null;
            const turn = { right: 0, bottom: 90, left: 180, top: 270 }[at.side];
            return (
              <path
                key={`${b.id}.${portId}`}
                className="diagram-terminator"
                transform={`translate(${at.x} ${at.y}) rotate(${turn})`}
                d="M0 0H11M11 -6.5V6.5M15 -3.5V3.5"
              />
            );
          }),
        )}
        {(project.junctions ?? []).map((j) => (
          <circle
            key={j.id}
            cx={j.position.x}
            cy={j.position.y}
            r={3.5}
            fill={domainColors[(j.domain as Domain) ?? 'signal']}
          />
        ))}
      </svg>
      {project.blocks.map((b) => {
        const body = bodyOf(b),
          label = labelOf(b);
        return (
          <span key={b.id}>
            <span
              className="diagram-block"
              style={{
                left: body.x - box.x,
                top: body.y - box.y,
                width: body.width,
                height: body.height,
              }}
            >
              <span
                className="diagram-turn"
                data-turn={b.rotation || undefined}
                style={
                  {
                    width:
                      b.rotation && b.rotation % 180 ? body.height : body.width,
                    height:
                      b.rotation && b.rotation % 180 ? body.width : body.height,
                    transform: `translate(-50%, -50%) rotate(${b.rotation ?? 0}deg)`,
                  } as CSSProperties
                }
              >
                <BlockPreview definition={b.definition} />
              </span>
            </span>
            <span
              className="diagram-name"
              style={{
                left: label.x - box.x + label.width / 2,
                top: label.y - box.y,
              }}
            >
              {b.definition.name}
            </span>
          </span>
        );
      })}
    </span>
  );
}
