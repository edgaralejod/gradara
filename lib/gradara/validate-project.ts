import type { Diagnostic } from './api';
import type { Project } from './model';
import { flattenWires, isTap } from './net';

const DRAWING_ONLY = new Set(['mux', 'demux', 'subsystem']);

function problem(
  id: string,
  fields: Partial<Diagnostic> & Pick<Diagnostic, 'message'>,
): Diagnostic {
  return {
    id,
    severity: 'error',
    source: 'validation',
    detail: '',
    blockIds: [],
    ports: [],
    netIds: [],
    wireIds: [],
    ...fields,
  };
}

/**
 * Checks the run would reject, plus cheap authoring hints, computed locally
 * while editing. Mirrors `validate_simulation` in server/diagnostics.py.
 */
export function validateProject(project: Project): Diagnostic[] {
  const out: Diagnostic[] = [];
  const blocks = new Map(project.blocks.map((b) => [b.id, b]));
  const connected = new Set<string>();
  for (const w of flattenWires(project)) {
    connected.add(`${w.source}\u0000${w.sourceHandle}`);
    connected.add(`${w.target}\u0000${w.targetHandle}`);
  }
  const wired = new Set<string>();
  for (const w of project.wires) {
    wired.add(w.source);
    wired.add(w.target);
    for (const [id, handle, role] of [
      [w.source, w.sourceHandle, 'source'],
      [w.target, w.targetHandle, 'target'],
    ] as const) {
      if (isTap(project, id)) continue;
      const block = blocks.get(id);
      if (!block || !block.definition.ports.some((p) => p.id === handle))
        out.push(
          problem(`v-wire-${w.id}-${role}`, {
            message: block
              ? `A wire ends on ${block.definition.name}.${handle}, which no longer exists.`
              : 'A wire ends on a block that no longer exists.',
            blockIds: block ? [block.id] : [],
            wireIds: [w.id],
            netIds: (project.nets ?? [])
              .filter((n) => n.wireIds.includes(w.id))
              .map((n) => n.id),
            hint: 'Delete the wire or reconnect it to an existing port.',
          }),
        );
    }
  }
  for (const block of project.blocks) {
    const d = block.definition;
    for (const port of d.ports)
      if (
        port.direction === 'input' &&
        !connected.has(`${block.id}\u0000${port.id}`)
      )
        out.push(
          problem(`v-input-${block.id}-${port.id}`, {
            message: `${d.name}.${port.name} is not connected.`,
            blockIds: [block.id],
            ports: [{ blockId: block.id, portId: port.id }],
            hint: 'Connect a signal source to this input, or remove the block.',
          }),
        );
    if (!d.generated && DRAWING_ONLY.has(d.kind))
      out.push(
        problem(`v-drawing-${block.id}`, {
          message: `${d.name} is drawing-only and cannot be simulated yet.`,
          blockIds: [block.id],
          hint: 'Replace it with explicit signal connections.',
        }),
      );
    if (d.ports.length && !wired.has(block.id))
      out.push(
        problem(`v-isolated-${block.id}`, {
          severity: 'info',
          message: `Nothing is connected to ${d.name}.`,
          blockIds: [block.id],
        }),
      );
  }
  return out;
}

export function countBySeverity(diagnostics: Diagnostic[]) {
  const counts = { error: 0, warning: 0, info: 0 };
  for (const d of diagnostics) counts[d.severity] += 1;
  return counts;
}
