import type { Project } from './model';
import {
  boundaryDefinition,
  boundaryDomains,
  boundaryKinds,
  type BoundaryKind,
} from './port-blocks';

type End = { id: string; handle: string };

/**
 * A subsystem port takes the domain of the first thing wired to it, as a Simulink
 * or Simscape port does. A pill with no wires yet, joined to a port of another
 * domain it can carry (a physical port for a terminal, a signal or Boolean port for
 * an input or output), is retyped first; everything else is left as it is.
 */
export function adoptBoundaryDomain(project: Project, a: End, b: End): Project {
  for (const [pill, other] of [
    [a, b],
    [b, a],
  ]) {
    const block = project.blocks.find((x) => x.id === pill.id);
    const d = block?.definition;
    if (!block || !d?.boundary || !(d.kind in boundaryKinds)) continue;
    const inner = d.ports[0];
    if (!inner || inner.id !== pill.handle) continue;
    if (
      project.wires.some((w) => w.source === block.id || w.target === block.id)
    )
      continue;
    const target =
      project.blocks
        .find((x) => x.id === other.id)
        ?.definition.ports.find((p) => p.id === other.handle) ?? undefined;
    if (!target || target.domain === inner.domain) continue;
    const kind = d.kind as BoundaryKind;
    const fits =
      boundaryDomains(kind).includes(target.domain) &&
      (kind === 'connport'
        ? target.direction === 'physical'
        : kind === 'inport'
          ? target.direction === 'input'
          : target.direction === 'output');
    if (!fits) continue;
    const next = boundaryDefinition(
      kind,
      d.name,
      target.domain,
      d.boundary.order,
      d.boundary.side,
    );
    return {
      ...project,
      blocks: project.blocks.map((x) =>
        x.id === block.id
          ? {
              ...x,
              definition: {
                ...next,
                name: d.name,
                symbol: d.symbol,
                ...(d.category ? { category: d.category } : {}),
              },
            }
          : x,
      ),
    };
  }
  return project;
}
