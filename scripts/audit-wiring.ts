/** Read-only diagnostic fixtures for the September 2026 wiring audit.
 * Run: node_modules/.bin/tsx scripts/audit-wiring.ts
 * These use in-memory projects only; no workspace files or server calls.
 */
import {
  initialProject,
  library,
  type Block,
  type Project,
} from '../lib/gradara/model';
import { blockSize } from '../lib/gradara/canvas';
import { NetSession } from '../lib/gradara/net-session';
import { flattenWires } from '../lib/gradara/net';
import { polylineOfWire } from '../lib/gradara/net-draw';
import { normalizeJunctions } from '../lib/gradara/net-layout';
import { duplicateBlocks, semanticSignature } from '../lib/gradara/project';
import { layoutSelection } from '../lib/gradara/selection';
import { resetWireRoute } from '../lib/gradara/wires';

function block(kind: string, id: string, x: number, y: number): Block {
  return {
    id,
    definition: structuredClone(library.find((d) => d.kind === kind)!),
    position: { x, y },
  };
}

const session = new NetSession({
  ...initialProject(),
  blocks: [
    block('step', 'source', 0, 0),
    block('gain', 'gain', 300, -4),
    block('scope', 'sink', 300, 172),
  ],
  wires: [],
  junctions: [],
});
session.pressPort('source', 'y');
session.release({ x: 300, y: 28 });
session.pressPort('sink', 'u');
session.release({ x: 140, y: 28 });
const project = normalizeJunctions(session.project);
const ids = project.blocks.map((b) => b.id);
const copy = duplicateBlocks(project, ids);
const cloned = new Set(copy.ids);
const copiedConnections = flattenWires(copy.project).filter(
  (w) => cloned.has(w.source) && cloned.has(w.target),
);

const delta = { x: 40, y: 60 };
const moved = normalizeJunctions(
  layoutSelection(
    project,
    project.blocks.map((b) => ({
      id: b.id,
      position: { x: b.position.x + delta.x, y: b.position.y + delta.y },
      size: blockSize(b),
    })),
  ),
);
const expectedJunctions = project.junctions!.map((j) => ({
  ...j.position,
  x: j.position.x + delta.x,
  y: j.position.y + delta.y,
}));
const actualJunctions = moved.junctions!.map((j) => j.position);
const geometryMatches = project.wires.every(
  (w) =>
    JSON.stringify(polylineOfWire(moved, w.id)) ===
    JSON.stringify(
      polylineOfWire(project, w.id).map((p) => ({
        x: p.x + delta.x,
        y: p.y + delta.y,
      })),
    ),
);

const obstacle: Project = {
  ...initialProject(),
  blocks: [
    block('step', 'source', 0, 0),
    block('gain', 'gain', 300, -4),
    block('scope', 'obstacle', 140, 0),
  ],
  wires: [
    {
      id: 'wire',
      source: 'source',
      sourceHandle: 'y',
      target: 'gain',
      targetHandle: 'u',
    },
  ],
  junctions: [],
};
const route = polylineOfWire(resetWireRoute(obstacle, 'wire'), 'wire');
const box = { x: 140, y: 0, width: 92, height: 64 };
const crossesBlock = route.some((a, i) => {
  const b = route[i + 1];
  if (!b) return false;
  if (a.y === b.y)
    return (
      a.y > box.y &&
      a.y < box.y + box.height &&
      Math.max(a.x, b.x) > box.x &&
      Math.min(a.x, b.x) < box.x + box.width
    );
  return (
    a.x > box.x &&
    a.x < box.x + box.width &&
    Math.max(a.y, b.y) > box.y &&
    Math.min(a.y, b.y) < box.y + box.height
  );
});

console.log(
  JSON.stringify(
    {
      branchedSelectionDuplication: {
        passes: copiedConnections.length === flattenWires(project).length,
        selectedBlocks: ids.length,
        originalConnections: flattenWires(project).length,
        clonedBlocks: copy.ids.length,
        copiedConnections: copiedConnections.length,
        originalJunctions: project.junctions!.length,
        copiedJunctions:
          copy.project.junctions!.length - project.junctions!.length,
      },
      wholeSelectionTranslation: {
        passes: geometryMatches,
        delta,
        expectedJunctions,
        actualJunctions,
        connectivityPreserved:
          semanticSignature(project) === semanticSignature(moved),
      },
      obstacleAwareAutoRoute: { passes: !crossesBlock, route, crossesBlock },
    },
    null,
    2,
  ),
);
