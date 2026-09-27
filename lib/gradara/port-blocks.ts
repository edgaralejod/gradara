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

/** Library entries for adding ports inside a subsystem; the inspector sets their domain. */
export const portBlocks: Definition[] = [
  {
    ...boundaryDefinition('inport', 'in', 'signal', 0),
    name: 'Subsystem input',
    keywords: ['inport', 'port', 'hierarchy'],
  },
  {
    ...boundaryDefinition('outport', 'out', 'signal', 0),
    name: 'Subsystem output',
    keywords: ['outport', 'port', 'hierarchy'],
  },
  {
    ...boundaryDefinition('connport', 'terminal', 'electrical', 0),
    name: 'Subsystem terminal',
    keywords: ['port', 'connection', 'physical', 'hierarchy'],
  },
];

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
