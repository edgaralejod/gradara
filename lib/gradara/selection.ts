import type { Block, Junction, Net, Project, Wire } from './model';
import { newNetId, reconcileNets } from './net-registry';
import { normalizeBlockNames } from './names';
import { portOf } from './model';
import { blockSize, applyLayout, type BlockLayout } from './canvas';
import { endpointPoint, netComponents } from './net';
import { polylineOfWire, samePt } from './net-draw';
import { followJunctionsForLayout, moveJunctions } from './net-layout';
import { snapMovedBlocks } from './placement';
import { sideToPosition } from './ports';
import { routeBetween, segmentExit, simplifyPoints, type Pt } from './routing';

/** Transient editor selection. Geometry is never inferred from visual crossings. */
export type ModelSelection = {
  blockIds: string[];
  wireIds: string[];
  junctionIds: string[];
};
export const emptySelection = (): ModelSelection => ({
  blockIds: [],
  wireIds: [],
  junctionIds: [],
});

/**
 * Retain the junction paths between selected terminals. Unselected ports are
 * boundaries, never traversed through their block. Leaf pruning works for both
 * directed signals and undirected physical nets, independent of record order.
 */
export function resolveSelection(
  project: Project,
  selection: ModelSelection,
): ModelSelection {
  const blocks = new Set(selection.blockIds);
  const explicit = new Set(selection.junctionIds);
  const junctions = new Set((project.junctions ?? []).map((j) => j.id));
  const allowed = (id: string) => blocks.has(id) || junctions.has(id);
  let wires = project.wires.filter(
    (w) => allowed(w.source) && allowed(w.target),
  );
  const incident = new Map<string, Set<string>>();
  for (const id of junctions) incident.set(id, new Set());
  for (const w of wires) {
    incident.get(w.source)?.add(w.id);
    incident.get(w.target)?.add(w.id);
  }
  const byId = new Map(wires.map((w) => [w.id, w]));
  const removed = new Set<string>();
  const queue = [...junctions].filter(
    (id) => !explicit.has(id) && incident.get(id)!.size < 2,
  );
  for (let i = 0; i < queue.length; i++) {
    const id = queue[i];
    if (!junctions.delete(id)) continue;
    for (const wireId of incident.get(id)!) {
      removed.add(wireId);
      const w = byId.get(wireId)!;
      const neighbor = w.source === id ? w.target : w.source;
      const edges = incident.get(neighbor);
      edges?.delete(wireId);
      if (edges && edges.size < 2 && !explicit.has(neighbor))
        queue.push(neighbor);
    }
  }
  wires = wires.filter((w) => !removed.has(w.id));
  const chosenWires = new Set([
    ...selection.wireIds,
    ...wires.map((w) => w.id),
  ]);
  // Selecting a complete run also selects the real dots at its ends.
  for (const w of project.wires)
    if (chosenWires.has(w.id)) {
      if (incident.has(w.source)) junctions.add(w.source);
      if (incident.has(w.target)) junctions.add(w.target);
    }
  return {
    blockIds: project.blocks.filter((b) => blocks.has(b.id)).map((b) => b.id),
    wireIds: project.wires
      .filter((w) => chosenWires.has(w.id))
      .map((w) => w.id),
    junctionIds: (project.junctions ?? [])
      .filter((j) => junctions.has(j.id))
      .map((j) => j.id),
  };
}

const offset = (point: Pt, delta: Pt): Pt => ({
  x: point.x + delta.x,
  y: point.y + delta.y,
});

/** One rigid translation; boundary ports stay put and their incident routes stretch. */
export function translateSelection(
  project: Project,
  selection: ModelSelection,
  delta: Pt,
): Project {
  if (
    !Number.isFinite(delta.x) ||
    !Number.isFinite(delta.y) ||
    (!delta.x && !delta.y)
  )
    return project;
  const resolved = resolveSelection(project, selection);
  const blockIds = new Set(resolved.blockIds);
  const junctionIds = new Set(resolved.junctionIds);
  const wireIds = new Set(resolved.wireIds);
  if (!blockIds.size && !junctionIds.size && !wireIds.size) return project;
  const moves = (id: string) => blockIds.has(id) || junctionIds.has(id);
  const movedDots = moveJunctions(
    project,
    new Map(
      (project.junctions ?? [])
        .filter((j) => junctionIds.has(j.id))
        .map((j) => [j.id, offset(j.position, delta)]),
    ),
  );
  const next: Project = {
    ...movedDots,
    blocks: project.blocks.map((b) =>
      blockIds.has(b.id) ? { ...b, position: offset(b.position, delta) } : b,
    ),
  };
  next.wires = project.wires.map((w) => {
    if (!wireIds.has(w.id))
      return movedDots.wires.find((other) => other.id === w.id)!;
    const points = polylineOfWire(project, w.id);
    if (points.length < 2) return w;
    let moved = points.map((p) => offset(p, delta));
    // A selected wire can move without its blocks. Preserve its body and bridge
    // to fixed ports using their actual normals; junction endpoints move above.
    if (!moves(w.source)) {
      const start = endpointPoint(next, w.source, w.sourceHandle)!;
      moved = [
        ...routeBetween(start, moved[0], sideToPosition(start.side)),
        ...moved.slice(1),
      ];
    }
    if (!moves(w.target)) {
      const end = endpointPoint(next, w.target, w.targetHandle)!;
      const tail = moved.at(-1)!;
      moved.push(
        ...routeBetween(
          tail,
          end,
          segmentExit(tail, end),
          sideToPosition(end.side),
        ).slice(1),
      );
    }
    return {
      ...w,
      waypoints: simplifyPoints(moved).slice(1, -1),
      junctions: w.junctions?.map((p) => offset(p, delta)),
    };
  });
  return next;
}

/** Same operation for live canvas previews and the single saved drag transaction. */
export function layoutSelection(
  project: Project,
  layouts: BlockLayout[],
  selection: ModelSelection = emptySelection(),
  snap = true,
): Project {
  const updates = layouts.filter((l) => {
    const b = project.blocks.find((b) => b.id === l.id);
    return (
      b &&
      (!samePt(b.position, l.position) ||
        blockSize(b).width !== l.size.width ||
        blockSize(b).height !== l.size.height)
    );
  });
  if (!updates.length) return project;
  const first = project.blocks.find((b) => b.id === updates[0].id)!;
  const delta = {
    x: updates[0].position.x - first.position.x,
    y: updates[0].position.y - first.position.y,
  };
  const rigid =
    (updates.length > 1 ||
      selection.wireIds.length > 0 ||
      selection.junctionIds.length > 0) &&
    updates.every((l) => {
      const b = project.blocks.find((b) => b.id === l.id)!;
      return (
        samePt(offset(b.position, delta), l.position) &&
        blockSize(b).width === l.size.width &&
        blockSize(b).height === l.size.height
      );
    });
  if (rigid)
    return translateSelection(
      project,
      { ...selection, blockIds: updates.map((l) => l.id) },
      delta,
    );
  const laidOut = applyLayout(project, updates);
  return followJunctionsForLayout(
    project,
    snap
      ? snapMovedBlocks(
          laidOut,
          updates.map((l) => l.id),
        )
      : laidOut,
  );
}

export type ModelFragment = {
  version: 1;
  blocks: Block[];
  junctions: Junction[];
  wires: Wire[];
  nets?: Net[];
};

/** Copy internal connectivity only. External signal drivers are never invented. */
export function extractSelection(
  project: Project,
  selection: ModelSelection,
): ModelFragment {
  const resolved = resolveSelection(project, {
    ...selection,
    wireIds: [],
    junctionIds: [],
  });
  const blocks = new Set(resolved.blockIds);
  const dots = new Set(resolved.junctionIds);
  const ids = new Set([...blocks, ...dots]);
  let wires = project.wires.filter(
    (w) => ids.has(w.source) && ids.has(w.target),
  );
  const fragmentProject = {
    ...project,
    blocks: project.blocks.filter((b) => blocks.has(b.id)),
    wires,
    junctions: (project.junctions ?? []).filter((j) => dots.has(j.id)),
  };
  // Input-only fragments leave those inputs open. Physical connections remain
  // valid without choosing a source, so retain them in either record direction.
  const validKeys = new Set<string>();
  for (const keys of netComponents(fragmentProject)) {
    const ports = keys
      .filter((k) => !k.startsWith('j:'))
      .map((k) => {
        const i = k.lastIndexOf('.');
        return portOf(project, k.slice(0, i), k.slice(i + 1));
      });
    if (
      ports.some((p) => p?.direction === 'output') ||
      ports.every((p) => p?.direction === 'physical')
    )
      keys.forEach((k) => validKeys.add(k));
  }
  wires = wires.filter((w) =>
    validKeys.has(
      dots.has(w.source) ? `j:${w.source}` : `${w.source}.${w.sourceHandle}`,
    ),
  );
  // Keep degree-two junctions temporarily: collapsing them must preserve the
  // original rendered path, including bends on routes crossing the boundary.
  let result: ModelFragment = structuredClone({
    version: 1,
    blocks: fragmentProject.blocks,
    junctions: fragmentProject.junctions.filter((j) =>
      wires.some((w) => w.source === j.id || w.target === j.id),
    ),
    wires: wires.map((w) => ({
      ...w,
      waypoints: polylineOfWire(project, w.id).slice(1, -1),
    })),
  });
  for (const j of result.junctions) {
    const incident = result.wires.filter(
      (w) => w.source === j.id || w.target === j.id,
    );
    if (incident.length !== 2) continue;
    const [a, b] = incident;
    const p = { ...project, ...result };
    const pa = polylineOfWire(p, a.id),
      pb = polylineOfWire(p, b.id);
    const from =
      a.source === j.id
        ? { id: a.target, handle: a.targetHandle }
        : { id: a.source, handle: a.sourceHandle };
    const to =
      b.target === j.id
        ? { id: b.source, handle: b.sourceHandle }
        : { id: b.target, handle: b.targetHandle };
    const points = [
      ...(a.source === j.id ? [...pa].reverse() : pa),
      ...(b.target === j.id ? [...pb].reverse() : pb).slice(1),
    ];
    result = {
      ...result,
      junctions: result.junctions.filter((dot) => dot.id !== j.id),
      wires: [
        ...result.wires.filter((w) => w.id !== a.id && w.id !== b.id),
        {
          ...a,
          source: from.id,
          sourceHandle: from.handle,
          target: to.id,
          targetHandle: to.handle,
          waypoints: simplifyPoints(points).slice(1, -1),
        },
      ],
    };
  }
  return {
    ...result,
    nets: reconcileNets({ ...project, ...result }, project).nets,
  };
}

export function pasteSelection(
  project: Project,
  fragment: ModelFragment,
  delta: Pt = { x: 40, y: 40 },
) {
  const id = (prefix: string) =>
    `${prefix}_${crypto.randomUUID().replaceAll('-', '').slice(0, 12)}`;
  const remap = new Map([
    ...fragment.blocks.map((b) => [b.id, id('b')] as const),
    ...fragment.junctions.map((j) => [j.id, id('j')] as const),
  ]);
  const blocks = fragment.blocks.map((b) => ({
    ...structuredClone(b),
    id: remap.get(b.id)!,
    position: offset(b.position, delta),
  }));
  const junctions = fragment.junctions.map((j) => ({
    ...structuredClone(j),
    id: remap.get(j.id)!,
    position: offset(j.position, delta),
  }));
  const wireIds = new Map(
    fragment.wires.map((w) => [w.id, crypto.randomUUID()]),
  );
  const wires = fragment.wires.map((w) => ({
    ...structuredClone(w),
    id: wireIds.get(w.id)!,
    source: remap.get(w.source)!,
    target: remap.get(w.target)!,
    waypoints: w.waypoints?.map((p) => offset(p, delta)),
    junctions: w.junctions?.map((p) => offset(p, delta)),
  }));
  const nets = (fragment.nets ?? []).map((n) => {
    const dot = n.anchor.startsWith('j:');
    const split = n.anchor.lastIndexOf('.');
    const anchor = dot
      ? `j:${remap.get(n.anchor.slice(2))}`
      : `${remap.get(n.anchor.slice(0, split))}.${n.anchor.slice(split + 1)}`;
    return {
      ...structuredClone(n),
      id: newNetId(),
      anchor,
      wireIds: n.wireIds.map((id) => wireIds.get(id)!),
      label: n.label
        ? { ...n.label, wireId: wireIds.get(n.label.wireId)! }
        : undefined,
    };
  });
  return {
    project: reconcileNets(
      normalizeBlockNames(
        {
          ...project,
          blocks: [...project.blocks, ...blocks],
          junctions: [...(project.junctions ?? []), ...junctions],
          wires: [...project.wires, ...wires],
          nets: [...(project.nets ?? []), ...nets],
        },
        project,
      ),
      project,
    ),
    selection: {
      blockIds: blocks.map((b) => b.id),
      wireIds: wires.map((w) => w.id),
      junctionIds: junctions.map((j) => j.id),
    },
  };
}

/** Region selection includes complete wire records that intersect the rectangle. */
export function wiresInRect(
  project: Project,
  rect: { x: number; y: number; width: number; height: number },
) {
  const inside = (p: Pt) =>
    p.x >= rect.x &&
    p.x <= rect.x + rect.width &&
    p.y >= rect.y &&
    p.y <= rect.y + rect.height;
  return {
    wireIds: project.wires
      .filter((w) =>
        polylineOfWire(project, w.id).some((a, i, points) => {
          const b = points[i + 1];
          if (!b) return false;
          return (
            Math.min(a.x, b.x) <= rect.x + rect.width &&
            Math.max(a.x, b.x) >= rect.x &&
            Math.min(a.y, b.y) <= rect.y + rect.height &&
            Math.max(a.y, b.y) >= rect.y
          );
        }),
      )
      .map((w) => w.id),
    junctionIds: (project.junctions ?? [])
      .filter((j) => inside(j.position))
      .map((j) => j.id),
  };
}

/** The region's geometry is authoritative; renderer selection notifications may lag a frame. */
export function selectionInRect(
  project: Project,
  rect: { x: number; y: number; width: number; height: number },
): ModelSelection {
  return {
    blockIds: project.blocks
      .filter((b) => {
        const size = blockSize(b);
        return (
          b.position.x < rect.x + rect.width &&
          b.position.x + size.width > rect.x &&
          b.position.y < rect.y + rect.height &&
          b.position.y + size.height > rect.y
        );
      })
      .map((b) => b.id),
    ...wiresInRect(project, rect),
  };
}
