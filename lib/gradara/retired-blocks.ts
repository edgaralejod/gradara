import type { Definition, Port, Parameter } from './model';

/**
 * Blocks no longer offered in the library. A document carries its blocks'
 * definitions, so models made before a block was retired still open and run;
 * these definitions only give such blocks their names in the model browser.
 * The engine's hand-written Modelica for the physical ones is `PHYSICAL` in
 * server/modelica.py. See lib/gradara/model.ts `RETIRED_KINDS`.
 */

const input = (id: string, name = id, side: Port['side'] = 'left'): Port => ({
  id,
  name,
  direction: 'input',
  domain: 'signal',
  side,
});
const output = (
  id: string,
  name = id,
  unit = '',
  side: Port['side'] = 'right',
): Port => ({ id, name, direction: 'output', domain: 'signal', side, unit });
const p = (
  id: string,
  name: string,
  value: number,
  unit = '',
  min?: number,
): Parameter => ({ id, name, value, unit, min });
const physical = (
  id: string,
  name: string,
  domain: Port['domain'],
  side: Port['side'],
): Port => ({ id, name, domain, side, direction: 'physical' });
const signal = (
  kind: string,
  name: string,
  symbol: string,
  ports: Port[],
  equations: string,
  parameters: Parameter[] = [],
  declarations = '',
  description = name,
): Definition => ({
  kind,
  name,
  symbol,
  domain: 'signal',
  description,
  ports,
  equations,
  parameters,
  declarations,
});
const sink = (
  kind: string,
  name: string,
  symbol: string,
  description: string,
) =>
  signal(
    kind,
    name,
    symbol,
    [input('u')],
    'unused = u;',
    [],
    'Real unused;',
    description,
  );

export const retiredBlocks: Definition[] = [
  // Sinks (0.6.1): any output can be logged for Results, wired or not, so they added nothing.
  sink(
    'terminator',
    'Terminator',
    'term',
    'Cap an unused output so the sheet stays tidy.',
  ),
  sink(
    'scope',
    'Scope',
    'scope',
    'A drawing sink for a signal you intend to inspect.',
  ),
  sink(
    'display',
    'Display',
    '123',
    'A sink that marks a signal whose value you want to read.',
  ),
  // Duplicates of library blocks (0.7.1): the names say which block replaced each.
  {
    ...signal(
      'currentPI',
      'Current PI',
      'PI',
      [input('u', 'e'), output('y', 'v', 'V')],
      'raw = kp*u + x;\ny = max(-limit, min(limit, raw));\nder(x) = ki*u + kaw*(y-raw);',
      [
        p('kp', 'Proportional gain', 2),
        p('ki', 'Integral gain', 700),
        p('kaw', 'Anti-windup gain', 350, '1/s', 0),
        p('limit', 'Voltage limit', 27, 'V', 0.1),
      ],
      'Real x(start=0, fixed=true);\nReal raw;',
      'Continuous PI with back-calculation anti-windup. Replaced by PI (continuous).',
    ),
    controller: true,
  },
  {
    ...signal(
      'pid',
      'PID',
      'PID',
      [input('u', 'e'), output('y')],
      'der(xi) = u;\nder(xf) = (u - xf)/tf;\ny = kp*u + ki*xi + kd*(u - xf)/tf;',
      [
        p('kp', 'Proportional gain', 1),
        p('ki', 'Integral gain', 0.5),
        p('kd', 'Derivative gain', 0.05),
        p('tf', 'Derivative filter', 0.01, 's', 0.0001),
      ],
      'Real xi(start=0, fixed=true);\nReal xf(start=0, fixed=true);',
      'Parallel PID with a filtered derivative term. Replaced by PID (continuous).',
    ),
    controller: true,
  },
  signal(
    'inversePark',
    'Inverse transforms',
    'dq→abc',
    [
      input('vd', 'd'),
      input('vq', 'q'),
      input('theta', 'θe', 'bottom'),
      output('va', 'a', 'V'),
      output('vb', 'b', 'V'),
      output('vc', 'c', 'V'),
    ],
    'alpha = vd*cos(theta)-vq*sin(theta);\nbeta = vd*sin(theta)+vq*cos(theta);\nva = alpha;\nvb = -alpha/2 + sqrt(3)*beta/2;\nvc = -alpha/2 - sqrt(3)*beta/2;',
    [],
    'Real alpha;\nReal beta;',
    'Inverse Park and inverse Clarke in one block. Replaced by Park transform (fed −θ) and Inverse Clarke transform.',
  ),
  {
    ...signal(
      'inverter',
      'Three-phase inverter',
      'inverter',
      [
        input('ua', 'a*'),
        input('ub', 'b*'),
        input('uc', 'c*'),
        output('va', 'a', 'V'),
        output('vb', 'b', 'V'),
        output('vc', 'c', 'V'),
      ],
      'offset = (max(ua,max(ub,uc))+min(ua,min(ub,uc)))/2;\nva = max(-Vdc/2,min(Vdc/2,ua-offset));\nvb = max(-Vdc/2,min(Vdc/2,ub-offset));\nvc = max(-Vdc/2,min(Vdc/2,uc-offset));',
      [p('Vdc', 'DC bus voltage', 48, 'V', 1)],
      'Real offset;',
      'Averaged inverter with common-mode injection and DC-bus clipping. Replaced by Controlled 3-phase voltage.',
    ),
    domain: 'electrical',
  },
  {
    kind: 'pmsm',
    name: 'PMSM (signal ports)',
    symbol: 'pmsm',
    domain: 'electrical',
    description:
      'dq model with signal-port phase voltages and ideal measurements. Replaced by the Modelica PMSM.',
    ports: [
      input('va', 'a'),
      input('vb', 'b'),
      input('vc', 'c'),
      physical('flange', 'shaft', 'mechanical', 'right'),
      output('ia', 'ia', 'A', 'bottom'),
      output('ib', 'ib', 'A', 'bottom'),
      output('ic', 'ic', 'A', 'bottom'),
      output('theta', 'θe', 'rad', 'bottom'),
      output('wm', 'ω', 'rad/s', 'top'),
      output('rpm', 'rpm', 'rpm', 'top'),
      output('torque', 'Te', 'N·m', 'top'),
    ],
    parameters: [
      p('R', 'Stator resistance', 0.35, 'Ω', 0.001),
      p('Ld', 'd-axis inductance', 0.001, 'H', 0.000001),
      p('Lq', 'q-axis inductance', 0.001, 'H', 0.000001),
      p('psi', 'PM flux linkage', 0.035, 'Wb', 0.0001),
      p('polePairs', 'Pole pairs', 4, '', 1),
    ],
    equations:
      'Ld*der(id) = vd - R*id + we*Lq*iq;\nLq*der(iq) = vq - R*iq - we*(Ld*id + psi);\ntorque = 1.5*polePairs*(psi*iq + (Ld-Lq)*id*iq);',
  },
  {
    kind: 'shaftLoad',
    name: 'Mechanical load',
    symbol: 'J',
    domain: 'mechanical',
    description:
      'Inertia, viscous friction and a load torque step in one block. Replaced by Inertia, Torsion damper and Torque step.',
    ports: [
      physical('flange', 'shaft', 'mechanical', 'left'),
      output('loadTorque', 'TL', 'N·m', 'bottom'),
    ],
    parameters: [
      p('J', 'Inertia', 0.002, 'kg·m²', 0.00001),
      p('damping', 'Viscous friction', 0.001, 'N·m·s', 0),
      p('initialLoad', 'Initial load torque', 0.05, 'N·m'),
      p('stepLoad', 'Added load torque', 0.35, 'N·m'),
      p('loadTime', 'Load step time', 0.45, 's', 0),
    ],
    equations:
      'loadTorque = initialLoad + (if time < loadTime then 0 else stepLoad);\nJ*der(w) = flange.tau - damping*w - loadTorque;',
  },
  {
    kind: 'voltage',
    name: 'Voltage drive',
    description:
      'An ideal voltage source driven by a control signal. Replaced by Controlled voltage.',
    domain: 'electrical',
    symbol: 'V',
    ports: [
      input('u'),
      physical('p', '+', 'electrical', 'right'),
      physical('n', '−', 'electrical', 'bottom'),
    ],
    parameters: [],
    equations: 'v = u;',
  },
  {
    kind: 'motor',
    name: 'DC motor',
    description:
      'Armature resistance and inductance coupled to a rotational shaft. Replaced by DC machine (PM).',
    domain: 'electrical',
    symbol: 'M',
    ports: [
      physical('p', '+', 'electrical', 'left'),
      physical('n', '−', 'electrical', 'bottom'),
      physical('flange', 'shaft', 'mechanical', 'bottom'),
    ],
    parameters: [
      p('R', 'Resistance', 1.2, 'Ω', 0.001),
      p('L', 'Inductance', 0.02, 'H', 0.00001),
      p('k', 'Motor constant', 0.15, 'N·m/A', 0.0001),
    ],
    equations: 'L*der(i) = v - R*i - k*w;\ntau = k*i;',
  },
  {
    kind: 'inertia',
    name: 'Inertia & load',
    description:
      'A rotating load with inertia and viscous friction. Replaced by Inertia and Torsion damper.',
    domain: 'mechanical',
    symbol: 'J',
    ports: [
      physical('a', 'shaft', 'mechanical', 'top'),
      physical('b', 'shaft', 'mechanical', 'left'),
    ],
    parameters: [
      p('J', 'Inertia', 0.02, 'kg·m²', 0.00001),
      p('damping', 'Viscous friction', 0.002, 'N·m·s', 0),
    ],
    equations: 'J*der(w) = tau - damping*w;',
  },
  {
    kind: 'sensor',
    name: 'Speed sensor',
    description:
      'Measures shaft speed without loading it. Replaced by the Modelica Speed sensor.',
    domain: 'mechanical',
    symbol: 'ω',
    ports: [
      physical('flange', 'shaft', 'mechanical', 'right'),
      output('y', 'out', 'rad/s', 'left'),
    ],
    parameters: [],
    equations: 'y = der(flange.phi);\nflange.tau = 0;',
  },
  {
    kind: 'diode',
    name: 'Diode',
    symbol: 'D',
    domain: 'electrical',
    description:
      'An ideal diode with a fixed 0.1 mΩ on-resistance. Replaced by Ideal diode.',
    ports: [
      physical('p', 'A', 'electrical', 'left'),
      physical('n', 'K', 'electrical', 'right'),
    ],
    parameters: [],
    equations: 'i = if v > 0 then v/1e-4 else 0;',
  },
  {
    kind: 'springDamper',
    name: 'Spring-damper',
    symbol: 'c,d',
    domain: 'mechanical',
    description:
      'Rotational spring and damper between two shafts. Replaced by Torsion spring and Torsion damper.',
    ports: [
      physical('a', 'a', 'mechanical', 'left'),
      physical('b', 'b', 'mechanical', 'right'),
    ],
    parameters: [
      p('c', 'Stiffness', 10, 'N·m/rad', 0),
      p('d', 'Damping', 0.1, 'N·m·s', 0),
    ],
    equations: 'tau = c*phi + d*w;',
  },
  {
    kind: 'idealSwitch',
    name: 'Ideal switch',
    domain: 'electrical',
    symbol: 'switch',
    description:
      'Ideal switch closed while its signal gate is above 0.5. Replaced by Switch (Boolean).',
    ports: [
      physical('p', '+', 'electrical', 'top'),
      physical('n', '−', 'electrical', 'bottom'),
      input('gate', 'g'),
    ],
    parameters: [],
    equations:
      'p.i + n.i = 0;\nif gate > 0.5 then\n  p.v = n.v;\nelse\n  p.i = 0;\nend if;',
  },
  {
    kind: 'pwmPair',
    name: 'Complementary PWM',
    domain: 'signal',
    symbol: 'PWM',
    description:
      'Complementary 0/1 gate signals at a fixed frequency and duty cycle. Replaced by PWM generator.',
    ports: [output('high', 'hi'), output('low', 'lo')],
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
  },
];
