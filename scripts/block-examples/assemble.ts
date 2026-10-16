/**
 * Assemble a model from a spec with the workbench's own operations: its connection
 * rules (linkEnds) and the saved document boundary (normalizeProject: the sheet grid,
 * junctions, routes, nets), so the result is exactly what a user could build. The
 * spec places its blocks; the router draws the wires. The block examples and the
 * curated templates (DC speed loop, FOC) are built this way.
 */
import { defaultBlockSize } from '../../lib/gradara/block-design';
import { library, type Block, type Project } from '../../lib/gradara/model';
import { normalizeProject } from '../../lib/gradara/normalize-project';
import {
  BUS_KINDS,
  busPortsWithCount,
  renamedBusInput,
  selectorPorts,
} from '../../lib/gradara/buses';
import { syncInstances } from '../../lib/gradara/hierarchy';
import { linkEnds } from '../../lib/gradara/project';
import type { ExampleSpec } from './types';

// Deterministic ids, so rebuilding an unchanged spec rewrites identical files.
let counter = 0;
Object.defineProperty(globalThis.crypto, 'randomUUID', {
  value: () => `id${(++counter).toString(36).padStart(4, '0')}`,
  configurable: true,
});

/** Where a name beside or above a block goes (the canvas draws it under the body). */
export function labelOffset(
  name: string,
  size: { width: number; height: number },
  side: 'left' | 'right' | 'above' | [number, number],
) {
  if (Array.isArray(side)) return { x: side[0], y: side[1] };
  const width = Math.min(240, Math.max(24, name.length * 8));
  if (side === 'above') return { x: 0, y: -size.height - 32 };
  const x = size.width / 2 + width / 2 + 8;
  return { x: side === 'right' ? x : -x, y: -size.height / 2 - 14 };
}

/** Modelica keywords and built-ins an instance id must not shadow. */
const RESERVED = new Set(
  'algorithm and annotation block break class connect connector constant constrainedby der discrete each else elseif elsewhen encapsulated end enumeration equation expandable extends external false final flow for function if import impure in initial inner input loop model not operator or outer output package parameter partial protected public pure record redeclare replaceable return stream then time true type when while within'.split(
    ' ',
  ),
);

export function instance(
  spec: ExampleSpec,
  [
    id,
    kind,
    name,
    [cx, cy],
    params = {},
    options,
  ]: ExampleSpec['blocks'][number],
): Block {
  if (RESERVED.has(id))
    throw new Error(`${spec.id}: ${id} is a Modelica keyword`);
  const found = library.find((d) => d.kind === kind);
  if (!found) throw new Error(`${spec.id}: unknown block kind ${kind}`);
  const definition = structuredClone(found);
  definition.name = name;
  for (const [key, value] of Object.entries(params)) {
    const parameter = definition.parameters.find((p) => p.id === key);
    if (!parameter)
      throw new Error(`${spec.id}: ${kind} has no parameter ${key}`);
    parameter.value = value;
  }
  const { rotation, flip, label, ports, signals, tag } =
    typeof options === 'number'
      ? {
          rotation: options,
          flip: undefined,
          tag: undefined,
          label: undefined,
          ports: undefined,
          signals: undefined,
        }
      : (options ?? {});
  if (signals !== undefined) {
    if (!BUS_KINDS.has(kind))
      throw new Error(`${spec.id}: ${kind} is not a bus block`);
    if (typeof signals === 'number')
      definition.ports = busPortsWithCount(definition, signals);
    else if (kind === 'busSelector')
      definition.ports = selectorPorts(
        { ...definition, ports: [definition.ports[0]] },
        signals,
      );
    else {
      definition.ports = busPortsWithCount(definition, signals.length);
      signals.forEach((name, i) => {
        definition.ports = renamedBusInput(definition, `u${i + 1}`, name);
      });
    }
  }
  for (const [portId, place] of Object.entries(ports ?? {})) {
    const port = definition.ports.find((p) => p.id === portId);
    if (!port) throw new Error(`${spec.id}: ${kind} has no port ${portId}`);
    const [side, offset] = Array.isArray(place) ? place : [place, undefined];
    if (
      (port.direction === 'input' && side === 'right') ||
      (port.direction === 'output' && side === 'left')
    )
      throw new Error(
        `${spec.id}: ${id}.${portId} would point backward; flip the block instead`,
      );
    port.side = side;
    if (offset === undefined) delete port.offset;
    else port.offset = offset;
  }
  if (tag !== undefined) {
    definition.tag = tag;
    definition.symbol = tag;
  }
  const standard = defaultBlockSize(definition);
  const size =
    rotation === 90 || rotation === 270
      ? { width: standard.height, height: standard.width }
      : standard;
  return {
    id,
    definition,
    position: { x: cx - size.width / 2, y: cy - size.height / 2 },
    size,
    ...(rotation ? { rotation } : {}),
    ...(flip ? { flip } : {}),
    ...(label ? { labelOffset: labelOffset(name, size, label) } : {}),
  };
}

export function assemble(spec: ExampleSpec): Project {
  counter = 0;
  let doc: Project = {
    version: 1,
    name: `Example: ${spec.title}`,
    exampleId: `block-${spec.id}`,
    description: spec.description,
    duration: spec.duration,
    revision: 0,
    blocks: spec.blocks.map((b) => instance(spec, b)),
    wires: [],
    junctions: [],
    nets: [],
    annotations: [],
    plots: [],
  };
  for (const [from, to] of spec.links) {
    const [a, ah] = from.split('.'),
      [b, bh] = to.split('.');
    for (const [id, handle] of [
      [a, ah],
      [b, bh],
    ])
      if (
        !doc.blocks
          .find((x) => x.id === id)
          ?.definition.ports.some((p) => p.id === handle)
      )
        throw new Error(`${spec.id}: no port ${id}.${handle}`);
    try {
      doc = linkEnds(doc, { id: a, handle: ah }, { id: b, handle: bh });
    } catch (e) {
      throw new Error(`${spec.id}: ${from} → ${to}: ${(e as Error).message}`);
    }
  }
  // Twice: junction dots settle on the second pass. Then bus widths follow the wiring.
  doc = syncInstances(normalizeProject(normalizeProject(doc)));
  if (spec.finish) doc = spec.finish(doc);
  delete doc.modelId;
  doc.plots = spec.plots.map((plot, i) => ({
    id: `plot${i + 1}`,
    label: plot.label,
    series: plot.series,
    ...(plot.labels ? { labels: plot.labels } : {}),
  }));
  for (const plot of doc.plots)
    for (const key of plot.series) {
      const [id, port] = key.split('.');
      if (
        !doc.blocks
          .find((b) => b.id === id)
          ?.definition.ports.some(
            (p) => p.id === port && p.direction === 'output',
          )
      )
        throw new Error(`${spec.id}: plot series ${key} is not an output`);
    }
  return doc;
}
