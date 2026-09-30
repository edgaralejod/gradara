/**
 * Terminator marks: an output left unconnected on purpose, drawn capped as
 * Simulink's Terminator draws it, but without a block. The mark is presentation
 * only; nothing is emitted for it. It lives on the block (`Block.terminated`) and
 * goes away when a wire reaches the port or the port no longer exists.
 */
import type { Block, Project } from './model';

/** Ports that some wire on the sheet ends on, as `block.port`. */
function wiredPorts(project: Pick<Project, 'wires'>) {
  const wired = new Set<string>();
  for (const w of project.wires) {
    wired.add(`${w.source}.${w.sourceHandle}`);
    wired.add(`${w.target}.${w.targetHandle}`);
  }
  return wired;
}

/** A block's outputs with no wire: the ones a terminator can cap. */
export function openOutputs(project: Pick<Project, 'wires'>, block: Block) {
  const wired = wiredPorts(project);
  return block.definition.ports
    .filter(
      (p) => p.direction === 'output' && !wired.has(`${block.id}.${p.id}`),
    )
    .map((p) => p.id);
}

const withMarks = (block: Block, ports: string[]): Block => {
  if (ports.length) return { ...block, terminated: ports };
  const { terminated: _gone, ...rest } = block;
  return rest;
};

/** Cap every open output of the given blocks. */
export function terminateOpenOutputs(
  project: Project,
  blockIds: string[],
): Project {
  const ids = new Set(blockIds);
  let changed = false;
  const blocks = project.blocks.map((b) => {
    if (!ids.has(b.id)) return b;
    const ports = [
      ...new Set([...(b.terminated ?? []), ...openOutputs(project, b)]),
    ];
    if (ports.length === (b.terminated?.length ?? 0)) return b;
    changed = true;
    return withMarks(b, ports);
  });
  return changed ? { ...project, blocks } : project;
}

/** Remove the terminator marks of the given blocks. */
export function removeTerminators(
  project: Project,
  blockIds: string[],
): Project {
  const ids = new Set(blockIds);
  if (!project.blocks.some((b) => ids.has(b.id) && b.terminated))
    return project;
  return {
    ...project,
    blocks: project.blocks.map((b) =>
      ids.has(b.id) && b.terminated ? withMarks(b, []) : b,
    ),
  };
}

/** Drop marks on ports that now have a wire or no longer exist. */
export function settleTerminators<T extends Pick<Project, 'blocks' | 'wires'>>(
  sheet: T,
): T {
  if (!sheet.blocks.some((b) => b.terminated)) return sheet;
  const wired = wiredPorts(sheet);
  let changed = false;
  const blocks = sheet.blocks.map((b) => {
    if (!b.terminated) return b;
    const keep = b.terminated.filter(
      (id) =>
        !wired.has(`${b.id}.${id}`) &&
        b.definition.ports.some((p) => p.id === id && p.direction === 'output'),
    );
    if (keep.length === b.terminated.length) return b;
    changed = true;
    return withMarks(b, keep);
  });
  return changed ? { ...sheet, blocks } : sheet;
}
