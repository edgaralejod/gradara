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
      'Outputs zero until Start time, then rises in a straight line to Height over Duration and holds Height from then on (the Modelica library ramp).',
    ],
    ports: {
      y: 'Output signal: 0 before Start time, rising to Height, then Height.',
    },
    parameters: {
      height:
        'The value reached at the end of the ramp. Negative values ramp down.',
      duration:
        'Time the rise takes, in seconds, so the slope is Height / Duration. 0 or more; 0 makes a step.',
      startTime: 'Time the ramp starts, in seconds. 0 or more.',
    },
    equations: [
      'y = 0 for time < startTime',
      'y = height · (time − startTime) / duration for startTime ≤ time < startTime + duration',
      'y = height for time ≥ startTime + duration',
    ],
    tips: [
      'For a ramp that keeps rising for the whole run, set Duration to the run length and Height to slope · Duration.',
    ],
    seeAlso: ['step', 'clock', 'saturation', 'rateLimiter'],
  },

  sine: {
    description: [
      'A continuous sinusoid with adjustable amplitude, frequency in hertz, phase, and offset (the Modelica library sine source).',
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
      'A periodic rectangular wave switching between Amplitude and 0 (the Modelica library pulse). From Start time on, each period starts high for Duty cycle · Period, then stays at 0 for the rest.',
    ],
    ports: { y: 'Output signal: Amplitude or 0.' },
    parameters: {
      amplitude: 'Value during the high part of each period.',
      period: 'Length of one period, in seconds. At least 0.0001 s.',
      width:
        'Duty cycle: the high fraction of each period, from 0.001 to 1. 1 keeps the output at Amplitude.',
      startTime:
        'Time the first period starts, in seconds. 0 or more; the output is 0 before it.',
    },
    equations: [
      'y = 0 for time < startTime',
      'y = amplitude if mod(time − startTime, period) < width · period, else 0',
    ],
    limitations: ['The low level is always 0.'],
    tips: ['For a Boolean pulse train, use Boolean pulse instead.'],
    seeAlso: ['sine', 'step', 'booleanPulse', 'pwmSignal'],
  },

  clock: {
    description: [
      'Outputs the simulation time (the Modelica library continuous clock). Use it to build time-dependent expressions from Math blocks.',
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
      'Subtracts the second input from the first (the Modelica library feedback block). Use it to form a control error: setpoint on +, measurement on −.',
    ],
    ports: {
      a: 'Input added (+).',
      b: 'Input subtracted (−).',
      y: 'Output signal, a − b.',
    },
    equations: ['y = a − b'],
    seeAlso: ['sum', 'unaryMinus', 'pi', 'pidController'],
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
    description: ['Outputs the square root of its input.'],
    ports: {
      u: 'Input signal, 0 or more.',
      y: 'Output signal, √u.',
    },
    equations: ['y = √u'],
    limitations: [
      'A negative input is a model error: the square root is not real, and the run fails or produces no number. Keep the input at 0 or above, for example with Abs or Max.',
    ],
    seeAlso: ['power', 'abs', 'max'],
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
      'Integrates its input over time, starting from Initial value (the Modelica library integrator).',
    ],
    ports: {
      u: 'Input signal, the rate of change of the output.',
      y: 'Output signal, the integral of u.',
    },
    parameters: {
      y_start: 'Value of the output at the start of the run.',
    },
    equations: ['dy/dt = u', 'y = y_start at time 0'],
    limitations: [
      'Nothing bounds the output: in a loop with a saturating actuator the integral winds up. Use Limited integrator or a PI with limits instead.',
      'There is no reset input.',
    ],
    seeAlso: [
      'limitedIntegrator',
      'discreteIntegrator',
      'piController',
      'filter',
    ],
  },

  limitedIntegrator: {
    description: [
      'Integrates its input and keeps the output between Lower limit and Upper limit: at a limit, integration stops while the input pushes further out, and an input of the other sign brings the output back at once (the Modelica library limited integrator). Use it for integral action that must not wind up.',
    ],
    ports: {
      u: 'Input signal, the rate of change of the output.',
      y: 'Output signal, the limited integral of u.',
    },
    parameters: {
      outMax: 'Upper limit of the output.',
      outMin: 'Lower limit of the output. Should be below Upper limit.',
      y_start:
        'Value of the output at the start of the run, inside the limits.',
    },
    equations: [
      'dy/dt = 0 if (y ≥ outMax and u > 0) or (y ≤ outMin and u < 0)',
      'dy/dt = u otherwise',
      'y = y_start at time 0',
    ],
    limitations: ['There is no reset input.'],
    seeAlso: ['integrator', 'piController', 'saturation'],
  },

  filter: {
    description: [
      'A first-order low-pass filter with unity DC gain (the Modelica library first-order block). The output follows the input with time constant τ, reaching about 63% of a step after τ.',
    ],
    ports: {
      u: 'Input signal.',
      y: 'Filtered output.',
    },
    parameters: {
      tau: 'Time constant τ, in seconds. At least 1e-5 s. The corner frequency is 1/(2π · tau) Hz.',
    },
    equations: [
      'dy/dt = (u − y) / tau, with y = 0 at time 0',
      'Transfer function: 1 / (tau · s + 1)',
    ],
    limitations: [
      'The output always starts at 0, so a nonzero input at time 0 gives a start-up transient.',
    ],
    seeAlso: ['secondOrder', 'derivative', 'rateLimiter'],
  },

  derivative: {
    description: [
      'Approximates the time derivative of its input, filtered by a first-order lag with Filter time τ (the Modelica library derivative). Smaller τ comes closer to the true derivative but amplifies noise and fast edges more.',
    ],
    ports: {
      u: 'Input signal.',
      y: 'Filtered derivative of u, in units of u per second.',
    },
    parameters: { tau: 'Filter time constant τ, in seconds. At least 1e-5 s.' },
    equations: [
      'dx/dt = (u − x) / tau',
      'y = (u − x) / tau',
      'Transfer function: s / (tau · s + 1)',
      'At time 0 the state is in steady state (x = u), so the output starts at 0.',
    ],
    limitations: [
      'A step in the input gives a spike of height step/tau rather than an impulse.',
    ],
    seeAlso: ['filter', 'pidController'],
  },

  secondOrder: {
    description: [
      'A second-order low-pass system with unity DC gain, set by natural frequency ωn and damping ratio ζ (the Modelica library second-order block). Use it to model a sensor, actuator, or loop with an oscillatory response.',
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
      'dy/dt = yd',
      'dyd/dt = wn · (wn · (u − y) − 2 · zeta · yd)',
      'y = yd = 0 at time 0',
      'Transfer function: wn² / (s² + 2 · zeta · wn · s + wn²)',
    ],
    limitations: ['Both states start at 0.'],
    seeAlso: ['filter', 'integrator'],
  },

  delay: {
    description: [
      'Delays its input by a fixed time T (the Modelica library fixed delay). Use it for transport or communication lag.',
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
      'Delays any signal by one sample: at each sample instant the output takes the value the input had at the previous instant. Every state updates at the sample instant, so exported C reproduces it exactly.',
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
    tips: [
      'Unlike the Modelica library unit delay, which only delays signals that are already sampled, this block delays a continuous input too.',
    ],
    seeAlso: ['zoh', 'delay', 'discreteIntegrator'],
  },

  zoh: {
    description: [
      'Samples its input every Ts seconds and holds the value until the next sample (the Modelica library zero-order hold). Use it to model an ADC or a sampled controller input.',
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
      'Clamps its input between a lower and an upper limit (the Modelica library limiter). Inside the limits the input passes unchanged.',
    ],
    ports: {
      u: 'Input signal.',
      y: 'Output signal, u limited to the range from Lower limit to Upper limit.',
    },
    parameters: {
      lower: 'Lower limit. Must not exceed Upper limit.',
      upper: 'Upper limit. Must not be below Lower limit.',
    },
    equations: ['y = max(lower, min(upper, u))'],
    limitations: [
      'A lower limit above the upper limit is a model error; the run stops with a message.',
    ],
    tips: [
      'To limit an integrator itself rather than its output, use Limited integrator.',
    ],
    seeAlso: ['deadzone', 'rateLimiter', 'min', 'max'],
  },

  deadzone: {
    description: [
      'Outputs zero while the input is within ±Half-width (the Modelica library dead zone). Outside that band the output is the input shifted toward zero by Half-width, so it is continuous at the band edges.',
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
      'Limits how fast its output can rise or fall (the Modelica library slew-rate limiter). The output tracks the input, moving no faster than Rising limit upward and Falling limit downward.',
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
      'dy/dt = min(rising, max(−falling, (u − y) / 0.001 s))',
      'At time 0 the output equals the input (steady state).',
    ],
    limitations: [
      'Tracking uses a fixed 1 ms time constant; signals faster than that are also smoothed.',
    ],
    seeAlso: ['saturation', 'filter', 'ramp'],
  },

  // Routing

  mux: {
    description: [
      'Joins several signals into one vector, in order, and carries it on one wire. The wire is drawn heavy so a bundle stands out from a single signal.',
      'Set the number of inputs (2 to 32) under Signals in the block’s properties; the bar grows to fit. An input may itself be a vector, which is added in place, so Muxes can be chained. Split the vector again with a Demux, or pass it through subsystem ports unchanged.',
    ],
    ports: {
      u1: 'First signal (or vector).',
      u2: 'Second signal (or vector).',
      u3: 'Third signal (or vector).',
      y: 'The inputs joined in order: as wide as all of them together.',
    },
    equations: [
      'y = {u1, u2, u3}  (a vector input contributes all its signals)',
    ],
    limitations: [
      'A vector wire can go only to a Demux, a Bus Selector, a Bus Creator, another Mux, or a subsystem port. Other blocks take one signal each and report an error; element-wise math on vectors is not available yet.',
      'Vectors are signals only, not Boolean or physical connections.',
      'Its signals have no names: in results they are numbered, as Mux.y[1], Mux.y[2]. Use a Bus Creator to name them.',
    ],
    tips: [
      'Log the vector wire to record every signal on it: Results shows one trace per signal.',
    ],
    seeAlso: ['demux', 'busCreator', 'busSelector'],
  },

  demux: {
    description: [
      'Splits a vector into its signals, in order: the counterpart of Mux.',
      'Set the number of outputs (2 to 32) under Signals in the block’s properties. The input is cut into that many equal parts, so with 6 signals and 2 outputs each output is itself a vector of 3. Match incoming sets the outputs to one per signal.',
    ],
    ports: {
      u: 'A vector, usually from a Mux.',
      y1: 'The first part of u.',
      y2: 'The second part of u.',
      y3: 'The third part of u.',
    },
    equations: [
      'y1 = u[1], y2 = u[2], y3 = u[3]  (with one signal per output)',
    ],
    limitations: [
      'The number of outputs must divide the width of the input; otherwise model checks report it.',
      'The parts are equal in size; to take signals by name, bundle them with a Bus Creator and use a Bus Selector.',
    ],
    seeAlso: ['mux', 'busSelector'],
  },

  busCreator: {
    description: [
      'Bundles signals into a bus: one wire that carries them all, each under a name. The names are the input labels on the block; edit them, and add or remove inputs, under Signals in its properties.',
      'An input may itself be a bus. Its signals keep their names below the input’s name, so a bus named motor holding speed becomes motor.speed. Pick signals out again with a Bus Selector, anywhere downstream and through any number of subsystem ports.',
    ],
    ports: {
      u1: 'The signal named by this input (signal1 by default), or a bus.',
      u2: 'The signal named by this input (signal2 by default), or a bus.',
      y: 'The bus: every input’s signals, in order, with their names.',
    },
    equations: ['bus = {u1, u2}  (a bus input contributes all its signals)'],
    limitations: [
      'Names are a letter, then letters, digits, or _, and must differ within one block.',
      'A bus is a vector of signals underneath: blocks other than Demux, Bus Selector, Mux, Bus Creator, and subsystem ports take one signal and report an error.',
    ],
    tips: [
      'Logging the bus wire records every signal on it under its name, such as Bus.speed.',
    ],
    seeAlso: ['busSelector', 'mux', 'subsystem'],
  },

  busSelector: {
    description: [
      'Picks signals out of a bus by name. Under Signals in its properties it lists everything on the incoming bus; each signal you tick becomes an output, labeled with its name, in the order you choose.',
      'Selecting the name of a bus inside the bus (motor, when the bus holds motor.speed and motor.current) gives all of its signals as one vector.',
    ],
    ports: {
      u: 'A bus, from a Bus Creator (or a vector from a Mux, whose signals are named signal1, signal2, …).',
      y1: 'The selected signal named on this output.',
    },
    equations: ['output = u[position of its name in the bus]'],
    limitations: [
      'A name the incoming bus does not have is reported by model checks, for example after the Bus Creator upstream renames it.',
      'Removing a signal from the selection removes its output and the wire on it.',
    ],
    seeAlso: ['busCreator', 'demux'],
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
