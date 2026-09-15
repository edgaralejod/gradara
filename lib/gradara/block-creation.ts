import type { Definition } from './model';

export const blockTypes = {
  signal: {
    label: 'Signal / control',
    description:
      'Directional scalar inputs and outputs for math and control logic.',
    suggestions: [
      'Low-pass filter with a 50 ms time constant',
      'Deadband of ±0.1',
      'Sine wave at 2 Hz',
    ],
  },
  electrical: {
    label: 'Electrical',
    description:
      'Electrical terminals with voltage and current. Optional signal ports for control and measurement.',
    suggestions: [
      'Ideal transformer with a configurable turns ratio of 2',
      'Resistor with a configurable resistance',
      'Ideal voltage sensor',
    ],
  },
  mechanical: {
    label: 'Mechanical · rotational',
    description:
      'Rotational shafts with angle and torque. Optional signal ports.',
    suggestions: [
      'Rotational damper between two shafts',
      'Torsional spring',
      'Ideal angular velocity sensor',
    ],
  },
  thermal: {
    label: 'Thermal',
    description:
      'Heat terminals with temperature and heat flow. Optional signal ports.',
    suggestions: [
      'Thermal resistance between two heat terminals',
      'Thermal capacitance',
      'Ideal temperature sensor',
    ],
  },
  multidomain: {
    label: 'Multiple physical domains',
    description:
      'Connect at least two of electrical, rotational mechanical, and thermal physics.',
    suggestions: [
      'Resistor with a thermal port for dissipated heat',
      'Ideal electromechanical motor',
    ],
  },
} as const;

export type BlockType = keyof typeof blockTypes;

export function inferBlockType(definition?: Definition): BlockType {
  if (!definition) return 'signal';
  const domains = new Set(
    definition.ports
      .filter((port) => port.direction === 'physical')
      .map((port) => port.domain),
  );
  return domains.size > 1 ? 'multidomain' : definition.domain;
}
