/**
 * Deterministic house-style placement for blocks that an agent adds.
 *
 * Agents decide what connects to what; they never choose coordinates. This
 * module places new blocks the way the curated templates are drawn: ports on
 * a shared line where a wire runs straight, signal flow left to right,
 * feedback and measurement paths on a row below, references directly under
 * their terminal, and nothing overlapping a block or its name. Blocks that
 * already exist never move.
 */
import { blockSize } from './canvas';
import { defaultBlockSize, snapBlockPosition } from './block-design';
import type { Block, Port, Project, Wire } from './model';
import {
  portPoint,
  portSide,
  positionForPortAt,
  sideToPosition,
  type Side,
} from './ports';
import { routeBetween, type Pt } from './routing';

/** Port-to-port distance for a straight connection; matches the curated templates. */
export const LAYOUT_GAP = 96;
/** Clearance kept around every block; the bottom also holds the instance name. */
const MARGIN = 20;
const NAME_SPACE = 32;
/** Layout step: three sheet-grid units, so laid-out blocks stay on the grid. */
const GRID = 24;

type Rect = { x: number; y: number; width: number; height: number };

const OUTWARD: Record<Side, Pt> = {
  left: { x: -1, y: 0 },
  right: { x: 1, y: 0 },
  top: { x: 0, y: -1 },
  bottom: { x: 0, y: 1 },
};

function rectOf(block: Block): Rect {
  const size = blockSize(block);
  return { x: block.position.x, y: block.position.y, ...size };
}

/** The area a block claims: its body, a margin, and its name underneath. */
function claimOf(block: Block): Rect {
  const r = rectOf(block);
  return {
    x: r.x - MARGIN,
    y: r.y - MARGIN,
    width: r.width + 2 * MARGIN,
    height: r.height + 2 * MARGIN + NAME_SPACE,
  };
}

/** Where the instance name is drawn: centered under the body. */
function nameOf(block: Block): Rect {
  const r = rectOf(block);
  const width = Math.max(
    r.width,
    Math.min(240, block.definition.name.length * 8),
  );
  return {
    x: r.x + r.width / 2 - width / 2,
    y: r.y + r.height + 4,
    width,
    height: 22,
  };
}

const overlaps = (a: Rect, b: Rect) =>
  a.x < b.x + b.width &&
  b.x < a.x + a.width &&
  a.y < b.y + b.height &&
  b.y < a.y + a.height;

function segmentHits(a: Pt, b: Pt, r: Rect) {
  // Orthogonal segments only; shrink the body so a wire touching its own port does not count.
  const inset = 2;
  const x0 = r.x + inset,
    x1 = r.x + r.width - inset,
    y0 = r.y + inset,
    y1 = r.y + r.height - inset;
  if (a.y === b.y) {
    const [lo, hi] = a.x < b.x ? [a.x, b.x] : [b.x, a.x];
    return a.y > y0 && a.y < y1 && hi > x0 && lo < x1;
  }
  const [lo, hi] = a.y < b.y ? [a.y, b.y] : [b.y, a.y];
  return a.x > x0 && a.x < x1 && hi > y0 && lo < y1;
}

function portOf(block: Block, id: string): Port | undefined {
  return block.definition.ports.find((p) => p.id === id);
}

/** The orthogonal route the canvas would draw for a wire with no saved waypoints. */
export function defaultRoute(project: Project, wire: Wire): Pt[] | undefined {
  const a = project.blocks.find((b) => b.id === wire.source);
  const b = project.blocks.find((x) => x.id === wire.target);
  if (!a || !b) return undefined;
  const from = portPoint(a, wire.sourceHandle);
  const to = portPoint(b, wire.targetHandle);
  if (!from || !to) return undefined;
  return routeBetween(
    from,
    to,
    sideToPosition(from.side),
    sideToPosition(to.side),
  );
}

type Scored = { position: Block['position']; cost: number };

function crosses(a: Pt, b: Pt, c: Pt, d: Pt) {
  const h1 = a.y === b.y,
    h2 = c.y === d.y;
  if (h1 === h2) return false;
  const [hA, hB, vA, vB] = h1 ? [a, b, c, d] : [c, d, a, b];
  const x = vA.x,
    y = hA.y;
  const within = (v: number, p: number, q: number) =>
    v > Math.min(p, q) && v < Math.max(p, q);
  return within(x, hA.x, hB.x) && within(y, vA.y, vB.y);
}

/** Routes of wires between placed blocks, as drawn (saved waypoints or the default route). */
function placedRoutes(project: Project, placed: Set<string>): Pt[][] {
  const routes: Pt[][] = [];
  for (const wire of project.wires) {
    if (!placed.has(wire.source) || !placed.has(wire.target)) continue;
    if (wire.waypoints?.length) {
      const a = project.blocks.find((b) => b.id === wire.source)!;
      const b = project.blocks.find((x) => x.id === wire.target)!;
      const from = portPoint(a, wire.sourceHandle),
        to = portPoint(b, wire.targetHandle);
      if (from && to) routes.push([from, ...wire.waypoints, to]);
    } else {
      const route = defaultRoute(project, wire);
      if (route) routes.push(route);
    }
  }
  return routes;
}

/** Cost of the wires between `block` and blocks already placed, as the canvas would draw them. */
function wireCost(
  project: Project,
  block: Block,
  placed: Set<string>,
  drawn: Pt[][] = [],
) {
  let cost = 0;
  const bodies = project.blocks.filter(
    (b) => placed.has(b.id) || b.id === block.id,
  );
  for (const wire of project.wires) {
    const mine = wire.source === block.id || wire.target === block.id;
    const other = wire.source === block.id ? wire.target : wire.source;
    if (!mine || other === block.id || !placed.has(other)) continue;
    const route = defaultRoute(project, wire);
    if (!route) continue;
    cost += 30 * Math.max(0, route.length - 2);
    for (let i = 1; i < route.length; i++) {
      const a = route[i - 1],
        b = route[i];
      cost += (Math.abs(a.x - b.x) + Math.abs(a.y - b.y)) / 4;
      for (const body of bodies) {
        if (segmentHits(a, b, rectOf(body))) cost += 1000;
        else if (segmentHits(a, b, nameOf(body))) cost += 150;
      }
      for (const other of drawn)
        for (let j = 1; j < other.length; j++)
          if (crosses(a, b, other[j - 1], other[j])) cost += 30;
    }
    const source = project.blocks.find((b) => b.id === wire.source)!;
    const sourcePort = portOf(source, wire.sourceHandle);
    const from = portPoint(source, wire.sourceHandle);
    const to = defaultRoute(project, wire)?.at(-1);
    // Signals read left to right: a forward wire that runs backwards is a smell, a
    // feedback wire (into a bottom or top terminal) is expected to.
    if (sourcePort?.direction === 'output' && from && to && to.x < from.x) {
      const target = project.blocks.find((b) => b.id === wire.target)!;
      const entry = portSide(portOf(target, wire.targetHandle)!);
      if (entry === 'left') cost += 200;
    }
  }
  return cost;
}

function isReference(block: Block) {
  return (
    block.definition.kind === 'ground' ||
    block.definition.kind.endsWith('Ground')
  );
}

/** Whether the block's own terminal on `wire` faces left or right. */
function horizontalWire(block: Block, wire: Wire) {
  const port = portOf(
    block,
    wire.source === block.id ? wire.sourceHandle : wire.targetHandle,
  );
  const side = port ? portSide(port) : 'left';
  return side === 'left' || side === 'right';
}

/** Candidate positions for `block` next to one placed neighbour on `wire`. */
function candidatesFor(
  project: Project,
  block: Block,
  wire: Wire,
): Block['position'][] {
  const mineIsSource = wire.source === block.id;
  const other = project.blocks.find(
    (b) => b.id === (mineIsSource ? wire.target : wire.source),
  )!;
  const otherPortId = mineIsSource ? wire.targetHandle : wire.sourceHandle;
  const port = portOf(
    block,
    mineIsSource ? wire.sourceHandle : wire.targetHandle,
  );
  const anchor = portPoint(other, otherPortId);
  if (!port || !anchor) return [];
  const size = defaultBlockSize(block.definition);
  const out = OUTWARD[anchor.side];
  const out2 = OUTWARD[portSide(port)];
  const facing = out.x === -out2.x && out.y === -out2.y;
  const results: Block['position'][] = [];
  let target: Pt;
  if (isReference(block)) {
    // A reference sits under its terminal, lead up.
    target = {
      x: anchor.x + out.x * (LAYOUT_GAP / 2),
      y: anchor.y + Math.max(out.y, 0) * (LAYOUT_GAP / 2) + LAYOUT_GAP / 2,
    };
  } else if (facing) {
    target = {
      x: anchor.x + out.x * LAYOUT_GAP,
      y: anchor.y + out.y * LAYOUT_GAP,
    };
  } else {
    // Perpendicular or same-facing terminals: step out from the anchor and across.
    target = {
      x: anchor.x + (out.x || -out2.x) * LAYOUT_GAP,
      y: anchor.y + (out.y || -out2.y) * LAYOUT_GAP,
    };
  }
  const base = positionForPortAt(block.definition, port, target);
  const horizontal = out.y === 0;
  const pitch = horizontal
    ? Math.ceil((size.height + 2 * MARGIN + NAME_SPACE) / GRID) * GRID
    : Math.ceil((size.width + 2 * MARGIN) / GRID) * GRID;
  // Straight first, then further along the flow, then onto rows below (feedback lives
  // under the forward path) before rows above.
  const across = [0, 1, 2, -1, 3, -2, 4, -3];
  const along = [0, 1, 2];
  for (const k of along)
    for (const j of across) {
      const step = k * (LAYOUT_GAP + (horizontal ? size.width : size.height));
      results.push(
        horizontal
          ? { x: base.x + out.x * step, y: base.y + j * pitch }
          : { x: base.x + j * pitch, y: base.y + out.y * step },
      );
    }
  return results;
}

/** Keep the exact port alignment on one axis and put the other on the grid. */
function snapAlongFlow(position: Block['position'], horizontal: boolean) {
  return horizontal
    ? { x: Math.round(position.x / GRID) * GRID, y: position.y }
    : { x: position.x, y: Math.round(position.y / GRID) * GRID };
}

/**
 * Place `ids` (blocks already in `project`) in house style, never moving any other block.
 * Returns the project with new positions and standard sizes for those blocks.
 */
export function layoutNewBlocks(project: Project, ids: string[]): Project {
  const pending = new Set(
    ids.filter((id) => project.blocks.some((b) => b.id === id)),
  );
  if (!pending.size) return project;
  let blocks = project.blocks.map((b) =>
    pending.has(b.id)
      ? {
          ...b,
          size: b.size ?? defaultBlockSize(b.definition),
          rotation: undefined,
        }
      : b,
  );
  const placed = new Set(
    blocks.filter((b) => !pending.has(b.id)).map((b) => b.id),
  );
  const current = () => ({ ...project, blocks });
  const claims = () => blocks.filter((b) => placed.has(b.id)).map(claimOf);

  const neighbours = (id: string) =>
    project.wires.filter(
      (w) =>
        (w.source === id && placed.has(w.target)) ||
        (w.target === id && placed.has(w.source)),
    );

  while (pending.size) {
    // Next: a block fed by what is already drawn (the flow continues), then the one
    // most tied to the drawing, then request order.
    let next: string | undefined;
    let best = 0;
    for (const id of ids) {
      if (!pending.has(id)) continue;
      const ties = neighbours(id);
      const fed = ties.some((w) => w.target === id && placed.has(w.source));
      const score = ties.length ? ties.length + (fed ? 10 : 0) : 0;
      if (score > best) {
        next = id;
        best = score;
      }
    }
    if (!next) {
      // Nothing connects to the drawing: start a new island to the right of it.
      next = ids.find((id) => pending.has(id))!;
      const block = blocks.find((b) => b.id === next)!;
      const taken = claims();
      const right = taken.length
        ? Math.max(...taken.map((r) => r.x + r.width)) + LAYOUT_GAP
        : 40;
      const top = taken.length
        ? Math.min(...taken.map((r) => r.y + MARGIN))
        : 40;
      let position = snapBlockPosition({ x: right, y: top }, block.size!);
      for (let i = 0; i < 40; i++) {
        const trial = { ...block, position };
        if (!taken.some((r) => overlaps(claimOf(trial), r))) break;
        position = { ...position, y: position.y + 120 };
      }
      blocks = blocks.map((b) => (b.id === next ? { ...b, position } : b));
      placed.add(next);
      pending.delete(next);
      continue;
    }
    const id = next;
    const block = blocks.find((b) => b.id === id)!;
    const taken = claims();
    const drawn = placedRoutes(current(), placed);
    let choice: Scored | undefined;
    const ties = neighbours(id);
    const trials: Block['position'][] = ties.flatMap((wire) =>
      candidatesFor(current(), block, wire).map((raw) =>
        snapAlongFlow(raw, horizontalWire(block, wire)),
      ),
    );
    if (ties.length > 1) {
      // A block tied to several others may belong between them: also search the grid
      // around their terminals and let the wire cost decide.
      const anchors = ties
        .map((w) =>
          w.source === id
            ? portPoint(
                blocks.find((b) => b.id === w.target)!,
                w.targetHandle,
              )
            : portPoint(
                blocks.find((b) => b.id === w.source)!,
                w.sourceHandle,
              ),
        )
        .filter((p): p is NonNullable<typeof p> => !!p);
      const cx = anchors.reduce((t, p) => t + p.x, 0) / anchors.length;
      const cy = anchors.reduce((t, p) => t + p.y, 0) / anchors.length;
      for (let dx = -480; dx <= 480; dx += 40)
        for (let dy = -320; dy <= 320; dy += 40)
          trials.push(
            snapBlockPosition(
              {
                x: cx + dx - block.size!.width / 2,
                y: cy + dy - block.size!.height / 2,
              },
              block.size!,
            ),
          );
    }
    {
      for (const position of trials) {
        const trial = { ...block, position };
        if (taken.some((r) => overlaps(claimOf(trial), r))) continue;
        const trialProject = {
          ...project,
          blocks: blocks.map((b) => (b.id === id ? trial : b)),
        };
        const cost = wireCost(trialProject, trial, placed, drawn);
        if (!choice || cost < choice.cost) choice = { position, cost };
      }
    }
    const position =
      choice?.position ??
      snapBlockPosition(
        {
          x: Math.max(...taken.map((r) => r.x + r.width)) + LAYOUT_GAP,
          y: Math.min(...taken.map((r) => r.y)) + MARGIN,
        },
        block.size!,
      );
    blocks = blocks.map((b) => (b.id === id ? { ...b, position } : b));
    placed.add(id);
    pending.delete(id);
  }
  return { ...project, blocks };
}

/**
 * Tidy an agent's coarse grid (its columns and rows) into house style: columns and rows
 * sized to the real blocks, and each block pulled onto the line of the block that feeds it.
 */
export function tidyGrid(project: Project, cell = { x: 320, y: 224 }): Project {
  const blocks = project.blocks.map((b) => ({
    ...b,
    size: b.size ?? defaultBlockSize(b.definition),
    rotation: undefined,
  }));
  const col = new Map(
    blocks.map((b) => [b.id, Math.round(b.position.x / cell.x)]),
  );
  const row = new Map(
    blocks.map((b) => [b.id, Math.round(b.position.y / cell.y)]),
  );
  const cols = [...new Set(col.values())].sort((a, b) => a - b);
  const rows = [...new Set(row.values())].sort((a, b) => a - b);
  const colX = new Map<number, number>();
  let x = 40;
  for (const c of cols) {
    colX.set(c, x);
    const members = blocks.filter((b) => col.get(b.id) === c);
    const width = Math.max(
      ...members.map((b) =>
        Math.max(
          b.size!.width,
          Math.min(240, b.definition.name.length * 8) - 40,
        ),
      ),
    );
    x += Math.ceil((width + LAYOUT_GAP) / GRID) * GRID;
  }
  const rowY = new Map<number, number>();
  let y = 120;
  for (const r of rows) {
    rowY.set(r, y);
    const members = blocks.filter((b) => row.get(b.id) === r);
    const height = Math.max(...members.map((b) => b.size!.height));
    y += Math.ceil((height + NAME_SPACE + LAYOUT_GAP) / GRID) * GRID;
  }
  let laid: Project = {
    ...project,
    wires: project.wires.map(({ waypoints: _w, junctions: _j, ...w }) => w),
    blocks: blocks.map((b) => ({
      ...b,
      position: snapBlockPosition(
        { x: colX.get(col.get(b.id)!)!, y: rowY.get(row.get(b.id)!)! },
        b.size!,
      ),
    })),
  };
  // Straighten: left to right, put each block's terminal on the line of the terminal it faces.
  const order = [...laid.blocks].sort(
    (a, b) => a.position.x - b.position.x || a.position.y - b.position.y,
  );
  for (const block of order) {
    for (const wire of laid.wires) {
      const mine =
        wire.target === block.id
          ? wire.targetHandle
          : wire.source === block.id
            ? wire.sourceHandle
            : undefined;
      if (!mine) continue;
      const otherId = wire.target === block.id ? wire.source : wire.target;
      const other = laid.blocks.find((b) => b.id === otherId)!;
      const self = laid.blocks.find((b) => b.id === block.id)!;
      if (
        row.get(otherId) !== row.get(block.id) ||
        other.position.x >= self.position.x
      )
        continue;
      const a = portPoint(
        other,
        wire.target === block.id ? wire.sourceHandle : wire.targetHandle,
      );
      const b = portPoint(self, mine);
      if (!a || !b || a.side !== 'right' || b.side !== 'left' || a.y === b.y)
        continue;
      const moved = {
        ...self,
        position: { ...self.position, y: self.position.y + a.y - b.y },
      };
      if (
        laid.blocks.some(
          (o) => o.id !== self.id && overlaps(claimOf(moved), claimOf(o)),
        )
      )
        continue;
      laid = {
        ...laid,
        blocks: laid.blocks.map((o) => (o.id === self.id ? moved : o)),
      };
      break;
    }
  }
  return laid;
}

/**
 * Lay out a whole generated model: its first source keeps the origin and every other
 * block is placed from it by the same rules, so a generated model reads like a template.
 */
export function layoutFromScratch(project: Project): Project {
  if (!project.blocks.length) return project;
  const drivers = new Set(project.wires.map((w) => w.target));
  const order = [...project.blocks].sort(
    (a, b) => a.position.x - b.position.x || a.position.y - b.position.y,
  );
  const seed =
    order.find(
      (b) =>
        !drivers.has(b.id) &&
        b.definition.ports.some((p) => p.direction === 'output'),
    ) ?? order[0];
  const size = seed.size ?? defaultBlockSize(seed.definition);
  const start = {
    ...project,
    wires: project.wires.map(({ waypoints: _w, junctions: _j, ...w }) => w),
    blocks: project.blocks.map((b) =>
      b.id === seed.id
        ? { ...b, size, position: snapBlockPosition({ x: 40, y: 120 }, size) }
        : b,
    ),
  };
  return layoutNewBlocks(
    start,
    order.filter((b) => b.id !== seed.id).map((b) => b.id),
  );
}

/** Lower is cleaner: what a reviewer would object to, weighted by how much it hurts reading. */
export function layoutScore(project: Project): number {
  let score = 0;
  for (const f of layoutFindings(project))
    score +=
      f.kind === 'overlap' ? 1000 : f.kind === 'wire-through-block' ? 300 : 100;
  const routes = project.wires
    .map((w) => defaultRoute(project, w))
    .filter((r): r is Pt[] => !!r);
  for (const [i, r] of routes.entries()) {
    score += 30 * Math.max(0, r.length - 2);
    for (let k = 1; k < r.length; k++) {
      score +=
        (Math.abs(r[k].x - r[k - 1].x) + Math.abs(r[k].y - r[k - 1].y)) / 20;
      for (const other of routes.slice(i + 1))
        for (let j = 1; j < other.length; j++)
          if (crosses(r[k - 1], r[k], other[j - 1], other[j])) score += 30;
    }
  }
  return score;
}

/** A generated model: tidy the agent's grid or lay it out afresh, whichever reads cleaner. */
export function layoutProject(project: Project): Project {
  if (!project.blocks.length) return project;
  const tidy = tidyGrid(project);
  const fresh = layoutFromScratch(project);
  const best = layoutScore(fresh) < layoutScore(tidy) ? fresh : tidy;
  // Upstream blocks may land left of or above the seed; start the drawing at the margin.
  const dx = 40 - Math.min(...best.blocks.map((b) => b.position.x));
  const dy = 80 - Math.min(...best.blocks.map((b) => b.position.y));
  return {
    ...best,
    blocks: best.blocks.map((b) => ({
      ...b,
      position: {
        x: b.position.x + Math.round(dx / GRID) * GRID,
        y: b.position.y + Math.round(dy / GRID) * GRID,
      },
    })),
  };
}

export type LayoutFinding = {
  kind: 'overlap' | 'wire-through-block' | 'backward-signal';
  ids: string[];
};

/** Style problems a reviewer would flag; used by tests to hold layouts to the template standard. */
export function layoutFindings(project: Project): LayoutFinding[] {
  const findings: LayoutFinding[] = [];
  const blocks = project.blocks;
  for (let i = 0; i < blocks.length; i++)
    for (let j = i + 1; j < blocks.length; j++)
      if (overlaps(rectOf(blocks[i]), rectOf(blocks[j])))
        findings.push({ kind: 'overlap', ids: [blocks[i].id, blocks[j].id] });
  for (const wire of project.wires) {
    if (wire.waypoints?.length) continue;
    const route = defaultRoute(project, wire);
    if (!route) continue;
    for (const body of blocks) {
      if (body.id === wire.source || body.id === wire.target) continue;
      if (
        route.some(
          (p, i) => i > 0 && segmentHits(route[i - 1], p, rectOf(body)),
        )
      ) {
        findings.push({ kind: 'wire-through-block', ids: [wire.id, body.id] });
        break;
      }
    }
    const target = blocks.find((b) => b.id === wire.target);
    const entry = target && portOf(target, wire.targetHandle);
    if (
      entry?.direction === 'input' &&
      portSide(entry) === 'left' &&
      route[route.length - 1].x < route[0].x
    )
      findings.push({ kind: 'backward-signal', ids: [wire.id] });
  }
  return findings;
}
