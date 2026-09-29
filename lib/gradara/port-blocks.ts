import type { Definition, Domain, Port } from './model';

/** Boundary kinds: the direction the matching port has on the outside of the subsystem. */
export const boundaryKinds = {
  inport: 'input',
  outport: 'output',
  connport: 'physical',
} as const;
export type BoundaryKind = keyof typeof boundaryKinds;

/** A boundary block: the inside end of one subsystem port. */
export function boundaryDefinition(
  kind: BoundaryKind,
  name: string,
  domain: Domain,
  order: number,
  side?: Port['side'],
): Definition {
  const inner: Port =
    kind === 'inport'
      ? { id: 'y', name, direction: 'output', domain, side: 'right' }
      : kind === 'outport'
        ? { id: 'u', name, direction: 'input', domain, side: 'left' }
        : {
            id: 'p',
            name,
            direction: 'physical',
            domain,
            side: side === 'right' ? 'left' : 'right',
          };
  return {
    kind,
    name,
    description:
      kind === 'connport'
        ? `Physical ${domain} terminal of the subsystem.`
        : `Subsystem ${kind === 'inport' ? 'input' : 'output'}.`,
    domain,
    symbol: kind === 'connport' ? '⊙' : String(order + 1),
    ports: [inner],
    parameters: [],
    equations: '',
    category: 'routing',
    boundary: { order, ...(side ? { side } : {}) },
  };
}

/**
 * The library's subsystem ports: an input and an output. Each starts as a signal;
 * its Type in the inspector makes it Boolean or a physical terminal, and dropped
 * from a wire it becomes what that wire needs (`boundaryFor`).
 */
const portKeywords = [
  'port',
  'hierarchy',
  'terminal',
  'connection',
  'physical',
];
export const portBlocks: Definition[] = [
  {
    ...boundaryDefinition('inport', 'in', 'signal', 0),
    name: 'Subsystem input',
    description:
      'An input of the subsystem you are in. Set its type (signal, Boolean, or a physical domain) in its properties.',
    category: 'subsystems',
    keywords: ['inport', 'input', ...portKeywords],
  },
  {
    ...boundaryDefinition('outport', 'out', 'signal', 0),
    name: 'Subsystem output',
    description:
      'An output of the subsystem you are in. Set its type (signal, Boolean, or a physical domain) in its properties.',
    category: 'subsystems',
    keywords: ['outport', 'output', ...portKeywords],
  },
];

/** The subsystem port a wire from `from` needs: it drives an input, is driven by an output, or joins a physical net. */
export function boundaryFor(
  from: Port | undefined,
  base: Definition,
): Definition {
  if (!from) return base;
  const kind: BoundaryKind =
    from.direction === 'physical'
      ? 'connport'
      : from.direction === 'output'
        ? 'outport'
        : 'inport';
  if (!boundaryDomains(kind).includes(from.domain)) return base;
  const name =
    kind === 'inport' ? 'in' : kind === 'outport' ? 'out' : 'terminal';
  return {
    ...base,
    ...boundaryDefinition(kind, name, from.domain, base.boundary?.order ?? 0),
    name,
    category: base.category,
    keywords: base.keywords,
  };
}

/** Domains a boundary block can take: causal ones for inputs and outputs, physical ones for terminals. */
export const boundaryDomains = (kind: BoundaryKind): Domain[] =>
  kind === 'connport'
    ? [
        'electrical',
        'mechanical',
        'translational',
        'thermal',
        'magnetic',
        'threePhase',
      ]
    : ['signal', 'boolean'];
