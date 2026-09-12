import type { Definition, Port, Parameter } from './model';
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
const signal = (
  kind: string,
  name: string,
  symbol: string,
  ports: Port[],
  equations: string,
  parameters: Parameter[] = [],
  declarations = '',
): Definition => ({
  kind,
  name,
  symbol,
  domain: 'signal',
  description: name,
  ports,
  equations,
  parameters,
  declarations,
});
export const controlBlocks: Definition[] = [
  signal(
    'sum',
    'Sum',
    'sum',
    [input('a', '+'), input('b', '+', 'bottom'), output('y')],
    'y = a + b;',
  ),
  signal(
    'subtract',
    'Subtract',
    'sum',
    [input('a', '+'), input('b', '−', 'bottom'), output('y')],
    'y = a - b;',
  ),
  signal('constant', 'Constant', 'constant', [output('y')], 'y = value;', [
    p('value', 'Value', 0),
  ]),
  signal(
    'integrator',
    'Limited integrator',
    '1/s',
    [input('u'), output('y')],
    'der(x) = if (x >= limit and u > 0) or (x <= -limit and u < 0) then 0 else u;\ny = x;',
    [p('limit', 'Integral limit', 8, '', 0.01)],
    'Real x(start=0, fixed=true);',
  ),
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
    ),
    controller: true,
    description:
      'Continuous PI current regulator with back-calculation anti-windup.',
  },
  {
    ...signal(
      'clarke',
      'Clarke transform',
      'abc→αβ',
      [
        input('ia', 'a', 'right'),
        input('ib', 'b', 'right'),
        input('ic', 'c', 'right'),
        output('alpha', 'α', 'A', 'left'),
        output('beta', 'β', 'A', 'left'),
      ],
      'alpha = (2*ia-ib-ic)/3;\nbeta = (ib-ic)/sqrt(3);',
    ),
    description:
      'Amplitude-invariant three-phase to stationary-frame current transform.',
  },
  {
    ...signal(
      'park',
      'Park transform',
      'αβ→dq',
      [
        input('alpha', 'α', 'right'),
        input('beta', 'β', 'right'),
        input('theta', 'θe', 'bottom'),
        output('id', 'd', 'A', 'left'),
        output('iq', 'q', 'A', 'left'),
      ],
      'id = alpha*cos(theta) + beta*sin(theta);\niq = -alpha*sin(theta) + beta*cos(theta);',
    ),
    description: 'Rotate stationary-frame currents into the rotor d/q frame.',
  },
  {
    ...signal(
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
    ),
    description:
      'Inverse Park and inverse Clarke transforms produce three phase-voltage commands.',
  },
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
    ),
    domain: 'electrical',
    description:
      'Averaged inverter with common-mode injection and DC-bus voltage clipping. No PWM switching ripple.',
  },
  {
    kind: 'pmsm',
    name: 'PMSM',
    symbol: 'pmsm',
    domain: 'electrical',
    description:
      'Three-phase permanent-magnet synchronous motor. Sinusoidal flux, fixed d/q inductances, ideal rotor-angle and current measurements.',
    ports: [
      input('va', 'a'),
      input('vb', 'b'),
      input('vc', 'c'),
      {
        id: 'flange',
        name: 'shaft',
        direction: 'physical',
        domain: 'mechanical',
        side: 'right',
      },
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
      'Shaft inertia, viscous friction and a step in opposing load torque at 0.45 s.',
    ports: [
      {
        id: 'flange',
        name: 'shaft',
        direction: 'physical',
        domain: 'mechanical',
        side: 'left',
      },
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
];
