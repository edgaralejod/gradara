import type { Project } from '../../lib/gradara/model';
import { groupIntoSubsystem } from '../../lib/gradara/hierarchy';
import { normalizeProject } from '../../lib/gradara/normalize-project';
import type { ExampleSpec } from './types';

/** Signal rows: blocks on a 176 × 112 lattice, so every run is straight. */
const col = (i: number) => 80 + 176 * i;
const row = (j: number) => 96 + 112 * j;

export const signals: ExampleSpec[] = [
  {
    id: 'signal-sources',
    title: 'Signal sources',
    area: 'Signals',
    summary:
      'The signal sources side by side: step, ramp, sine, pulse, and clock, plus a constant.',
    description:
      'Each source drives nothing, so its output is exactly the waveform it makes. Compare the step at 0.5 s, the ramp that starts at 0.5 s, the 2 Hz sine, the 1 Hz pulse at 25 % duty, and the clock, which is simulation time itself. A constant is a fixed parameter, so it has no trace of its own; see it at work in Arithmetic.',
    duration: 2,
    blocks: [
      ['const', 'constant', 'Constant', [col(0), row(0)], { value: 3 }],
      ['step', 'step', 'Step', [col(1), row(0)], { height: 2, startTime: 0.5 }],
      [
        'ramp',
        'ramp',
        'Ramp',
        [col(2), row(0)],
        { slope: 1.5, startTime: 0.5 },
      ],
      [
        'sine',
        'sine',
        'Sine',
        [col(0), row(1)],
        { amplitude: 1, frequency: 2 },
      ],
      [
        'pulse',
        'pulse',
        'Pulse',
        [col(1), row(1)],
        { amplitude: 1, period: 1, width: 0.25 },
      ],
      ['clock', 'clock', 'Clock', [col(2), row(1)]],
    ],
    links: [],
    plots: [
      {
        label: 'Sources',
        series: ['step.y', 'ramp.y', 'sine.y', 'pulse.y', 'clock.y'],
        labels: ['Step', 'Ramp', 'Sine', 'Pulse', 'Clock'],
      },
    ],
    checks: [
      {
        signal: 'step.y',
        at: 0.4,
        value: 0,
        tol: 1e-9,
        why: 'before the 0.5 s step',
      },
      {
        signal: 'step.y',
        value: 2,
        tol: 1e-9,
        why: 'height = 2 after the step',
      },
      { signal: 'ramp.y', value: 2.25, tol: 1e-6, why: '1.5 × (2 − 0.5)' },
      { signal: 'sine.y', min: -1.000001, max: 1.000001, why: 'amplitude 1' },
      {
        signal: 'sine.y',
        at: 0.125,
        value: 1,
        tol: 1e-3,
        why: 'sin(2π·2·0.125) = 1',
      },
      {
        signal: 'pulse.y',
        at: 0.1,
        value: 1,
        tol: 1e-9,
        why: 'on for the first 25 % of each period',
      },
      {
        signal: 'pulse.y',
        at: 0.5,
        value: 0,
        tol: 1e-9,
        why: 'off after 0.25 s',
      },
      { signal: 'clock.y', value: 2, tol: 1e-6, why: 'the clock is time' },
    ],
    about: ['step', 'ramp', 'sine', 'pulse', 'clock'],
  },
  {
    id: 'arithmetic',
    title: 'Arithmetic',
    area: 'Signals',
    summary:
      'Sum, difference, product, quotient, minimum, and maximum of a ramp and a constant.',
    description:
      'Input a is a ramp that equals time, input b is the constant 2. The six blocks combine them, so their traces are straight lines that cross or bend at t = 2 s, where a = b. At 4 s: a + b = 6, a − b = 2, a · b = 8, a / b = 2, min = 2, max = 4.',
    duration: 4,
    blocks: [
      ['a', 'ramp', 'a = t', [80, 192], { slope: 1, startTime: 0 }],
      ['b', 'constant', 'b = 2', [80, 416], { value: 2 }],
      [
        'sum',
        'sum',
        'a + b',
        [304, 304],
        {},
        { ports: { a: 'top', b: 'bottom' }, label: 'right' },
      ],
      [
        'diff',
        'subtract',
        'a − b',
        [480, 304],
        {},
        { ports: { a: 'top', b: 'bottom' }, label: 'right' },
      ],
      [
        'prod',
        'product',
        'a · b',
        [656, 304],
        {},
        { ports: { a: 'top', b: 'bottom' }, label: 'right' },
      ],
      [
        'quot',
        'divide',
        'a / b',
        [832, 304],
        {},
        { ports: { a: 'top', b: 'bottom' }, label: 'right' },
      ],
      [
        'lo',
        'min',
        'min(a, b)',
        [1008, 304],
        {},
        { ports: { a: 'top', b: 'bottom' }, label: 'right' },
      ],
      [
        'hi',
        'max',
        'max(a, b)',
        [1184, 304],
        {},
        { ports: { a: 'top', b: 'bottom' }, label: 'right' },
      ],
    ],
    links: [
      ['a.y', 'sum.a'],
      ['b.y', 'sum.b'],
      ['a.y', 'diff.a'],
      ['b.y', 'diff.b'],
      ['a.y', 'prod.a'],
      ['b.y', 'prod.b'],
      ['a.y', 'quot.a'],
      ['b.y', 'quot.b'],
      ['a.y', 'lo.a'],
      ['b.y', 'lo.b'],
      ['a.y', 'hi.a'],
      ['b.y', 'hi.b'],
    ],
    plots: [
      {
        label: 'Results',
        series: ['sum.y', 'diff.y', 'prod.y', 'quot.y', 'lo.y', 'hi.y'],
        labels: ['a + b', 'a − b', 'a · b', 'a / b', 'min', 'max'],
      },
    ],
    checks: [
      { signal: 'sum.y', value: 6, tol: 1e-6, why: '4 + 2' },
      { signal: 'diff.y', value: 2, tol: 1e-6, why: '4 − 2' },
      { signal: 'prod.y', value: 8, tol: 1e-6, why: '4 · 2' },
      { signal: 'quot.y', value: 2, tol: 1e-6, why: '4 / 2' },
      { signal: 'lo.y', at: 1, value: 1, tol: 1e-6, why: 'min(1, 2)' },
      { signal: 'lo.y', value: 2, tol: 1e-6, why: 'min(4, 2)' },
      { signal: 'hi.y', at: 1, value: 2, tol: 1e-6, why: 'max(1, 2)' },
      { signal: 'hi.y', value: 4, tol: 1e-6, why: 'max(4, 2)' },
    ],
    about: ['constant', 'sum', 'subtract', 'product', 'divide', 'min', 'max'],
  },
  {
    id: 'functions',
    title: 'Math functions',
    area: 'Signals',
    summary:
      'Gain, absolute value, square root, sign, negation, and power of a sine; sine and cosine of time.',
    description:
      'The source is 2·sin(πt/2): +2 at 1 s and −2 at 3 s. Read each block at those two instants: the gain of 0.5 gives ±1, |u| gives 2 both times and its square root √2, sign gives ±1, −u gives ∓2, and u² gives 4. The sine and cosine blocks take the clock, so they draw sin t and cos t.',
    duration: 4,
    blocks: [
      [
        'u',
        'sine',
        'u = 2 sin(πt/2)',
        [col(0), row(2)],
        { amplitude: 2, frequency: 0.25 },
      ],
      ['gain', 'gain', 'Gain 0.5', [col(2), row(0)], { k: 0.5 }],
      ['abs', 'abs', '|u|', [col(2), row(1)]],
      ['root', 'sqrt', '√|u|', [col(3), row(1)]],
      ['sign', 'sign', 'sign(u)', [col(2), row(2)]],
      ['neg', 'unaryMinus', '−u', [col(2), row(3)]],
      ['square', 'power', 'u²', [col(2), row(4)], { n: 2 }],
      ['t', 'clock', 'Time', [col(0), row(5.5)]],
      ['sin', 'sineOp', 'sin(t)', [col(2), row(5.5)]],
      ['cos', 'cosineOp', 'cos(t)', [col(2), row(6.5)]],
    ],
    links: [
      ['u.y', 'gain.u'],
      ['u.y', 'abs.u'],
      ['abs.y', 'root.u'],
      ['u.y', 'sign.u'],
      ['u.y', 'neg.u'],
      ['u.y', 'square.u'],
      ['t.y', 'sin.u'],
      ['t.y', 'cos.u'],
    ],
    plots: [
      {
        label: 'Functions of u',
        series: ['gain.y', 'abs.y', 'root.y', 'sign.y', 'neg.y', 'square.y'],
        labels: ['0.5 u', '|u|', '√|u|', 'sign(u)', '−u', 'u²'],
      },
      {
        label: 'Functions of time',
        series: ['sin.y', 'cos.y'],
        labels: ['sin t', 'cos t'],
      },
    ],
    checks: [
      { signal: 'gain.y', at: 1, value: 1, tol: 1e-4, why: '0.5 · 2' },
      { signal: 'gain.y', at: 3, value: -1, tol: 1e-4, why: '0.5 · −2' },
      { signal: 'abs.y', at: 3, value: 2, tol: 1e-4, why: '|−2|' },
      { signal: 'root.y', at: 3, value: Math.SQRT2, tol: 1e-4, why: '√2' },
      { signal: 'sign.y', at: 1, value: 1, tol: 1e-9, why: 'u > 0' },
      { signal: 'sign.y', at: 3, value: -1, tol: 1e-9, why: 'u < 0' },
      { signal: 'neg.y', at: 1, value: -2, tol: 1e-4, why: '−2' },
      { signal: 'square.y', at: 3, value: 4, tol: 1e-3, why: '(−2)²' },
      { signal: 'sin.y', value: Math.sin(4), tol: 1e-4, why: 'sin 4' },
      { signal: 'cos.y', value: Math.cos(4), tol: 1e-4, why: 'cos 4' },
    ],
    about: [
      'gain',
      'abs',
      'sqrt',
      'sign',
      'unaryMinus',
      'power',
      'sineOp',
      'cosineOp',
    ],
  },
  {
    id: 'step-responses',
    title: 'Step responses',
    area: 'Signals',
    summary:
      'A unit step through a first-order filter, a second-order system, an integrator, and a delay; a ramp through a derivative.',
    description:
      'The step comes at 0.1 s. The filter (τ = 0.2 s) reaches 63 % at 0.3 s. The second-order block (ωn = 10 rad/s, ζ = 0.3) overshoots to 1.37 at 0.43 s and rings down. The integrator rises at 1 per second. The delay repeats the step 0.3 s late. The derivative of a ramp with slope 2 is 2.',
    duration: 2,
    blocks: [
      [
        'step',
        'step',
        'Step at 0.1 s',
        [col(0), row(1.5)],
        { height: 1, startTime: 0.1 },
      ],
      ['filter', 'filter', 'First order', [col(2), row(0)], { tau: 0.2 }],
      [
        'second',
        'secondOrder',
        'Second order',
        [col(2) + 40, row(1)],
        { wn: 10, zeta: 0.3 },
      ],
      ['int', 'integrator', 'Integrator', [col(2), row(2)], { limit: 100 }],
      ['delay', 'delay', 'Delay 0.3 s', [col(2), row(3)], { T: 0.3 }],
      [
        'ramp',
        'ramp',
        'Ramp, slope 2',
        [col(0), row(4.5)],
        { slope: 2, startTime: 0 },
      ],
      ['deriv', 'derivative', 'Derivative', [col(2), row(4.5)], { tau: 0.01 }],
    ],
    links: [
      ['step.y', 'filter.u'],
      ['step.y', 'second.u'],
      ['step.y', 'int.u'],
      ['step.y', 'delay.u'],
      ['ramp.y', 'deriv.u'],
    ],
    plots: [
      {
        label: 'Step responses',
        series: ['step.y', 'filter.y', 'second.y', 'delay.y'],
        labels: ['Step', 'First order', 'Second order', 'Delayed'],
      },
      {
        label: 'Integral and derivative',
        series: ['int.y', 'deriv.y'],
        labels: ['∫ step', 'd/dt ramp'],
      },
    ],
    checks: [
      {
        signal: 'filter.y',
        at: 0.3,
        value: 1 - Math.exp(-1),
        tol: 2e-3,
        why: 'one time constant after the step',
      },
      {
        signal: 'second.y',
        at: 0.1 + Math.PI / (10 * Math.sqrt(1 - 0.09)),
        value: 1 + Math.exp((-Math.PI * 0.3) / Math.sqrt(1 - 0.09)),
        tol: 3e-3,
        why: 'peak overshoot 1 + e^(−πζ/√(1−ζ²)) at t_p = π/(ωn√(1−ζ²))',
      },
      {
        signal: 'second.y',
        value: 1,
        tol: 4e-3,
        why: 'settles at the step height: the ringing envelope is e^(−ζωn·1.9 s) ≈ 0.003',
      },
      { signal: 'int.y', value: 1.9, tol: 1e-3, why: '∫ from 0.1 s to 2 s' },
      {
        signal: 'delay.y',
        at: 0.35,
        value: 0,
        tol: 1e-9,
        why: 'the step has not arrived',
      },
      {
        signal: 'delay.y',
        at: 0.45,
        value: 1,
        tol: 1e-9,
        why: 'arrives at 0.4 s',
      },
      { signal: 'deriv.y', value: 2, tol: 1e-3, why: 'slope of the ramp' },
    ],
    about: ['filter', 'secondOrder', 'integrator', 'delay', 'derivative'],
  },
  {
    id: 'sampling',
    title: 'Sampling',
    area: 'Signals',
    summary:
      'A sine held, delayed by one sample, and a step summed at a fixed sample rate.',
    description:
      'Samples are taken every 0.1 s. The zero-order hold turns the 1 Hz sine into a staircase; the unit delay draws the same staircase one sample later. The discrete integrator adds the step times 0.01 s every 0.01 s, so it counts up to 1 after one second.',
    duration: 1,
    blocks: [
      [
        'sine',
        'sine',
        'Sine 1 Hz',
        [col(0), row(0.5)],
        { amplitude: 1, frequency: 1 },
      ],
      ['zoh', 'zoh', 'Hold 0.1 s', [col(2), row(0)], { Ts: 0.1 }],
      ['z', 'unitDelay', 'Unit delay 0.1 s', [col(2), row(1)], { Ts: 0.1 }],
      ['step', 'step', 'Step', [col(0), row(2)], { height: 1, startTime: 0 }],
      [
        'sum',
        'discreteIntegrator',
        'Discrete integrator',
        [col(2), row(2)],
        { Ts: 0.01 },
      ],
    ],
    links: [
      ['sine.y', 'zoh.u'],
      ['sine.y', 'z.u'],
      ['step.y', 'sum.u'],
    ],
    plots: [
      {
        label: 'Sampled sine',
        series: ['sine.y', 'zoh.y', 'z.y'],
        labels: ['Sine', 'Held', 'Delayed'],
      },
      {
        label: 'Discrete integral',
        series: ['sum.y'],
        labels: ['Σ step · Ts'],
      },
    ],
    checks: [
      {
        signal: 'zoh.y',
        at: 0.25,
        value: Math.sin(2 * Math.PI * 0.2),
        tol: 1e-4,
        why: 'held since the 0.2 s sample',
      },
      {
        signal: 'z.y',
        at: 0.25,
        value: Math.sin(2 * Math.PI * 0.1),
        tol: 1e-4,
        why: 'the 0.1 s sample, one period late',
      },
      { signal: 'sum.y', value: 1, tol: 0.011, why: '100 samples of 0.01' },
    ],
    about: ['zoh', 'unitDelay', 'discreteIntegrator'],
  },
  {
    id: 'nonlinear',
    title: 'Nonlinearities',
    area: 'Signals',
    summary:
      'Saturation, dead zone, relay, and rate limiter acting on the same sine.',
    description:
      'The input is a 1 Hz sine of amplitude 2. Saturation clips it to ±1. The dead zone removes the band ±0.5, so the peak of 2 comes out as 1.5. The relay outputs +1 whenever the input is at or above 0 and −1 otherwise. The rate limiter lets the output change by at most 2 per second, so it cannot keep up: it reaches only 0.5 by the first peak.',
    duration: 2,
    blocks: [
      [
        'sine',
        'sine',
        'Sine, amplitude 2',
        [col(0), row(1.5)],
        { amplitude: 2, frequency: 1 },
      ],
      [
        'sat',
        'saturation',
        'Saturation ±1',
        [col(2), row(0)],
        { lower: -1, upper: 1 },
      ],
      ['dz', 'deadzone', 'Dead zone ±0.5', [col(2), row(1)], { start: 0.5 }],
      [
        'relay',
        'relay',
        'Relay',
        [col(2), row(2)],
        { onValue: 1, offValue: -1, offSwitch: 0 },
      ],
      [
        'rate',
        'rateLimiter',
        'Rate limit 2/s',
        [col(2), row(3)],
        { rising: 2, falling: 2 },
      ],
    ],
    links: [
      ['sine.y', 'sat.u'],
      ['sine.y', 'dz.u'],
      ['sine.y', 'relay.u'],
      ['sine.y', 'rate.u'],
    ],
    plots: [
      {
        label: 'Nonlinear blocks',
        series: ['sine.y', 'sat.y', 'dz.y', 'relay.y', 'rate.y'],
        labels: ['Input', 'Saturation', 'Dead zone', 'Relay', 'Rate limiter'],
      },
    ],
    checks: [
      { signal: 'sat.y', min: -1.000001, max: 1.000001, why: 'clipped to ±1' },
      {
        signal: 'sat.y',
        at: 0.25,
        value: 1,
        tol: 1e-6,
        why: 'input 2 is clipped',
      },
      { signal: 'dz.y', at: 0.25, value: 1.5, tol: 1e-4, why: '2 − 0.5' },
      {
        signal: 'dz.y',
        at: 0.02,
        value: 0,
        tol: 1e-9,
        why: 'input 0.25 is inside the band',
      },
      {
        signal: 'relay.y',
        at: 0.25,
        value: 1,
        tol: 1e-9,
        why: 'input above 0',
      },
      {
        signal: 'relay.y',
        at: 0.75,
        value: -1,
        tol: 1e-9,
        why: 'input below 0',
      },
      {
        signal: 'rate.y',
        at: 0.25,
        value: 0.5,
        tol: 0.01,
        why: 'rising at 2 per second for 0.25 s',
      },
    ],
    about: ['saturation', 'deadzone', 'relay', 'rateLimiter'],
  },
  {
    id: 'routing',
    title: 'Switches',
    area: 'Signals',
    summary:
      'A switch that follows a control signal, and a manual switch set by a parameter.',
    description:
      'The Switch passes its top input while the control input (a 1 Hz pulse) is at or above 0.5, and its bottom input otherwise: the output alternates between the ramp and −1 every half second. The Manual switch has no control input: its Position parameter (1 or 2) picks an input. Here it is set to 2, so it passes the ramp. Double-click it in the canvas to flip it.',
    duration: 2,
    blocks: [
      ['ramp', 'ramp', 'Ramp', [col(0), row(0)], { slope: 1, startTime: 0 }],
      ['low', 'constant', '−1', [col(0), row(1) + 16], { value: -1 }],
      [
        'pulse',
        'pulse',
        'Control',
        [col(0), row(2) + 32],
        { amplitude: 1, period: 1, width: 0.5 },
      ],
      [
        'sw',
        'switch2',
        'Switch',
        [col(2) + 24, row(0) + 48],
        { threshold: 0.5 },
        { label: 'right' },
      ],
      [
        'manual',
        'manualSwitch',
        'Manual switch',
        [col(2) + 24, row(3)],
        { sel: 2 },
        { ports: { u2: 'left' } },
      ],
    ],
    links: [
      ['ramp.y', 'sw.u1'],
      ['pulse.y', 'sw.sel'],
      ['low.y', 'sw.u3'],
      ['low.y', 'manual.u1'],
      ['ramp.y', 'manual.u2'],
    ],
    plots: [
      {
        label: 'Switched signals',
        series: ['sw.y', 'manual.y'],
        labels: ['Switch', 'Manual switch'],
      },
    ],
    checks: [
      {
        signal: 'sw.y',
        at: 0.25,
        value: 0.25,
        tol: 1e-6,
        why: 'control on: the ramp',
      },
      {
        signal: 'sw.y',
        at: 0.75,
        value: -1,
        tol: 1e-9,
        why: 'control off: −1',
      },
      {
        signal: 'sw.y',
        at: 1.25,
        value: 1.25,
        tol: 1e-6,
        why: 'control on again',
      },
      { signal: 'manual.y', value: 2, tol: 1e-6, why: 'position 2: the ramp' },
    ],
    about: ['switch2', 'manualSwitch'],
  },
  {
    id: 'subsystems',
    title: 'Subsystems',
    area: 'Signals',
    summary:
      'A gain and a filter grouped into a subsystem with an input and an output port, next to an empty subsystem.',
    description:
      'The Plant subsystem holds a gain of 2 and a first-order filter (τ = 0.5 s). Double-click it to open it: its In and Out ports are where the outside wires enter and leave. The output settles at 2. The empty subsystem next to it has no ports and nothing inside yet; drop wires on it or open it to start your own.',
    duration: 3,
    blocks: [
      ['step', 'step', 'Step', [col(0), row(0)], { height: 1, startTime: 0 }],
      ['k', 'gain', 'Gain 2', [col(2), row(0)], { k: 2 }],
      ['lag', 'filter', 'Lag 0.5 s', [col(3), row(0)], { tau: 0.5 }],
      ['yout', 'gain', 'Output', [col(4), row(0)], { k: 1 }],
      ['blank', 'emptySubsystem', 'Empty subsystem', [col(2) + 88, row(1.5)]],
    ],
    links: [
      ['step.y', 'k.u'],
      ['k.y', 'lag.u'],
      ['lag.y', 'yout.u'],
    ],
    plots: [{ label: 'Plant output', series: ['yout.y'], labels: ['y'] }],
    checks: [
      {
        signal: 'yout.y',
        at: 0.5,
        value: 2 * (1 - Math.exp(-1)),
        tol: 2e-3,
        why: 'one time constant',
      },
      {
        signal: 'yout.y',
        value: 2 * (1 - Math.exp(-6)),
        tol: 2e-3,
        why: 'settles at the gain, 2',
      },
    ],
    about: ['subsystem', 'emptySubsystem', 'inport', 'outport'],
    finish: (doc: Project) => {
      const grouped = groupIntoSubsystem(doc, ['k', 'lag'], 'Plant');
      if (!grouped) throw new Error('subsystems: could not group the plant');
      const doc2 = normalizeProject(grouped.project);
      return {
        ...doc2,
        blocks: doc2.blocks.map((b) =>
          b.id === 'blank'
            ? { ...b, definition: { ...b.definition, name: 'Empty subsystem' } }
            : b,
        ),
      };
    },
  },
];
