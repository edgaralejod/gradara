import type { Domain, Junction, Port, Project, Wire } from './model';
import { compatible, portOf } from './model';
import { portPoint } from './ports';
import { GRID } from './placement';

export const TAP_HANDLE = 'node';
export const TAP_SIZE = 10;

export function isTap(project: Project, id: string) {
  return !!project.junctions?.some((j) => j.id === id);
}

export function tapOf(project: Project, id: string) {
  return project.junctions?.find((j) => j.id === id);
}

export function endpointPort(
  project: Project,
  id: string,
  handle: string,
  role: 'source' | 'target',
): Port | undefined {
  const tap = tapOf(project, id);
  if (tap)
    return {
      id: TAP_HANDLE,
      name: 'node',
      direction: role === 'source' ? 'output' : 'input',
      domain: tap.domain,
    };
  return portOf(project, id, handle);
}

export function endpointsCompatible(
  project: Project,
  source: string,
  sourceHandle: string,
  target: string,
  targetHandle: string,
) {
  return compatible(
    endpointPort(project, source, sourceHandle, 'source'),
    endpointPort(project, target, targetHandle, 'target'),
  );
}

export function endpointPoint(project: Project, id: string, handle: string) {
  const tap = tapOf(project, id);
  if (tap)
    return { x: tap.position.x, y: tap.position.y, side: 'right' as const };
  const block = project.blocks.find((b) => b.id === id);
  return block ? portPoint(block, handle) : undefined;
}

function key(id: string, handle: string, project: Project) {
  return isTap(project, id) ? `j:${id}` : `${id}.${handle}`;
}

function parseKey(k: string) {
  if (k.startsWith('j:')) return { id: k.slice(2), handle: TAP_HANDLE };
  const i = k.lastIndexOf('.');
  return { id: k.slice(0, i), handle: k.slice(i + 1) };
}

/** Port-to-port pairs for execution. Junctions are only geometry. */
export function flattenWires(project: Project): Wire[] {
  const adj = new Map<string, string[]>();
  const link = (a: string, b: string) => {
    adj.set(a, [...(adj.get(a) ?? []), b]);
    adj.set(b, [...(adj.get(b) ?? []), a]);
  };
  for (const w of project.wires)
    link(
      key(w.source, w.sourceHandle, project),
      key(w.target, w.targetHandle, project),
    );

  const portKeys = [...adj.keys()].filter((k) => !k.startsWith('j:'));
  const outputs = portKeys.filter((k) => {
    const { id, handle } = parseKey(k);
    const p = portOf(project, id, handle);
    return p?.direction === 'output' || p?.direction === 'physical';
  });
  const seen = new Set<string>();
  const pairs: Wire[] = [];
  for (const origin of outputs) {
    const { id: sid, handle: sh } = parseKey(origin);
    const stack = [origin];
    const visited = new Set([origin]);
    while (stack.length) {
      const cur = stack.pop()!;
      for (const n of adj.get(cur) ?? []) {
        if (visited.has(n)) continue;
        visited.add(n);
        if (n.startsWith('j:')) {
          stack.push(n);
          continue;
        }
        const { id: tid, handle: th } = parseKey(n);
        const p = portOf(project, tid, th);
        if (!p) continue;
        if (p.direction === 'input' || p.direction === 'physical') {
          const sig = [sid, sh, tid, th].join('|');
          if (seen.has(sig)) continue;
          seen.add(sig);
          pairs.push({
            id: sig,
            source: sid,
            sourceHandle: sh,
            target: tid,
            targetHandle: th,
          });
        }
      }
    }
  }
  return pairs;
}

export function tapPositionFromPort(
  project: Project,
  blockId: string,
  portId: string,
) {
  const block = project.blocks.find((b) => b.id === blockId);
  const pt = block ? portPoint(block, portId) : undefined;
  if (!pt) return { x: 0, y: 0 };
  const side = pt.side;
  const step = 36;
  if (side === 'right') return { x: pt.x + step, y: pt.y };
  if (side === 'left') return { x: pt.x - step, y: pt.y };
  if (side === 'bottom') return { x: pt.x, y: pt.y + step };
  return { x: pt.x, y: pt.y - step };
}

function newTapId() {
  return `j_${crypto.randomUUID().replaceAll('-', '').slice(0, 12)}`;
}

export function createTap(
  project: Project,
  position: { x: number; y: number },
  domain: Domain,
): { project: Project; id: string } {
  const id = newTapId();
  const tap: Junction = {
    id,
    position: {
      x: Math.round(position.x / GRID) * GRID,
      y: Math.round(position.y),
    },
    domain,
  };
  return {
    id,
    project: { ...project, junctions: [...(project.junctions ?? []), tap] },
  };
}

export function moveTap(
  project: Project,
  id: string,
  position: { x: number; y: number },
): Project {
  return {
    ...project,
    junctions: (project.junctions ?? []).map((j) =>
      j.id === id ? { ...j, position } : j,
    ),
  };
}

/** If a second wire leaves the same output, share a trunk node instead of stacking. */
export function shareTrunk(project: Project, added: Wire): Project {
  if (isTap(project, added.source) || isTap(project, added.target))
    return project;
  const port = portOf(project, added.source, added.sourceHandle);
  if (!port || port.direction === 'input') return project;
  const family = project.wires.filter(
    (w) =>
      w.source === added.source && w.sourceHandle === added.sourceHandle,
  );
  if (family.length < 2) return project;
  const others = family.filter((w) => w.id !== added.id);
  const onlyTap =
    others.length === 1 && isTap(project, others[0].target)
      ? others[0].target
      : undefined;
  if (onlyTap) {
    return {
      ...project,
      wires: project.wires.map((w) =>
        w.id === added.id
          ? { ...w, source: onlyTap, sourceHandle: TAP_HANDLE }
          : w,
      ),
    };
  }
  const blockWires = family.filter(
    (w) => !isTap(project, w.target) && !isTap(project, w.source),
  );
  if (blockWires.length < 2) return project;
  const { project: withTap, id: tapId } = createTap(
    project,
    tapPositionFromPort(project, added.source, added.sourceHandle),
    port.domain,
  );
  const rest = withTap.wires.filter(
    (w) => !blockWires.some((b) => b.id === w.id),
  );
  const split: Wire[] = [
    {
      id: `w_${tapId}`,
      source: added.source,
      sourceHandle: added.sourceHandle,
      target: tapId,
      targetHandle: TAP_HANDLE,
    },
    ...blockWires.map((w) => ({
      ...w,
      source: tapId,
      sourceHandle: TAP_HANDLE,
      waypoints: undefined,
      junctions: undefined,
    })),
  ];
  return { ...withTap, wires: [...rest, ...split] };
}

export function netKeys(project: Project, seed: { id: string; handle: string }) {
  const start = key(seed.id, seed.handle, project);
  const visited = new Set([start]);
  const stack = [start];
  while (stack.length) {
    const cur = stack.pop()!;
    for (const w of project.wires) {
      const a = key(w.source, w.sourceHandle, project);
      const b = key(w.target, w.targetHandle, project);
      const next = cur === a ? b : cur === b ? a : null;
      if (!next || visited.has(next)) continue;
      visited.add(next);
      stack.push(next);
    }
  }
  return visited;
}

export function onNet(
  project: Project,
  a: { id: string; handle: string },
  b: { id: string; handle: string },
) {
  return netKeys(project, a).has(key(b.id, b.handle, project));
}

export function netBlocks(project: Project, seed: { id: string; handle: string }) {
  const ids = new Set<string>();
  for (const k of netKeys(project, seed)) {
    if (k.startsWith('j:')) ids.add(k.slice(2));
    else ids.add(parseKey(k).id);
  }
  return ids;
}

export function occupiedInputs(project: Project) {
  const taken = new Set<string>();
  for (const w of flattenWires(project)) {
    const b = portOf(project, w.target, w.targetHandle);
    if (b?.direction === 'input') taken.add(`${w.target}.${w.targetHandle}`);
    const a = portOf(project, w.source, w.sourceHandle);
    if (a?.direction === 'input') taken.add(`${w.source}.${w.sourceHandle}`);
  }
  return taken;
}

export function splitAt(
  project: Project,
  wireId: string,
  at: { x: number; y: number },
  domain: Domain,
): { project: Project; tapId: string } | null {
  const wire = project.wires.find((w) => w.id === wireId);
  if (!wire) return null;
  const { project: withTap, id: tapId } = createTap(project, at, domain);
  const rest = withTap.wires.filter((w) => w.id !== wireId);
  const a: Wire = {
    id: wire.id,
    source: wire.source,
    sourceHandle: wire.sourceHandle,
    target: tapId,
    targetHandle: TAP_HANDLE,
    waypoints: undefined,
  };
  const b: Wire = {
    id: `${wire.id}_b`,
    source: tapId,
    sourceHandle: TAP_HANDLE,
    target: wire.target,
    targetHandle: wire.targetHandle,
    waypoints: undefined,
  };
  return { tapId, project: { ...withTap, wires: [...rest, a, b] } };
}
