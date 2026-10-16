import type { Project } from './model';
import {
  boundaryDefinition,
  boundaryDomains,
  boundaryKinds,
  type BoundaryKind,
} from './port-blocks';
import { isTagKind, tagDefinition, tagDomains } from './tag-blocks';
import { BUS_PORT, ELEMENT_DOMAINS, isPhysicalBus } from './physical-bus';

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
    // A Goto, From, or connection label takes its domain the same way.
    if (block && d && isTagKind(d.kind)) {
      const inner = d.ports[0];
      if (!inner || inner.id !== pill.handle) continue;
      if (
        project.wires.some(
          (w) => w.source === block.id || w.target === block.id,
        )
      )
        continue;
      const target = project.blocks
        .find((x) => x.id === other.id)
        ?.definition.ports.find((p) => p.id === other.handle);
      if (!target || target.domain === inner.domain) continue;
      const wants =
        d.kind === 'goto' ? 'output' : d.kind === 'from' ? 'input' : 'physical';
      if (
        target.direction !== wants ||
        !tagDomains(d.kind).includes(target.domain)
      )
        continue;
      const next = tagDefinition(d.kind, d.tag ?? '', target.domain);
      return {
        ...project,
        blocks: project.blocks.map((x) =>
          x.id === block.id
            ? { ...x, definition: { ...next, name: d.name } }
            : x,
        ),
      };
    }
    // A Physical bus element takes the type of the first terminal wired to it.
    if (block && d && isPhysicalBus(d) && pill.handle !== BUS_PORT) {
      const inner = d.ports.find((p) => p.id === pill.handle);
      if (!inner) continue;
      if (
        project.wires.some(
          (w) =>
            (w.source === block.id && w.sourceHandle === inner.id) ||
            (w.target === block.id && w.targetHandle === inner.id),
        )
      )
        continue;
      const target = project.blocks
        .find((x) => x.id === other.id)
        ?.definition.ports.find((p) => p.id === other.handle);
      if (
        !target ||
        target.domain === inner.domain ||
        target.direction !== 'physical' ||
        !ELEMENT_DOMAINS.includes(target.domain)
      )
        continue;
      return {
        ...project,
        blocks: project.blocks.map((x) =>
          x.id === block.id
            ? {
                ...x,
                definition: {
                  ...d,
                  ports: d.ports.map((p) =>
                    p.id === inner.id ? { ...p, domain: target.domain } : p,
                  ),
                },
              }
            : x,
        ),
      };
    }
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
