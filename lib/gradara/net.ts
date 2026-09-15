import type { Port, Project, Wire } from './model';
import { portOf } from './model';
import { portPoint } from './ports';

export const TAP_HANDLE = 'node';
export const TAP_SIZE = 10;

export function isTap(project: Project, id: string) {
  return !!project.junctions?.some((j) => j.id === id);
}

function tapOf(project: Project, id: string) {
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
      direction:
        tap.domain !== 'signal'
          ? 'physical'
          : role === 'source'
            ? 'output'
            : 'input',
      domain: tap.domain,
    };
  return portOf(project, id, handle);
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

/** Stable connected components; connector geometry never participates in execution. */
export function netComponents(project: Project): string[][] {
  const visited = new Set<string>();
  const components: string[][] = [];
  for (const w of project.wires) {
    const seed = { id: w.source, handle: w.sourceHandle };
    if (visited.has(key(seed.id, seed.handle, project))) continue;
    const component = [...netKeys(project, seed)].sort();
    component.forEach((k) => visited.add(k));
    components.push(component);
  }
  return components;
}
export function flattenWires(project: Project): Wire[] {
  const result: Wire[] = [];
  for (const component of netComponents(project)) {
    const ports = component
      .filter((k) => !k.startsWith('j:'))
      .map(parseKey)
      .filter((e) => portOf(project, e.id, e.handle));
    const driver = ports.find(
      (e) => portOf(project, e.id, e.handle)?.direction === 'output',
    );
    const source = driver ?? ports[0];
    if (!source) continue;
    for (const target of ports) {
      if (target === source) continue;
      const p = portOf(project, target.id, target.handle)!;
      if (driver ? p.direction !== 'input' : p.direction !== 'physical')
        continue;
      const sig = [source.id, source.handle, target.id, target.handle].join(
        '|',
      );
      result.push({
        id: sig,
        source: source.id,
        sourceHandle: source.handle,
        target: target.id,
        targetHandle: target.handle,
      });
    }
  }
  return result.sort((a, b) => a.id.localeCompare(b.id));
}
/** Junctions carry connectivity, never an invented signal direction or driver. */
export function connectionError(
  project: Project,
  a: { id: string; handle: string },
  b: { id: string; handle: string },
): string | null {
  const pa = endpointPort(project, a.id, a.handle, 'source'),
    pb = endpointPort(project, b.id, b.handle, 'target');
  if (!pa || !pb) return 'This port no longer exists.';
  if (pa.domain !== pb.domain) return `Use a ${pa.domain} port or wire.`;
  if (onNet(project, a, b)) return 'Already part of this net.';
  const ports = [...new Set([...netKeys(project, a), ...netKeys(project, b)])]
    .filter((k) => !k.startsWith('j:'))
    .map(parseKey)
    .map((e) => portOf(project, e.id, e.handle))
    .filter((p) => !!p);
  const physical = ports.filter((p) => p.direction === 'physical');
  if (physical.length)
    return physical.length === ports.length
      ? null
      : 'Physical connectors cannot join signal ports.';
  const drivers = ports.filter((p) => p.direction === 'output');
  if (drivers.length > 1)
    return 'This net already has a source. Join an unused input instead.';
  if (drivers.length === 0) return 'A signal net needs an output.';
  return null;
}

export function netKeys(
  project: Project,
  seed: { id: string; handle: string },
) {
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
