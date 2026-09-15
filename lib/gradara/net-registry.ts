import { automaticNetName, netDisplayName } from './names';
import {
  portOf,
  type Domain,
  type Net,
  type Port,
  type Project,
} from './model';

export type NetTopology = {
  keys: Set<string>;
  wireIds: string[];
  junctionIds: string[];
  domain: Domain;
  driver?: string;
};

/** Linear adjacency walk; every port is distinct, even on a multi-domain block. */
export function netTopology(project: Project): NetTopology[] {
  const taps = new Map((project.junctions ?? []).map((j) => [j.id, j]));
  const ports = new Map<string, Port>(
    project.blocks.flatMap((b) =>
      b.definition.ports.map((p) => [`${b.id}.${p.id}`, p] as const),
    ),
  );
  const adj = new Map<string, { to: string; wire: string }[]>();
  const key = (id: string, handle: string) =>
    taps.has(id) ? `j:${id}` : `${id}.${handle}`;
  for (const w of project.wires) {
    const a = key(w.source, w.sourceHandle),
      b = key(w.target, w.targetHandle);
    if (!adj.has(a)) adj.set(a, []);
    if (!adj.has(b)) adj.set(b, []);
    adj.get(a)!.push({ to: b, wire: w.id });
    adj.get(b)!.push({ to: a, wire: w.id });
  }
  const seen = new Set<string>(),
    result: NetTopology[] = [];
  for (const seed of adj.keys()) {
    if (seen.has(seed)) continue;
    const keys = new Set<string>(),
      wires = new Set<string>(),
      stack = [seed];
    while (stack.length) {
      const current = stack.pop()!;
      if (seen.has(current)) continue;
      seen.add(current);
      keys.add(current);
      for (const edge of adj.get(current) ?? []) {
        wires.add(edge.wire);
        if (!seen.has(edge.to)) stack.push(edge.to);
      }
    }
    const ordered = [...keys].sort();
    result.push({
      keys: new Set(ordered),
      wireIds: [...wires].sort(),
      junctionIds: ordered
        .filter((k) => k.startsWith('j:'))
        .map((k) => k.slice(2)),
      driver: ordered.find((k) => ports.get(k)?.direction === 'output'),
      domain:
        ports.get(ordered.find((k) => ports.has(k)) ?? '')?.domain ??
        taps.get(seed.slice(2))?.domain ??
        'signal',
    });
  }
  return result;
}

export function newNetId() {
  return `net_${crypto.randomUUID().replaceAll('-', '')}`;
}

/** Reconcile once per document transaction, never in pointer previews.
 * The component retaining the anchor keeps the ID on a split. If that endpoint
 * disappeared, surviving wire IDs, then surviving endpoints, recover identity.
 * A merge keeps the driver's identity (or a deterministic physical-net winner).
 */
export function reconcileNets(
  next: Project,
  previous: Project = next,
): Project {
  const components = netTopology(next);
  const oldComponents = netTopology(previous);
  const oldByWire = new Map(
    oldComponents.flatMap((c) => c.wireIds.map((id) => [id, c] as const)),
  );
  const byKey = new Map(
    components.flatMap((c) => [...c.keys].map((key) => [key, c] as const)),
  );
  const byWire = new Map(
    components.flatMap((c) => c.wireIds.map((id) => [id, c] as const)),
  );
  const wireWeight = (previous.wires.length + next.wires.length) * 2 + 1;
  const anchorWeight =
    (previous.wires.length + next.wires.length + 1) * wireWeight;
  const candidates = next.nets ?? previous.nets ?? [];
  const claims = new Map<NetTopology, { net: Net; score: number }[]>();
  for (const net of candidates) {
    const old = net.wireIds.map((id) => oldByWire.get(id)).find(Boolean);
    const ranks = new Map<NetTopology, number>();
    const add = (c: NetTopology | undefined, weight: number) => {
      if (c && (!old || old.domain === c.domain))
        ranks.set(c, (ranks.get(c) ?? 0) + weight);
    };
    add(byKey.get(net.anchor), anchorWeight);
    net.wireIds.forEach((id) => add(byWire.get(id), wireWeight));
    old?.keys.forEach((key) => add(byKey.get(key), 1));
    let best: NetTopology | undefined,
      score = 0;
    for (const [c, rank] of ranks) {
      if (rank > score || (rank === score && c.wireIds[0] < best!.wireIds[0])) {
        best = c;
        score = rank;
      }
    }
    if (best) {
      if (!claims.has(best)) claims.set(best, []);
      claims.get(best)!.push({ net, score });
    }
  }
  const used = new Set<string>();
  const nets = components.map((c): Net => {
    const choices = (claims.get(c) ?? []).sort(
      (a, b) =>
        Number(b.net.anchor === c.driver) - Number(a.net.anchor === c.driver) ||
        b.score - a.score ||
        Number(!!b.net.name) - Number(!!a.net.name) ||
        a.net.id.localeCompare(b.net.id),
    );
    const retained = choices.find(({ net }) => !used.has(net.id))?.net;
    const id = retained?.id ?? newNetId();
    used.add(id);
    const names = [
      ...new Set(
        choices
          .flatMap(({ net }) => [net.name, ...(net.aliases ?? [])])
          .filter((name): name is string => !!name),
      ),
    ];
    const name = retained?.name || names[0];
    const aliases = names.filter((n) => n !== name);
    const anchor =
      c.driver ??
      (retained && c.keys.has(retained.anchor)
        ? retained.anchor
        : ([...c.keys].find((k) => !k.startsWith('j:')) ?? [...c.keys][0]));
    const label =
      retained?.label && c.wireIds.includes(retained.label.wireId)
        ? retained.label
        : undefined;
    return {
      id,
      anchor,
      wireIds: c.wireIds,
      ...(name ? { name } : {}),
      ...(aliases.length ? { aliases } : {}),
      ...(label ? { label } : {}),
      ...(choices.some(({ net }) => net.logged) ? { logged: true } : {}),
      ...(retained?.hidden ? { hidden: true } : {}),
    };
  });
  // Retain order and references for geometry-only edits and idempotent loads.
  const order = new Map(candidates.map((n, i) => [n.id, i]));
  nets.sort(
    (a, b) => (order.get(a.id) ?? Infinity) - (order.get(b.id) ?? Infinity),
  );
  if (JSON.stringify(next.nets) === JSON.stringify(nets)) return next;
  return { ...next, nets };
}

export function netForWire(project: Project, wireId: string) {
  return project.nets?.find((n) => n.wireIds.includes(wireId));
}

export function renameNet(project: Project, id: string, value: string) {
  const requested = value.trim();
  const current = project.nets?.find((n) => n.id === id);
  if (!current) return project;
  const name =
    requested === automaticNetName(project, current)
      ? ''
      : requested.slice(0, 120);
  if ((current.name ?? '') === name) return project;
  return {
    ...project,
    nets: project.nets!.map((n) => {
      if (n.id !== id) return n;
      const { name: _old, aliases: _aliases, ...rest } = n;
      return {
        ...rest,
        ...(name ? { name } : {}),
        ...(name && n.aliases?.filter((a) => a !== name).length
          ? { aliases: n.aliases.filter((a) => a !== name) }
          : {}),
      };
    }),
  };
}

export function describeNets(project: Project) {
  const topology = netTopology(project);
  const byWire = new Map(
    topology.flatMap((c) => c.wireIds.map((id) => [id, c] as const)),
  );
  const blocks = new Map(project.blocks.map((b) => [b.id, b]));
  return (project.nets ?? []).flatMap((net) => {
    const c = byWire.get(net.wireIds[0]);
    if (!c) return [];
    const ports = [...c.keys]
      .filter((k) => !k.startsWith('j:'))
      .flatMap((key) => {
        const at = key.lastIndexOf('.'),
          blockId = key.slice(0, at),
          portId = key.slice(at + 1);
        const port = portOf(project, blockId, portId);
        return port
          ? [
              {
                key,
                blockId,
                portId,
                blockName: blocks.get(blockId)!.definition.name,
                ...port,
              },
            ]
          : [];
      })
      .sort(
        (a, b) =>
          Number(b.direction === 'output') - Number(a.direction === 'output') ||
          a.blockName.localeCompare(b.blockName) ||
          a.portId.localeCompare(b.portId),
      );
    return [
      {
        net,
        name: netDisplayName(project, net),
        automaticName: automaticNetName(project, net),
        domain: c.domain,
        ports,
        junctionIds: c.junctionIds,
      },
    ];
  });
}
export type NetDescription = ReturnType<typeof describeNets>[number];
