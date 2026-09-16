// SPDX-License-Identifier: Apache-2.0
import type { Project, Wire } from './model';
import { endpointPoint, endpointPort, TAP_HANDLE } from './net';
import { polylineOfWire, samePt } from './net-draw';
import { simplifyPoints, type Pt } from './routing';

/** Only a shared terminal establishes connectivity; geometric crossings never do. */
function prefix(a: Pt[], b: Pt[]) {
  if (a.length < 2 || b.length < 2 || !samePt(a[0], b[0])) return null;
  let i = 1,
    j = 1,
    at = a[0];
  const common = [at];
  while (i < a.length && j < b.length) {
    const pa = a[i],
      pb = b[j];
    const da = { x: Math.sign(pa.x - at.x), y: Math.sign(pa.y - at.y) };
    const db = { x: Math.sign(pb.x - at.x), y: Math.sign(pb.y - at.y) };
    if (da.x !== db.x || da.y !== db.y || (da.x && da.y)) break;
    const la = Math.abs(pa.x - at.x) + Math.abs(pa.y - at.y);
    const lb = Math.abs(pb.x - at.x) + Math.abs(pb.y - at.y);
    at = la <= lb ? pa : pb;
    common.push(at);
    if (samePt(at, pa)) i++;
    if (samePt(at, pb)) j++;
  }
  // A shared point alone is not a shared run.
  if (common.length < 2) return null;
  return { common, a: [at, ...a.slice(i)], b: [at, ...b.slice(j)], at };
}

/** Factor shared terminal-to-branch runs into real, movable junctions in every domain. */
export function materializeBranches(project: Project): Project {
  let next = project;
  const limit = project.wires.length;
  for (let pass = 0; pass < limit; pass++) {
    const groups = new Map<string, { wire: Wire; reversed: boolean }[]>();
    for (const wire of next.wires) {
      for (const reversed of [false, true]) {
        const id = reversed ? wire.target : wire.source;
        if (!next.blocks.some((b) => b.id === id)) continue;
        const key = `${id}.${reversed ? wire.targetHandle : wire.sourceHandle}`;
        const list = groups.get(key) ?? [];
        list.push({ wire, reversed });
        groups.set(key, list);
      }
    }
    let changed = false;
    outer: for (const group of groups.values()) {
      for (let i = 0; i < group.length; i++)
        for (let j = i + 1; j < group.length; j++) {
          const first = group[i],
            second = group[j];
          if (first.wire.id === second.wire.id) continue;
          const path = (entry: typeof first) => {
            const points = polylineOfWire(next, entry.wire.id);
            return entry.reversed ? [...points].reverse() : points;
          };
          const branch = prefix(path(first), path(second));
          if (!branch) continue;
          // A later fan-out can share a trunk we just materialized. Attach
          // it to that existing node instead of retaining an overlapping wire.
          if (branch.a.length === 1 || branch.b.length === 1) {
            if (branch.a.length === 1 && branch.b.length === 1) continue;
            const trunk = branch.a.length === 1 ? first : second;
            const leaf = branch.a.length === 1 ? second : first;
            const points = branch.a.length === 1 ? branch.b : branch.a;
            const nodeId = trunk.reversed
              ? trunk.wire.source
              : trunk.wire.target;
            if (!next.junctions?.some((node) => node.id === nodeId)) continue;
            const replacement: Wire = leaf.reversed
              ? {
                  ...leaf.wire,
                  target: nodeId,
                  targetHandle: TAP_HANDLE,
                  waypoints: simplifyPoints([...points].reverse()).slice(1, -1),
                }
              : {
                  ...leaf.wire,
                  source: nodeId,
                  sourceHandle: TAP_HANDLE,
                  waypoints: simplifyPoints(points).slice(1, -1),
                };
            next = {
              ...next,
              wires: next.wires.map((w) =>
                w.id === replacement.id ? replacement : w,
              ),
            };
            changed = true;
            break outer;
          }
          const occupied =
            next.blocks.some((b) =>
              b.definition.ports.some((p) => {
                const point = endpointPoint(next, b.id, p.id);
                return point && samePt(point, branch.at);
              }),
            ) || next.junctions?.some((j) => samePt(j.position, branch.at));
          if (occupied) continue;
          const terminal = first.reversed
            ? first.wire.target
            : first.wire.source;
          const handle = first.reversed
            ? first.wire.targetHandle
            : first.wire.sourceHandle;
          const port = endpointPort(next, terminal, handle, 'source');
          if (!port) continue;
          const id = `j_${crypto.randomUUID().replaceAll('-', '')}`;
          const tail = (entry: typeof first, points: Pt[]): Wire =>
            entry.reversed
              ? {
                  ...entry.wire,
                  target: id,
                  targetHandle: TAP_HANDLE,
                  waypoints: simplifyPoints([...points].reverse()).slice(1, -1),
                }
              : {
                  ...entry.wire,
                  source: id,
                  sourceHandle: TAP_HANDLE,
                  waypoints: simplifyPoints(points).slice(1, -1),
                };
          next = {
            ...next,
            junctions: [
              ...(next.junctions ?? []),
              { id, domain: port.domain, position: { ...branch.at } },
            ],
            wires: [
              ...next.wires.map((w) =>
                w.id === first.wire.id
                  ? tail(first, branch.a)
                  : w.id === second.wire.id
                    ? tail(second, branch.b)
                    : w,
              ),
              {
                id: `w_${crypto.randomUUID().replaceAll('-', '')}`,
                source: terminal,
                sourceHandle: handle,
                target: id,
                targetHandle: TAP_HANDLE,
                waypoints: simplifyPoints(branch.common).slice(1, -1),
              },
            ],
          };
          changed = true;
          break outer;
        }
    }
    if (!changed) break;
  }
  return next;
}
