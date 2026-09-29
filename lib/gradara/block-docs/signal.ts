import type { BlockDoc } from './types';

export const docs: Record<string, BlockDoc> = {
  // Sources

  constant: {
    description: [
      'Outputs a fixed value for the whole run. Use it for setpoints, offsets, and fixed inputs to other blocks.',
    ],
    ports: { y: 'Output signal, equal to Value at all times.' },
    parameters: { value: 'The output value. Any real number.' },
    equations: ['y = value'],
    limitations: [
      'The value is fixed during a run. For a change at a set time, use Step.',
    ],
    seeAlso: ['step', 'ramp', 'booleanConstant'],
  },

  step: {
    description: [
      'Outputs zero until Start time, then Height from then on. Use it as a reference change to test a loop’s response.',
    ],
    ports: { y: 'Output signal: 0 before Start time, Height after.' },
    parameters: {
      height: 'The value after the step. Any real number; negative steps down.',
      startTime:
        'Time of the step, in seconds. 0 or more; at 0 the output is Height from the start.',
    },
    equations: [
      'y = 0 for time < startTime',
      'y = height for time ≥ startTime',
    ],
    limitations: [
      'The step always starts from 0. For a step between two nonzero levels, add a Constant with Sum.',
    ],
    seeAlso: ['ramp', 'constant', 'pulse', 'booleanStep'],
  },

  ramp: {
    description: [
      'Outputs zero until Start time, then rises in a straight line at Slope per second without limit.',
    ],
    ports: {
      y: 'Output signal: 0 before Start time, then Slope · (time − Start time).',
    },
    parameters: {
      slope: 'Rate of rise, in units per second. Negative values ramp down.',
      startTime: 'Time the ramp starts, in seconds. 0 or more.',
    },
    equations: [
      'y = 0 for time < startTime',
      'y = slope · (time − startTime) for time ≥ startTime',
    ],
    limitations: [
      'The ramp never levels off. To stop it at a value, follow it with Saturation.',
    ],
    seeAlso: ['step', 'clock', 'saturation', 'rateLimiter'],
  },

  sine: {
    description: [
      'A continuous sinusoid with adjustable amplitude, frequency in hertz, phase, and offset.',
    ],
    ports: { y: 'Output signal.' },
    parameters: {
      amplitude:
        'Peak deviation from Offset. A negative value inverts the wave.',
      frequency:
        'Frequency, in Hz (cycles per second, not rad/s). 0 or more; 0 gives the constant offset + amplitude · sin(phase).',
      phase: 'Phase at time 0, in radians.',
      offset: 'Value the wave oscillates around.',
    },
    equations: ['y = offset + amplitude · sin(2π · frequency · time + phase)'],
    limitations: ['The wave runs from time 0; there is no start time.'],
    tips: ['For a cosine, set Phase to π/2 (1.5708).'],
    seeAlso: ['pulse', 'sineOp', 'sineVoltage'],
  },

  pulse: {
    description: [
      'A periodic rectangular wave switching between Amplitude and 0. Each period starts high for Duty cycle · Period, then stays at 0 for the rest.',
      'Start time sets where the periods are aligned: a period begins at Start time, and at every whole multiple of Period before and after it.',
    ],
    ports: { y: 'Output signal: Amplitude or 0.' },
    parameters: {
      amplitude: 'Value during the high part of each period.',
      period: 'Length of one period, in seconds. At least 0.0001 s.',
      width:
        'Duty cycle: the high fraction of each period, from 0 to 1. 0 keeps the output at 0; 1 or more keeps it at Amplitude.',
      startTime: 'Alignment time of the periods, in seconds. 0 or more.',
    },
    equations: [
      'y = amplitude if mod(time − startTime, period) < width · period',
      'y = 0 otherwise',
    ],
    limitations: [
      'Start time only shifts the wave; it does not hold the output at 0 before it. The pulse is already running before Start time.',
      'The low level is always 0.',
    ],
    tips: ['For a Boolean pulse train, use Boolean pulse instead.'],
    seeAlso: ['sine', 'step', 'booleanPulse', 'pwmSignal'],
  },

  clock: {
    description: [
      'Outputs the simulation time. Use it to build time-dependent expressions from Math blocks.',
    ],
    ports: { y: 'Simulation time, in seconds.' },
    equations: ['y = time'],
    seeAlso: ['ramp', 'sineOp'],
  },

  // Math

  sum: {
    description: ['Adds two signals.'],
    ports: {
      a: 'First input, added.',
      b: 'Second input, added.',
      y: 'Output signal, a + b.',
    },
    equations: ['y = a + b'],
    limitations: [
      'Exactly two inputs, both added. To subtract, use Subtract; for more inputs, chain Sum blocks.',
    ],
    seeAlso: ['subtract', 'gain', 'product'],
  },

  subtract: {
    description: [
      'Subtracts the second input from the first. Use it to form a control error: setpoint on +, measurement on −.',
    ],
    ports: {
      a: 'Input added (+).',
      b: 'Input subtracted (−).',
      y: 'Output signal, a − b.',
    },
    equations: ['y = a − b'],
    seeAlso: ['sum', 'unaryMinus', 'pi', 'pid'],
  },

  gain: {
    description: [
      'Multiplies its input by a constant. Use it for fixed scaling, unit conversion, and proportional control.',
      'The block has no state and passes changes straight through.',
    ],
    ports: {
      u: 'Input signal.',
      y: 'Output signal, k · u.',
    },
    parameters: {
      k: 'The constant factor. Any real number; a negative gain inverts the signal.',
    },
    equations: ['y = k · u'],
    limitations: [
      'The gain is fixed during a run. For a gain that changes, multiply by a signal with Product.',
    ],
    seeAlso: ['product', 'sum', 'unaryMinus'],
  },

  product: {
    description: [
      'Multiplies two signals. Use it for a gain set by another signal, or to form power from voltage and current.',
    ],
    ports: {
      a: 'First factor.',
      b: 'Second factor.',
      y: 'Output signal, a · b.',
    },
    equations: ['y = a · b'],
    seeAlso: ['divide', 'gain', 'power'],
  },

  divide: {
    description: ['Divides the first input by the second.'],
    ports: {
      a: 'Numerator.',
      b: 'Denominator.',
      y: 'Output signal, a / b.',
    },
    equations: ['y = a / b'],
    limitations: [
      'The denominator is not guarded. If b reaches 0 during a run, the division fails and the simulation stops with an error.',
    ],
    tips: [
      'If b can pass through zero, keep it away from zero first, for example with Max against a small constant or with Saturation.',
    ],
    seeAlso: ['product', 'max', 'saturation'],
  },

  abs: {
    description: ['Outputs the absolute value of its input.'],
    ports: {
      u: 'Input signal.',
      y: 'Output signal, |u|, never negative.',
    },
    equations: ['y = |u|'],
    seeAlso: ['sign', 'sqrt'],
  },

  sign: {
    description: [
      'Outputs the sign of its input: 1 for positive, −1 for negative, 0 at exactly zero.',
    ],
    ports: {
      u: 'Input signal.',
      y: 'Output signal: −1, 0, or 1.',
    },
    equations: ['y = 1 if u > 0', 'y = −1 if u < 0', 'y = 0 if u = 0'],
    limitations: [
      'The output jumps where u crosses zero, which causes a solver event at each crossing.',
    ],
    seeAlso: ['abs', 'relay'],
  },

  sqrt: {
    description: [
      'Outputs the square root of its input. A negative input is treated as 0.',
    ],
    ports: {
      u: 'Input signal.',
      y: 'Output signal, √u for u ≥ 0 and 0 for u < 0.',
    },
    equations: ['y = √max(0, u)'],
    limitations: [
      'Negative inputs are clipped to 0 silently, with no warning.',
    ],
    seeAlso: ['power', 'abs'],
  },

  min: {
    description: ['Outputs the smaller of two signals.'],
    ports: {
      a: 'First input.',
      b: 'Second input.',
      y: 'Output signal, the smaller of a and b.',
    },
    equations: ['y = min(a, b)'],
    seeAlso: ['max', 'saturation'],
  },

  max: {
    description: ['Outputs the larger of two signals.'],
    ports: {
      a: 'First input.',
      b: 'Second input.',
      y: 'Output signal, the larger of a and b.',
    },
    equations: ['y = max(a, b)'],
    seeAlso: ['min', 'saturation'],
  },

  sineOp: {
    description: ['Outputs the sine of its input, taken in radians.'],
    ports: {
      u: 'Input angle, in radians.',
      y: 'Output signal, sin u, from −1 to 1.',
    },
    equations: ['y = sin(u)'],
    seeAlso: ['cosineOp', 'clock', 'sine'],
  },

  cosineOp: {
    description: ['Outputs the cosine of its input, taken in radians.'],
    ports: {
      u: 'Input angle, in radians.',
      y: 'Output signal, cos u, from −1 to 1.',
    },
    equations: ['y = cos(u)'],
    seeAlso: ['sineOp', 'clock'],
  },

  unaryMinus: {
    description: ['Negates its input.'],
    ports: {
      u: 'Input signal.',
      y: 'Output signal, −u.',
    },
    equations: ['y = −u'],
    seeAlso: ['gain', 'subtract'],
  },

  power: {
    description: ['Raises its input to a constant real exponent.'],
    ports: {
      u: 'Base.',
      y: 'Output signal, u raised to Exponent.',
    },
    parameters: {
      n: 'The exponent. Any real number; 2 squares the input, 0.5 takes the square root.',
    },
    equations: ['y = u^n'],
    limitations: [
      'The result is undefined for a negative u with a non-integer n, and for u = 0 with a negative n; the simulation then fails. Unlike Sqrt, the input is not clipped.',
    ],
    seeAlso: ['sqrt', 'product'],
  },

  // Continuous

  integrator: {
    description: [
      'Integrates its input, starting from 0, and stops integrating at ±Integral limit. Use it for integral action that must not wind up.',
      'At the limit, integration stops only while the input pushes further out; an input of the other sign brings the output back immediately.',
    ],
    ports: {
      u: 'Input signal, the rate of change of the output.',
      y: 'Output signal, the limited integral of u.',
    },
    parameters: {
      limit:
        'Symmetric bound on the output: the output stays within ±limit. At least 0.01.',
    },
    equations: [
      'dx/dt = 0 if (x ≥ limit and u > 0) or (x ≤ −limit and u < 0)',
      'dx/dt = u otherwise',
      'y = x, with x = 0 at time 0',
    ],
    limitations: [
      'The limit is always active and symmetric; there is no unlimited setting. Set a large limit to approximate a plain integrator.',
      'The initial value is always 0, and there is no reset input.',
    ],
    seeAlso: ['discreteIntegrator', 'pi', 'filter'],
  },

  filter: {
    description: [
      'A first-order low-pass filter with unity DC gain. The output follows the input with time constant τ, reaching about 63% of a step after τ.',
    ],
    ports: {
      u: 'Input signal.',
      y: 'Filtered output.',
    },
    parameters: {
      tau: 'Time constant τ, in seconds. At least 1e-5 s. The corner frequency is 1/(2π · tau) Hz.',
    },
    equations: [
      'dx/dt = (u − x) / tau',
      'y = x, with x = 0 at time 0',
      'Transfer function: 1 / (tau · s + 1)',
    ],
    limitations: [
      'The output always starts at 0, so a nonzero input at time 0 gives a start-up transient.',
    ],
    seeAlso: ['secondOrder', 'derivative', 'rateLimiter'],
  },

  derivative: {
    description: [
      'Approximates the time derivative of its input, filtered by a first-order lag with Filter time τ. Smaller τ comes closer to the true derivative but amplifies noise and fast edges more.',
    ],
    ports: {
      u: 'Input signal.',
      y: 'Filtered derivative of u, in units of u per second.',
    },
    parameters: { tau: 'Filter time constant τ, in seconds. At least 1e-5 s.' },
    equations: [
      'dx/dt = (u − x) / tau, with x = 0 at time 0',
      'y = (u − x) / tau',
      'Transfer function: s / (tau · s + 1)',
    ],
    limitations: [
      'The internal state starts at 0, not at the input, so a nonzero input at time 0 gives an initial spike of u(0)/tau that decays with time constant τ.',
      'A step in the input gives a spike of height step/tau rather than an impulse.',
    ],
    seeAlso: ['filter', 'pid'],
  },

  secondOrder: {
    description: [
      'A second-order low-pass system with unity DC gain, set by natural frequency ωn and damping ratio ζ. Use it to model a sensor, actuator, or loop with an oscillatory response.',
    ],
    ports: {
      u: 'Input signal.',
      y: 'Output signal.',
    },
    parameters: {
      wn: 'Natural frequency ωn, in rad/s. At least 0.01.',
      zeta: 'Damping ratio ζ. 0 or more: below 1 the step response overshoots, 1 is critically damped, above 1 is overdamped, and 0 oscillates without decay.',
    },
    equations: [
      'dx1/dt = x2',
      'dx2/dt = wn² · (u − x1) − 2 · zeta · wn · x2',
      'y = x1, with x1 = x2 = 0 at time 0',
      'Transfer function: wn² / (s² + 2 · zeta · wn · s + wn²)',
    ],
    limitations: ['Both states start at 0.'],
    seeAlso: ['filter', 'integrator'],
  },

  delay: {
    description: [
      'Delays its input by a fixed time T. Use it for transport or communication lag.',
    ],
    ports: {
      u: 'Input signal.',
      y: 'Output signal, u delayed by T.',
    },
    parameters: { T: 'Delay time, in seconds. 0 or more.' },
    equations: [
      'y(t) = u(t − T)',
      'For t < T, y = u(0) (the input at the start of the run).',
    ],
    limitations: ['The delay is fixed during a run.'],
    seeAlso: ['unitDelay', 'filter'],
  },

  // Discrete

  unitDelay: {
    description: [
      'Delays its input by one sample. At each sample instant the output takes the input stored at the previous instant.',
    ],
    ports: {
      u: 'Input signal, read at each sample instant.',
      y: 'Output signal, held between samples.',
    },
    parameters: {
      Ts: 'Sample period, in seconds. At least 0.0001 s (default 1 ms).',
    },
    equations: [
      'At t = k · Ts, k = 0, 1, 2, …:',
      'y[k] = u[k − 1], with u[−1] = 0',
    ],
    limitations: [
      'Samples are taken at fixed multiples of Ts from time 0; there is no offset or external trigger.',
      'The initial output is always 0.',
    ],
    seeAlso: ['zoh', 'delay', 'discreteIntegrator'],
  },

  zoh: {
    description: [
      'Samples its input every Ts seconds and holds the value until the next sample. Use it to model an ADC or a sampled controller input.',
    ],
    ports: {
      u: 'Input signal, read at each sample instant.',
      y: 'Output signal, the last sample, constant between samples.',
    },
    parameters: {
      Ts: 'Sample period, in seconds. At least 0.0001 s (default 1 ms).',
    },
    equations: [
      'At t = k · Ts, k = 0, 1, 2, …: y = u(t)',
      'Between samples, y holds its value.',
    ],
    limitations: [
      'Samples are taken at fixed multiples of Ts from time 0. No quantization is modeled.',
    ],
    seeAlso: ['unitDelay', 'triggeredSampler', 'discreteIntegrator'],
  },

  discreteIntegrator: {
    description: [
      'A sampled integrator. At each sample instant it adds Ts times the current input to its state, a backward-Euler sum.',
    ],
    ports: {
      u: 'Input signal, read at each sample instant.',
      y: 'Output signal, the accumulated sum, held between samples.',
    },
    parameters: {
      Ts: 'Sample period, in seconds. At least 0.0001 s (default 1 ms).',
    },
    equations: [
      'At t = k · Ts, k = 0, 1, 2, …:',
      'x[k] = x[k − 1] + Ts · u[k], with x = 0 before the first sample',
      'y = x',
    ],
    limitations: [
      'No output limits, reset, or initial-value setting. The state starts at 0.',
      'Samples are taken at fixed multiples of Ts from time 0.',
    ],
    seeAlso: ['integrator', 'unitDelay', 'discretePID'],
  },

  // Nonlinear

  saturation: {
    description: [
      'Clamps its input between a lower and an upper limit. Inside the limits the input passes unchanged.',
    ],
    ports: {
      u: 'Input signal.',
      y: 'Output signal, u limited to the range from Lower limit to Upper limit.',
    },
    parameters: {
      lower: 'Lower limit. Should not exceed Upper limit.',
      upper: 'Upper limit. Should not be below Lower limit.',
    },
    equations: ['y = max(lower, min(upper, u))'],
    limitations: [
      'Limits are not checked against each other. If Lower limit exceeds Upper limit, the output is Lower limit for every input.',
    ],
    tips: [
      'To limit an integrator itself rather than its output, use Limited integrator.',
    ],
    seeAlso: ['deadzone', 'rateLimiter', 'min', 'max'],
  },

  deadzone: {
    description: [
      'Outputs zero while the input is within ±Half-width. Outside that band the output is the input shifted toward zero by Half-width, so it is continuous at the band edges.',
    ],
    ports: {
      u: 'Input signal.',
      y: 'Output signal.',
    },
    parameters: {
      start:
        'Half-width of the dead band. 0 or more; 0 passes the input unchanged.',
    },
    equations: [
      'y = u − start if u > start',
      'y = u + start if u < −start',
      'y = 0 otherwise',
    ],
    limitations: ['The band is symmetric around zero.'],
    seeAlso: ['saturation', 'relay'],
  },

  relay: {
    description: [
      'A two-level switch: the output is On value when the input is at or above Switch level, and Off value below it.',
    ],
    ports: {
      u: 'Input signal.',
      y: 'Output signal: On value or Off value.',
    },
    parameters: {
      onValue: 'Output when u ≥ Switch level.',
      offValue: 'Output when u < Switch level.',
      offSwitch:
        'The input level where the output switches, in both directions.',
    },
    equations: [
      'y = onValue if u ≥ offSwitch',
      'y = offValue if u < offSwitch',
    ],
    limitations: [
      'No hysteresis: the block switches at one level both ways, so a noisy input near that level makes the output chatter and can slow the solver. For a band, use Boolean hysteresis or On-off controller.',
    ],
    seeAlso: ['boolHysteresis', 'onOffController', 'sign', 'switch2'],
  },

  rateLimiter: {
    description: [
      'Limits how fast its output can rise or fall. The output tracks the input, moving no faster than Rising limit upward and Falling limit downward.',
      'Near the input the output follows it with a first-order lag of 1 ms, so it settles on the input rather than hitting it exactly.',
    ],
    ports: {
      u: 'Input signal.',
      y: 'Rate-limited output.',
    },
    parameters: {
      rising:
        'Largest upward rate, in units per second. 0 or more; 0 stops the output from rising.',
      falling:
        'Largest downward rate, in units per second, as a positive number. 0 or more; 0 stops the output from falling.',
    },
    equations: [
      'dy/dt = min(rising, 1000 · (u − y)) if u > y',
      'dy/dt = max(−falling, 1000 · (u − y)) otherwise',
      'y = 0 at time 0',
    ],
    limitations: [
      'The output starts at 0, not at the input, so a nonzero input at time 0 is approached at the rate limit.',
      'Tracking uses a fixed 1 ms time constant; signals faster than that are also smoothed.',
    ],
    seeAlso: ['saturation', 'filter', 'ramp'],
  },

  // Routing

  mux: {
    description: [
      'A drawing stand-in for bundling three signals into one line. Gradara has no vector buses yet, so this block only keeps a sheet readable.',
      'Models containing Mux cannot run: model checks report it as a drawing-only block, and Run refuses the model until it is replaced by direct connections.',
    ],
    ports: {
      u1: 'First signal.',
      u2: 'Second signal.',
      u3: 'Third signal.',
      y: 'Bundled line, drawn to a Demux.',
    },
    equations: ['y = u1 (u2 and u3 are not carried)'],
    limitations: [
      'No vector or bus signals: the output carries only u1, and u2 and u3 are dropped.',
      'Always three inputs.',
    ],
    seeAlso: ['demux', 'switch2'],
  },

  demux: {
    description: [
      'A drawing stand-in for splitting a bundled line into three signals, the counterpart of Mux.',
      'Models containing Demux cannot run: model checks report it as a drawing-only block, and Run refuses the model until it is replaced by direct connections.',
    ],
    ports: {
      u: 'Bundled line, usually from a Mux.',
      y1: 'First output, a copy of u.',
      y2: 'Second output, a copy of u.',
      y3: 'Third output, a copy of u.',
    },
    equations: ['y1 = u', 'y2 = u', 'y3 = u'],
    limitations: [
      'No vector or bus signals: every output repeats the one input signal.',
      'Always three outputs.',
    ],
    seeAlso: ['mux'],
  },

  switch2: {
    description: [
      'Passes one of two inputs depending on a control signal: u₁ when the control is at or above Threshold, otherwise u₂.',
    ],
    ports: {
      u1: 'Input passed when sel ≥ Threshold.',
      sel: 'Control signal compared with Threshold.',
      u3: 'Input u₂, passed when sel < Threshold.',
      y: 'Output signal.',
    },
    parameters: {
      threshold:
        'Level the control signal is compared with. The upper input is chosen when sel equals it.',
    },
    equations: ['y = u1 if sel ≥ threshold', 'y = u3 otherwise'],
    limitations: [
      'The switch is instant, so the output jumps when the selection changes. It takes a real-valued control; for a Boolean control, use Logical switch.',
    ],
    seeAlso: ['manualSwitch', 'logicSwitch', 'relay'],
  },

  manualSwitch: {
    description: [
      'Passes one of two inputs chosen by a parameter. Use it to try alternatives between runs without rewiring.',
    ],
    ports: {
      u1: 'Input 1, passed when Select is 1.',
      u2: 'Input 2, passed when Select is 2.',
      y: 'Output signal.',
    },
    parameters: {
      sel: 'Which input to pass: 1 or 2. Values below 1.5 select input 1; 1.5 and above select input 2.',
    },
    equations: ['y = u2 if sel ≥ 1.5', 'y = u1 otherwise'],
    limitations: [
      'The choice is fixed during a run. To switch during a run, use Switch.',
    ],
    tips: [
      'Both inputs must still be connected: an unconnected input is an error even when it is not selected.',
    ],
    seeAlso: ['switch2', 'logicSwitch'],
  },

  // Sinks

  terminator: {
    description: [
      'Caps an output you do not use, so the sheet shows it is left open on purpose. It has no effect on the simulation.',
    ],
    ports: { u: 'Signal to discard.' },
    limitations: [
      'The signal is still recorded as the driving block’s output.',
    ],
    seeAlso: ['scope', 'display'],
  },

  scope: {
    description: [
      'Marks a signal you intend to inspect. It does not plot on the canvas: after a run, view the signal in the Results tab, where every block output is recorded.',
    ],
    ports: { u: 'Signal to inspect.' },
    limitations: [
      'The block has no settings and no effect on the simulation; plots, layouts, and axis ranges are set in Results.',
    ],
    tips: [
      'To record a particular wire rather than a block output, select it and choose Log signal.',
    ],
    seeAlso: ['display', 'terminator'],
  },

  display: {
    description: [
      'Marks a signal you intend to read as a number. The block itself shows a fixed 123 symbol, not the live value; read values in Results, where Cursor values show the signal at any time.',
    ],
    ports: { u: 'Signal to read.' },
    limitations: ['No effect on the simulation, and no settings.'],
    seeAlso: ['scope', 'terminator'],
  },

  // Ports & subsystems

  subsystem: {
    description: [
      'A block with its own diagram inside. It starts with one input wired straight to one output. Double-click it to open and edit the inside.',
      'Drop a wire on the block to add a port, or add, rename, retype, and reorder ports in the inspector. Copies share their contents until you choose Make unique.',
    ],
    ports: {
      u1: 'Input 1 (in1). Inside, its Subsystem input block drives the diagram.',
      y1: 'Output 1 (out1). Inside, its Subsystem output block collects the result.',
    },
    equations: ['y1 = u1 (the initial contents: in1 wired to out1)'],
    tips: [
      'To group existing blocks, select them and press ⌘/Ctrl + G; each wire crossing the selection edge becomes a port.',
      'Promote an inner parameter with ↑ so each instance can set its own value.',
    ],
    seeAlso: ['emptySubsystem', 'inport', 'outport'],
  },

  emptySubsystem: {
    description: [
      'A subsystem with nothing inside and no ports. Drop wires on it to add ports, or add them in the inspector, then double-click to build the inside.',
    ],
    ports: {},
    seeAlso: ['subsystem', 'inport', 'outport'],
  },

  inport: {
    description: [
      'An input of the subsystem you are in. Inside, it drives the wires connected to it with whatever reaches the matching port on the subsystem block.',
      'Set its type in its properties: signal, Boolean, or a physical domain. Inputs are numbered from 1.',
    ],
    ports: {
      y: 'Inside end of the subsystem input: carries what is connected to the port outside.',
    },
    limitations: [
      'Changing a port’s direction or type later removes its wires.',
    ],
    tips: [
      'Adding, removing, or renaming it updates every instance of the subsystem.',
    ],
    seeAlso: ['outport', 'subsystem'],
  },

  outport: {
    description: [
      'An output of the subsystem you are in. What is connected to it inside appears at the matching port on the subsystem block.',
      'Set its type in its properties: signal, Boolean, or a physical domain. Outputs are numbered from 1.',
    ],
    ports: {
      u: 'Inside end of the subsystem output: the value passed out of the subsystem.',
    },
    limitations: [
      'Changing a port’s direction or type later removes its wires.',
    ],
    tips: [
      'Adding, removing, or renaming it updates every instance of the subsystem.',
    ],
    seeAlso: ['inport', 'subsystem'],
  },
};
