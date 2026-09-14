import type { Block, Net, Project } from './model';

const blockIndexes = new WeakMap<Project['blocks'], Map<string, Block>>();

/** Names belong to block instances; library definitions are never mutated. */
export function normalizeBlockNames(
  project: Project,
  previous?: Project,
): Project {
  const oldNames = new Map(
    previous?.blocks.map((b) => [b.id, b.definition.name]),
  );
  const requested = project.blocks.map(
    (b) =>
      b.definition.name.trim().slice(0, 100) || b.definition.kind.slice(0, 100),
  );
  // Reserve every requested name up front. Repairing a duplicate Step must not
  // steal Step1 from a distinct block that already has that name.
  const occupied = new Set(requested);
  const owners = new Map<string, string>();
  project.blocks.forEach((b, i) => {
    const name = requested[i];
    if (
      !owners.has(name) ||
      (oldNames.get(b.id) === name && oldNames.get(owners.get(name)!) !== name)
    )
      owners.set(name, b.id);
  });
  let changed = false;
  const blocks = project.blocks.map((b, i) => {
    const requestedName = requested[i];
    const name =
      owners.get(requestedName) === b.id
        ? requestedName
        : nextAvailableName(requestedName, occupied);
    occupied.add(name);
    if (name === b.definition.name) return b;
    changed = true;
    return { ...b, definition: { ...b.definition, name } };
  });
  return changed ? { ...project, blocks } : project;
}

export function nextAvailableName(
  requested: string,
  occupied: ReadonlySet<string>,
) {
  if (!occupied.has(requested)) return requested;
  const match = /^(.*?)(\d+)$/.exec(requested);
  const numbered =
    match &&
    match[1] &&
    Number.isSafeInteger(Number(match[2])) &&
    Number(match[2]) < Number.MAX_SAFE_INTEGER - occupied.size - 1;
  const stem = numbered ? match[1] : requested;
  let suffix = numbered ? Number(match[2]) + 1 : 1;
  for (;;) {
    const tail = String(suffix++);
    const candidate = stem.slice(0, 100 - tail.length) + tail;
    if (!occupied.has(candidate)) return candidate;
  }
}

/** Derived from the anchor port, so branching and record direction do not rename
 * a signal. Physical nets use the same stable terminal rule, without a driver.
 * The persistent net.name is only a user override, never a cached auto-name.
 */
export function automaticNetName(project: Project, net: Net) {
  const split = net.anchor.lastIndexOf('.');
  if (!net.anchor.startsWith('j:') && split > 0) {
    let blocks = blockIndexes.get(project.blocks);
    if (!blocks) {
      blocks = new Map(project.blocks.map((b) => [b.id, b]));
      blockIndexes.set(project.blocks, blocks);
    }
    const block = blocks.get(net.anchor.slice(0, split));
    const port = block?.definition.ports.find(
      (p) => p.id === net.anchor.slice(split + 1),
    );
    if (block && port) return `${block.definition.name}.${port.id}`;
  }
  // Editable, source-free fragments may consist only of junctions.
  return `Net${Math.max(0, project.nets?.findIndex((n) => n.id === net.id) ?? 0) + 1}`;
}

export function netDisplayName(project: Project, net: Net) {
  return net.name || automaticNetName(project, net);
}
