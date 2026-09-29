import type { BlockDoc } from './types';

export const docs: Record<string, BlockDoc> = {
  pwmPair: {
    description: [
      'Generates two complementary gate signals at a fixed switching frequency and duty cycle. `high` is 1 for the first `duty` fraction of each period and 0 for the rest; `low` is always its complement.',
      'Use it to drive the two switches of a half bridge, such as the high-side and low-side switches of a buck converter.',
    ],
    ports: {
      high: 'High-side gate signal, 0 or 1. Starts at 1 at t = 0.',
      low: 'Low-side gate signal, 1 − high.',
    },
    parameters: {
      frequency:
        'Switching frequency, in hertz, from 1 Hz to 1 MHz. The period is 1/frequency.',
      duty: 'Fraction of each period that `high` is 1, from 0 to 1.',
    },
    equations: [
      'T = 1/frequency',
      'high = 1 when (t mod T) < duty · T, otherwise 0',
      'low = 1 − high',
    ],
    limitations: [
      'Both outputs switch at the same instant, with no dead time, rise time, or switching delay.',
      'Frequency and duty are fixed during a run. For a duty cycle driven by a signal, use PWM generator.',
      'Pulses begin at t = 0; there is no start delay or phase offset.',
    ],
    tips: [
      'The pulse comes from the MSL BooleanPulse with width = 100 · duty %. That source declares a pulse width greater than 0, so duty = 0 lies outside its stated range; use a small positive duty instead.',
      'Every edge is a simulation event. A high frequency over a long run means many events and a slower simulation.',
    ],
    seeAlso: ['pwmSignal', 'booleanPulse', 'idealSwitch', 'buckConverter'],
  },

  currentPI: {
    description: [
      'A continuous PI controller with a symmetric output limit and back-calculation anti-windup. The input is the current error; the output is a voltage command.',
      'In the field-oriented control example, one instance regulates the d-axis current and another the q-axis current.',
    ],
    ports: {
      u: 'Control error, typically current reference minus measured current, in amperes.',
      y: 'Voltage command, in volts, limited to ±limit.',
    },
    parameters: {
      kp: 'Proportional gain, in volts per unit of error.',
      ki: 'Integral gain: the integral state rises at ki · u per second.',
      kaw: 'Anti-windup gain, in 1/s, 0 or more. How fast the integral state is pulled back while the output is limited. 0 disables anti-windup.',
      limit:
        'Output limit, in volts, at least 0.1. The output is clamped to ±limit.',
    },
    equations: [
      'raw = kp · u + x',
      'y = max(−limit, min(limit, raw))',
      'dx/dt = ki · u + kaw · (y − raw),  x(0) = 0',
    ],
    limitations: [
      'Continuous time: no sampling, computation delay, or quantization.',
      'The limit is symmetric and fixed. It does not track the available DC-bus voltage.',
      'The integral state is not clamped directly; it is held back only through the kaw term.',
    ],
    tips: [
      'While y is within ±limit, y − raw = 0 and the block is a plain PI. Once the output limits, the kaw term drives x toward the value that just brings raw back to the limit.',
      'A starting point for kaw is ki/kp, which is the default ratio (700/2 = 350).',
    ],
    seeAlso: ['park', 'inversePark', 'pi', 'pid', 'discretePID', 'pmsm'],
  },

  clarke: {
    description: [
      'Converts three phase currents into the two-axis stationary frame (α, β), using the amplitude-invariant form: a balanced set of phase currents with peak Î gives α and β with the same peak Î.',
      'Use it with Park transform to turn measured motor currents into d/q currents.',
    ],
    ports: {
      ia: 'Phase a current, in amperes.',
      ib: 'Phase b current, in amperes.',
      ic: 'Phase c current, in amperes.',
      alpha: 'α-axis current, in amperes, aligned with phase a.',
      beta: 'β-axis current, in amperes, 90° ahead of α.',
    },
    equations: ['alpha = (2 · ia − ib − ic)/3', 'beta = (ib − ic)/√3'],
    limitations: [
      'Any zero-sequence (common-mode) component ia + ib + ic is discarded; it does not appear in either output.',
    ],
    tips: [
      'All three currents are used. Connect ic even when the phases sum to zero; it is not reconstructed from ia and ib.',
    ],
    seeAlso: ['park', 'inversePark', 'currentPI', 'pmsm'],
  },

  park: {
    description: [
      'Rotates stationary-frame (α, β) quantities into the rotor d/q frame at the electrical angle theta. With theta aligned to the rotor flux, `id` is the flux-producing current and `iq` the torque-producing current.',
      'Uses the d-axis-aligned convention: at theta = 0, the d axis coincides with α.',
    ],
    ports: {
      alpha: 'α-axis current, in amperes, typically from Clarke transform.',
      beta: 'β-axis current, in amperes.',
      theta:
        'Electrical rotor angle θe, in radians (mechanical angle times pole pairs).',
      id: 'd-axis current, in amperes.',
      iq: 'q-axis current, in amperes.',
    },
    equations: [
      'id = alpha · cos(theta) + beta · sin(theta)',
      'iq = −alpha · sin(theta) + beta · cos(theta)',
    ],
    limitations: [
      'Uses theta as given: no angle estimation, filtering, or sensor delay.',
    ],
    tips: [
      'Feed theta from the PMSM’s θe output. A mechanical angle gives wrong d/q currents unless the motor has one pole pair.',
    ],
    seeAlso: ['clarke', 'inversePark', 'currentPI', 'pmsm'],
  },

  inversePark: {
    description: [
      'Converts d/q voltage commands into three phase-voltage commands: an inverse Park rotation by theta followed by the amplitude-invariant inverse Clarke transform.',
      'It is the exact inverse of Park transform followed by Clarke transform for a set without zero sequence, so the output amplitude equals √(vd² + vq²).',
    ],
    ports: {
      vd: 'd-axis voltage command, in volts.',
      vq: 'q-axis voltage command, in volts.',
      theta: 'Electrical rotor angle θe, in radians.',
      va: 'Phase a voltage command, in volts.',
      vb: 'Phase b voltage command, in volts.',
      vc: 'Phase c voltage command, in volts.',
    },
    equations: [
      'alpha = vd · cos(theta) − vq · sin(theta)',
      'beta = vd · sin(theta) + vq · cos(theta)',
      'va = alpha',
      'vb = −alpha/2 + (√3/2) · beta',
      'vc = −alpha/2 − (√3/2) · beta',
    ],
    limitations: [
      'The outputs always sum to zero: no common-mode injection or space-vector modulation.',
      'No voltage limit or overmodulation handling; limit vd and vq upstream or in the inverter.',
    ],
    tips: ['Use the same theta as the Park transform on the measurement side.'],
    seeAlso: ['park', 'clarke', 'inverter', 'currentPI', 'pmsm'],
  },

  pi: {
    description: [
      'A sampled PI controller acting on the error between a reference and a measurement. At each sample it updates a clamped integral and computes a saturated output, which then holds until the next sample.',
      'Use it for loops such as motor speed or output-voltage regulation where a fixed controller rate matters.',
    ],
    ports: {
      reference: 'Setpoint.',
      measured: 'Measured value, in the same units as the reference.',
      y: 'Controller output, held between samples and limited to ±limit.',
    },
    parameters: {
      kp: 'Proportional gain.',
      ki: 'Integral gain, per second.',
      limit:
        'Output limit, at least 0.1. Clamps both the output and the integral to ±limit. Labeled in volts, but it applies in whatever unit the output uses.',
      samplePeriod:
        'Sample period Ts, in seconds, at least 0.1 ms. The first sample is at t = 0.',
    },
    equations: [
      'error = reference − measured',
      'At t = k · samplePeriod:',
      '  integral = max(−limit, min(limit, integral⁻ + samplePeriod · ki · error))',
      '  y = max(−limit, min(limit, kp · error + integral))',
      'integral⁻ is the value from the previous sample; integral starts at 0.',
    ],
    limitations: [
      'The integral is updated with the current error (backward Euler), so a step in error affects y at the same sample, with no computation delay.',
      'Anti-windup is a clamp on the integral at ±limit, not back-calculation. The integral can still sit at the limit while the proportional term alone saturates the output.',
      'No derivative term. For one, use Discrete PID.',
      'The error is read only at sample instants; nothing between samples is seen.',
    ],
    tips: [
      'Choose samplePeriod well below the loop’s time constants; each sample is a simulation event.',
    ],
    seeAlso: ['discretePID', 'pid', 'currentPI', 'zoh', 'saturation'],
  },

  pid: {
    description: [
      'A continuous parallel PID controller acting on an error input. The derivative term is filtered by a first-order low-pass with time constant tf.',
      'The block has no output limit or anti-windup.',
    ],
    ports: {
      u: 'Control error, typically reference minus measurement.',
      y: 'Controller output.',
    },
    parameters: {
      kp: 'Proportional gain.',
      ki: 'Integral gain, per second.',
      kd: 'Derivative gain, in seconds.',
      tf: 'Derivative filter time constant, in seconds, at least 0.1 ms. Smaller values give a purer derivative and more noise gain.',
    },
    equations: [
      'dxi/dt = u,  xi(0) = 0',
      'dxf/dt = (u − xf)/tf,  xf(0) = 0',
      'y = kp · u + ki · xi + kd · (u − xf)/tf',
      'Transfer function: y/u = kp + ki/s + kd · s/(tf · s + 1)',
    ],
    limitations: [
      'No output saturation and no anti-windup: the integral grows without bound while the error persists.',
      'The derivative acts on the error, so a step in the reference produces a derivative kick of kd/tf times the step.',
      'The filter state xf starts at 0, so a nonzero error at t = 0 also gives an initial derivative kick of kd · u(0)/tf.',
    ],
    tips: [
      'To limit the output, follow the block with Saturation, keeping in mind the integral still winds up.',
    ],
    seeAlso: [
      'discretePID',
      'pi',
      'currentPI',
      'saturation',
      'derivative',
      'integrator',
    ],
  },

  discretePID: {
    description: [
      'A sampled PID controller acting on the error between a reference and a measurement. At each sample it updates a clamped integral and a filtered derivative, then computes a saturated output that holds until the next sample.',
      'All states change only at sample instants, so the block behaves like a fixed-rate control routine.',
    ],
    ports: {
      reference: 'Setpoint.',
      measured: 'Measured value, in the same units as the reference.',
      y: 'Controller output, held between samples and limited to ±limit.',
    },
    parameters: {
      kp: 'Proportional gain.',
      ki: 'Integral gain, per second.',
      kd: 'Derivative gain, in seconds.',
      filterTime:
        'Derivative filter time constant Tf, in seconds, at least 0.1 ms.',
      limit:
        'Output limit, at least 0.001. Clamps both the output and the integral to ±limit.',
      samplePeriod:
        'Sample period Ts, in seconds, at least 0.1 ms. The first sample is at t = 0.',
    },
    equations: [
      'At t = k · samplePeriod, with ⁻ marking the previous sample’s value:',
      '  e = reference − measured',
      '  integral = max(−limit, min(limit, integral⁻ + samplePeriod · ki · e))',
      '  derivative = (filterTime · derivative⁻ + kd · (e − e⁻))/(filterTime + samplePeriod)',
      '  y = max(−limit, min(limit, kp · e + integral + derivative))',
      'integral, derivative, and e⁻ start at 0.',
    ],
    limitations: [
      'The derivative is a backward-Euler discretization of kd · s/(Tf · s + 1), acting on the error, so a reference step causes a derivative kick.',
      'e⁻ starts at 0, so a nonzero error at the first sample gives a derivative kick of kd · e/(filterTime + samplePeriod).',
      'Anti-windup is a clamp on the integral at ±limit, not back-calculation.',
      'The integral uses the current error, so there is no one-sample computation delay.',
    ],
    tips: [
      'The same limit bounds the integral and the output; they cannot be set separately.',
    ],
    seeAlso: ['pi', 'pid', 'zoh', 'unitDelay', 'discreteIntegrator'],
  },

  logicAnd: {
    description: ['True when both inputs are true.'],
    ports: {
      u1: 'First Boolean input.',
      u2: 'Second Boolean input.',
      y: 'u1 and u2.',
    },
    equations: ['y = u1 ∧ u2'],
    seeAlso: ['logicOr', 'logicNand', 'logicXor', 'logicNot'],
  },

  logicOr: {
    description: ['True when at least one input is true.'],
    ports: {
      u1: 'First Boolean input.',
      u2: 'Second Boolean input.',
      y: 'u1 or u2.',
    },
    equations: ['y = u1 ∨ u2'],
    seeAlso: ['logicAnd', 'logicNor', 'logicXor', 'logicNot'],
  },

  logicXor: {
    description: ['True when exactly one of the two inputs is true.'],
    ports: {
      u1: 'First Boolean input.',
      u2: 'Second Boolean input.',
      y: 'u1 xor u2.',
    },
    equations: ['y = ¬((u1 ∧ u2) ∨ (¬u1 ∧ ¬u2))'],
    seeAlso: ['logicAnd', 'logicOr', 'logicNot'],
  },

  logicNand: {
    description: ['False only when both inputs are true.'],
    ports: {
      u1: 'First Boolean input.',
      u2: 'Second Boolean input.',
      y: 'not (u1 and u2).',
    },
    equations: ['y = ¬(u1 ∧ u2)'],
    seeAlso: ['logicAnd', 'logicNor', 'logicNot'],
  },

  logicNor: {
    description: ['True only when both inputs are false.'],
    ports: {
      u1: 'First Boolean input.',
      u2: 'Second Boolean input.',
      y: 'not (u1 or u2).',
    },
    equations: ['y = ¬(u1 ∨ u2)'],
    seeAlso: ['logicOr', 'logicNand', 'logicNot', 'rsFlipFlop'],
  },

  logicNot: {
    description: ['Inverts a Boolean signal.'],
    ports: { u: 'Boolean input.', y: 'not u.' },
    equations: ['y = ¬u'],
    seeAlso: ['logicAnd', 'logicOr', 'logicNand', 'logicNor'],
  },

  greaterThreshold: {
    description: [
      'True while the input is strictly greater than a fixed threshold.',
    ],
    ports: { u: 'Real input.', y: 'True while u > threshold.' },
    parameters: {
      threshold: 'Comparison level, in the units of u. Any real number.',
    },
    equations: ['y = u > threshold'],
    limitations: [
      'No hysteresis: a noisy input near the threshold toggles the output at every crossing. Use Hysteresis to avoid chatter.',
    ],
    seeAlso: ['lessThreshold', 'greater', 'boolHysteresis', 'booleanToReal'],
  },

  lessThreshold: {
    description: [
      'True while the input is strictly less than a fixed threshold.',
    ],
    ports: { u: 'Real input.', y: 'True while u < threshold.' },
    parameters: {
      threshold: 'Comparison level, in the units of u. Any real number.',
    },
    equations: ['y = u < threshold'],
    limitations: [
      'No hysteresis: a noisy input near the threshold toggles the output at every crossing. Use Hysteresis to avoid chatter.',
    ],
    seeAlso: ['greaterThreshold', 'less', 'boolHysteresis', 'booleanToReal'],
  },

  greater: {
    description: [
      'Compares two signals: true while u1 is strictly greater than u2.',
    ],
    ports: {
      u1: 'First Real input.',
      u2: 'Second Real input, in the same units as u1.',
      y: 'True while u1 > u2.',
    },
    equations: ['y = u1 > u2'],
    limitations: ['No hysteresis; equal inputs give false.'],
    seeAlso: ['less', 'greaterThreshold', 'onOffController'],
  },

  less: {
    description: [
      'Compares two signals: true while u1 is strictly less than u2.',
    ],
    ports: {
      u1: 'First Real input.',
      u2: 'Second Real input, in the same units as u1.',
      y: 'True while u1 < u2.',
    },
    equations: ['y = u1 < u2'],
    limitations: ['No hysteresis; equal inputs give false.'],
    seeAlso: ['greater', 'lessThreshold', 'onOffController'],
  },

  boolHysteresis: {
    description: [
      'A Schmitt trigger: the output turns true when the input rises above uHigh and turns false only when it falls below uLow. Between the two thresholds it keeps its previous value.',
      'The output starts false.',
    ],
    ports: { u: 'Real input.', y: 'Boolean output.' },
    parameters: {
      uLow: 'Lower threshold. When y is true and u < uLow, y becomes false. Must be less than uHigh.',
      uHigh:
        'Upper threshold. When y is false and u > uHigh, y becomes true. Must be greater than uLow.',
    },
    equations: [
      'y = (¬y⁻ ∧ u > uHigh) ∨ (y⁻ ∧ u ≥ uLow)',
      'y⁻ is the value just before the current event; y⁻ = false at t = 0.',
    ],
    limitations: ['The simulation stops with an error unless uHigh > uLow.'],
    tips: [
      'For a thermostat-style loop around a moving setpoint, On-off controller expresses the band relative to a reference signal.',
    ],
    seeAlso: ['onOffController', 'relay', 'greaterThreshold', 'booleanToReal'],
  },

  onOffController: {
    description: [
      'A bang-bang controller with a band around a reference. The output turns true when the measurement falls below reference − bandwidth/2 and turns false when it reaches reference + bandwidth/2. Inside the band it keeps its previous value.',
      'The output starts false. Use it for heaters, pumps, and other on/off actuators.',
    ],
    ports: {
      reference: 'Setpoint.',
      u: 'Measured value, in the same units as the reference.',
      y: 'Actuator command: true means on.',
    },
    parameters: {
      bandwidth:
        'Total width of the band around the reference, 0 or more. 0 gives a plain comparison, u < reference.',
    },
    equations: [
      'y = (y⁻ ∧ u < reference + bandwidth/2) ∨ (u < reference − bandwidth/2)',
      'y⁻ is the value just before the current event; y⁻ = false at t = 0.',
    ],
    limitations: [
      'The output is true when the measurement is low, so it suits heating-type actuators. For cooling, invert it with NOT.',
    ],
    tips: [
      'Convert the output with Boolean to real to drive a Real-valued actuator.',
    ],
    seeAlso: ['boolHysteresis', 'relay', 'logicNot', 'booleanToReal'],
  },

  logicSwitch: {
    description: [
      'Selects between two Real signals with a Boolean input: the output follows u1 while u2 is true, otherwise u3.',
    ],
    ports: {
      u2: 'Boolean selector.',
      u1: 'Real input passed through while u2 is true.',
      u3: 'Real input passed through while u2 is false.',
      y: 'Selected signal.',
    },
    equations: ['y = u1 if u2, otherwise u3'],
    limitations: [
      'The switchover is instantaneous, so y jumps when u1 and u3 differ.',
    ],
    tips: [
      'To select by comparing a Real control signal with a threshold instead, use Switch.',
    ],
    seeAlso: ['switch2', 'manualSwitch', 'greaterThreshold', 'booleanToReal'],
  },

  rsFlipFlop: {
    description: [
      'A set/reset latch built from two cross-coupled NOR gates. S sets Q true, R resets it, and with both false Q keeps its value.',
      'Q starts false and Q̄ starts true.',
    ],
    ports: {
      S: 'Set input.',
      R: 'Reset input.',
      Q: 'Latched output.',
      QI: 'Q̄, normally the complement of Q.',
    },
    equations: [
      'Q = ¬(R ∨ QI)',
      'QI = pre(¬(S ∨ Q)), with pre(…) = true at t = 0',
      'pre(…) breaks the algebraic loop; the latch settles within the event iteration at the same instant.',
    ],
    limitations: [
      'With S and R both true, Q and QI are both false, so QI is not the complement of Q in that state.',
      'No propagation delay, setup, or hold times.',
    ],
    seeAlso: ['logicNor', 'edge', 'triggeredSampler', 'timer'],
  },

  timer: {
    description: [
      'Measures how long the Boolean input has been true. The output is the time since the latest rising edge of u, and 0 while u is false.',
    ],
    ports: {
      u: 'Boolean input.',
      y: 'Elapsed time since u became true, in seconds; 0 while u is false.',
    },
    equations: [
      'At each rising edge of u: entryTime = t',
      'y = t − entryTime while u, otherwise 0',
      'entryTime = 0 at the start.',
    ],
    limitations: [
      'If u is already true at the start, no rising edge occurs; entryTime stays 0 and y equals the simulation time t.',
    ],
    tips: ['Compare y with Greater than threshold to build an on-delay.'],
    seeAlso: ['greaterThreshold', 'edge', 'clock', 'rsFlipFlop'],
  },

  booleanToReal: {
    description: [
      'Converts a Boolean signal to a Real one: realTrue while the input is true, realFalse otherwise.',
    ],
    ports: { u: 'Boolean input.', y: 'realTrue or realFalse.' },
    parameters: {
      realTrue: 'Output while u is true. Any real number.',
      realFalse: 'Output while u is false. Any real number.',
    },
    equations: ['y = realTrue if u, otherwise realFalse'],
    limitations: [
      'The output jumps between the two values with no ramp or delay.',
    ],
    seeAlso: ['logicSwitch', 'greaterThreshold', 'onOffController'],
  },

  booleanConstant: {
    description: [
      'Outputs true for the whole run. Use it to hold an enable or select input on.',
    ],
    ports: { y: 'Always true.' },
    equations: ['y = true'],
    tips: ['For a constant false, follow it with NOT.'],
    seeAlso: ['booleanStep', 'logicNot', 'constant'],
  },

  booleanStep: {
    description: [
      'Outputs false before the step time and true from then on. Use it to enable part of a model partway through a run.',
    ],
    ports: { y: 'False for t < startTime, true for t ≥ startTime.' },
    parameters: {
      startTime:
        'Time of the step, in seconds, 0 or more. At 0 the output is true from the start.',
    },
    equations: ['y = t ≥ startTime'],
    tips: ['For a true-to-false step, follow it with NOT.'],
    seeAlso: ['booleanPulse', 'booleanConstant', 'step', 'edge'],
  },

  booleanPulse: {
    description: [
      'A periodic Boolean pulse train. From startTime on, each period begins with the output true for width percent of the period, then false for the rest. Before startTime the output is false.',
    ],
    ports: { y: 'Boolean pulse train.' },
    parameters: {
      width:
        'Fraction of each period that the output is true, in percent. The underlying MSL source requires it to be greater than 0 and at most 100.',
      period: 'Period, in seconds. Must be greater than 0.',
      startTime: 'Time of the first rising edge, in seconds.',
    },
    equations: [
      'At t = startTime + k · period: pulseStart = t',
      'y = pulseStart ≤ t < pulseStart + period · width/100',
      'pulseStart = startTime at the start.',
    ],
    limitations: [
      'Edges are instantaneous. Every edge is a simulation event, so a short period over a long run slows the simulation.',
    ],
    tips: [
      'For a Real-valued pulse, use Pulse, or convert this output with Boolean to real.',
    ],
    seeAlso: ['pulse', 'pwmPair', 'booleanStep', 'booleanToReal'],
  },

  triggeredSampler: {
    description: [
      'Samples a Real input at each rising edge of a Boolean trigger and holds that value until the next rising edge.',
    ],
    ports: {
      trigger:
        'Boolean trigger. The input is sampled each time it changes from false to true.',
      u: 'Real input to sample.',
      y: 'Last sampled value; y_start until the first rising edge.',
    },
    parameters: {
      y_start:
        'Output before the first rising edge of the trigger. Any real number.',
    },
    equations: [
      'At each rising edge of trigger: y = u',
      'y = y_start at the start.',
    ],
    limitations: [
      'A trigger that is already true at the start does not sample; the first sample is at its next rising edge.',
    ],
    tips: ['For sampling at a fixed rate, use Zero-order hold.'],
    seeAlso: ['zoh', 'edge', 'booleanPulse', 'unitDelay'],
  },

  edge: {
    description: [
      'Detects rising edges: the output is true only at the event instant when the input changes from false to true, and false at all other times.',
    ],
    ports: {
      u: 'Boolean input.',
      y: 'True at the instant u rises, otherwise false.',
    },
    equations: [
      'y = u ∧ ¬u⁻',
      'u⁻ is the value just before the current event; u⁻ = false at t = 0.',
    ],
    limitations: [
      'The true pulse has zero duration, so it may not be visible in plotted results.',
      'Because u⁻ starts false, an input that is true at t = 0 gives y = true at t = 0.',
    ],
    tips: [
      'Use it to trigger discrete actions such as Triggered sampler or the S input of RS flip-flop.',
    ],
    seeAlso: ['triggeredSampler', 'rsFlipFlop', 'timer', 'booleanStep'],
  },
};
