import type { Definition, Port } from './model';
const pin = (id: string, side: Port['side']): Port => ({
  id,
  name: id === 'p' ? '+' : '−',
  domain: 'electrical',
  direction: 'physical',
  side,
});
const signal = (
  id: string,
  name: string,
  direction: 'input' | 'output',
  side: Port['side'],
  unit = '',
): Port => ({ id, name, direction, side, domain: 'signal', unit });
export const powerBlocks: Definition[] = [
  {
    kind: 'dcSource',
    name: 'DC voltage',
    domain: 'electrical',
    category: 'electrical',
    symbol: 'DC',
    description: 'An ideal constant DC voltage source.',
    ports: [pin('p', 'top'), pin('n', 'bottom')],
    parameters: [{ id: 'V', name: 'Voltage', value: 24, unit: 'V' }],
    equations: 'p.v - n.v = V;\np.i + n.i = 0;',
    keywords: ['supply', 'battery', 'dc', 'power'],
  },
  {
    kind: 'idealSwitch',
    name: 'Ideal switch',
    domain: 'electrical',
    category: 'electrical',
    symbol: 'switch',
    description:
      'Ideal bidirectional power switch. Gate above 0.5 closes the switch; zero on-resistance and zero off-conductance.',
    ports: [
      pin('p', 'top'),
      pin('n', 'bottom'),
      signal('gate', 'g', 'input', 'left'),
    ],
    parameters: [],
    equations:
      'p.i + n.i = 0;\nif gate > 0.5 then\n  p.v = n.v;\nelse\n  p.i = 0;\nend if;',
    keywords: ['mosfet', 'transistor', 'switching', 'buck', 'power'],
  },
  {
    kind: 'voltageSensor',
    name: 'Voltage sensor',
    domain: 'electrical',
    category: 'electrical',
    symbol: 'V',
    description:
      'Measures voltage between two electrical nodes without loading the circuit.',
    ports: [
      pin('p', 'top'),
      pin('n', 'bottom'),
      signal('y', 'V', 'output', 'right', 'V'),
    ],
    parameters: [],
    equations: 'y = p.v - n.v;\np.i = 0;\nn.i = 0;',
    keywords: ['measure', 'voltmeter', 'probe'],
  },
  {
    kind: 'currentSensor',
    name: 'Current sensor',
    domain: 'electrical',
    category: 'electrical',
    symbol: 'A',
    description:
      'Measures branch current with zero series voltage drop; positive from + to −.',
    ports: [
      pin('p', 'left'),
      pin('n', 'right'),
      signal('y', 'A', 'output', 'bottom', 'A'),
    ],
    parameters: [],
    equations: 'y = p.i;\np.v = n.v;\np.i + n.i = 0;',
    keywords: ['measure', 'ammeter', 'probe'],
  },
  {
    kind: 'pwmPair',
    name: 'Complementary PWM',
    domain: 'signal',
    category: 'control',
    symbol: 'PWM',
    description:
      'Complementary 0/1 gate signals at a fixed frequency and duty cycle. Ideal simultaneous switching, with no dead time.',
    ports: [
      signal('high', 'hi', 'output', 'right'),
      signal('low', 'lo', 'output', 'right'),
    ],
    parameters: [
      {
        id: 'frequency',
        name: 'Frequency',
        value: 10000,
        unit: 'Hz',
        min: 1,
        max: 1000000,
      },
      { id: 'duty', name: 'Duty cycle', value: 0.5, unit: '', min: 0, max: 1 },
    ],
    declarations:
      'Modelica.Blocks.Sources.BooleanPulse pulse(width=100*duty, period=1/frequency);',
    equations: 'high = if pulse.y then 1 else 0;\nlow = 1 - high;',
    keywords: ['pwm', 'gate', 'buck', 'duty', 'power'],
  },
];
