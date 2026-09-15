import type { Definition, LibraryCategoryId, Port } from './model';
import { library } from './model';
import { compatible } from './model';
import { fuzzyScore } from './fuzzy';

export const libraryCategories: {
  id: LibraryCategoryId;
  label: string;
  hint: string;
}[] = [
  { id: 'sources', label: 'Sources', hint: 'References and waveforms' },
  { id: 'math', label: 'Math', hint: 'Gains, sums, products' },
  { id: 'continuous', label: 'Continuous', hint: 's-domain dynamics' },
  { id: 'discrete', label: 'Discrete', hint: 'Sampled operators' },
  { id: 'nonlinear', label: 'Nonlinear', hint: 'Limits and relays' },
  { id: 'routing', label: 'Routing', hint: 'Mux, switch, subsystem' },
  { id: 'control', label: 'Control', hint: 'PI, PID, transforms' },
  { id: 'sinks', label: 'Sinks', hint: 'Scopes and displays' },
  { id: 'electrical', label: 'Electrical', hint: 'Circuits and machines' },
  { id: 'mechanical', label: 'Mechanical', hint: 'Inertia, sensors, load' },
];

const kindCategory: Record<string, LibraryCategoryId> = {
  constant: 'sources',
  step: 'sources',
  ramp: 'sources',
  sine: 'sources',
  pulse: 'sources',
  clock: 'sources',
  gain: 'math',
  sum: 'math',
  subtract: 'math',
  product: 'math',
  divide: 'math',
  abs: 'math',
  sign: 'math',
  sqrt: 'math',
  min: 'math',
  max: 'math',
  sineOp: 'math',
  cosineOp: 'math',
  unaryMinus: 'math',
  power: 'math',
  integrator: 'continuous',
  derivative: 'continuous',
  filter: 'continuous',
  secondOrder: 'continuous',
  delay: 'continuous',
  pid: 'control',
  pi: 'control',
  currentPI: 'control',
  clarke: 'control',
  park: 'control',
  inversePark: 'control',
  unitDelay: 'discrete',
  zoh: 'discrete',
  discreteIntegrator: 'discrete',
  saturation: 'nonlinear',
  deadzone: 'nonlinear',
  relay: 'nonlinear',
  rateLimiter: 'nonlinear',
  mux: 'routing',
  demux: 'routing',
  switch2: 'routing',
  manualSwitch: 'routing',
  terminator: 'sinks',
  subsystem: 'routing',
  scope: 'sinks',
  display: 'sinks',
  voltage: 'electrical',
  ground: 'electrical',
  resistor: 'electrical',
  capacitor: 'electrical',
  inductor: 'electrical',
  diode: 'electrical',
  motor: 'electrical',
  pmsm: 'electrical',
  inverter: 'electrical',
  inertia: 'mechanical',
  shaftLoad: 'mechanical',
  sensor: 'mechanical',
  springDamper: 'mechanical',
  torqueSensor: 'mechanical',
};

export function categoryOf(definition: Definition): LibraryCategoryId {
  return (
    definition.category ||
    kindCategory[definition.kind] ||
    (definition.domain === 'electrical'
      ? 'electrical'
      : definition.domain === 'mechanical'
        ? 'mechanical'
        : 'math')
  );
}

export function categoryLabel(id: LibraryCategoryId) {
  return libraryCategories.find((c) => c.id === id)?.label ?? id;
}

function haystack(definition: Definition) {
  return [
    definition.name,
    definition.kind,
    definition.symbol,
    definition.domain,
    ...definition.ports.map((port) => port.domain),
    definition.description,
    categoryLabel(categoryOf(definition)),
    ...(definition.keywords ?? []),
  ].join(' ');
}

export type LibraryHit = { definition: Definition; score: number };

export function searchLibrary(
  query: string,
  category: LibraryCategoryId | 'all' = 'all',
  compatibleWith?: Port,
  definitions: Definition[] = library,
): LibraryHit[] {
  const pool = definitions.filter((definition) => {
    if (category !== 'all' && categoryOf(definition) !== category) return false;
    if (
      compatibleWith &&
      !definition.ports.some((port) => compatible(compatibleWith, port))
    )
      return false;
    return true;
  });
  const trimmed = query.trim();
  if (!trimmed) {
    return pool.map((definition) => ({ definition, score: 0 }));
  }
  return pool
    .map((definition) => {
      const nameScore = fuzzyScore(trimmed, definition.name);
      const allScore = fuzzyScore(trimmed, haystack(definition));
      if (nameScore === null && allScore === null) return null;
      return {
        definition,
        score: Math.max((nameScore ?? 0) * 3, allScore ?? 0),
      };
    })
    .filter((hit): hit is LibraryHit => hit !== null)
    .sort(
      (a, b) =>
        b.score - a.score || a.definition.name.localeCompare(b.definition.name),
    );
}

export function matchingPort(from: Port | undefined, definition: Definition) {
  if (!from) return undefined;
  const ports = definition.ports.filter((port) => compatible(from, port));
  if (from.direction === 'output')
    return (
      ports.find(
        (port) =>
          port.direction === 'input' &&
          ['u', 'a', 'in', 'reference'].includes(port.id),
      ) ?? ports.find((port) => port.direction === 'input')
    );
  if (from.direction === 'input')
    return (
      ports.find(
        (port) => port.direction === 'output' && ['y', 'out'].includes(port.id),
      ) ?? ports.find((port) => port.direction === 'output')
    );
  return ports[0];
}
