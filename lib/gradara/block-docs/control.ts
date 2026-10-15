import type { BlockDoc } from './types';

export const docs: Record<string, BlockDoc> = {
  clarke: {
    description: [
      'Converts three phase quantities (currents or voltages) into the two-axis stationary frame (α, β), using the amplitude-invariant form of the Modelica library space-phasor transform: a balanced set with peak Â gives α and β with the same peak Â.',
      'Use it with Park transform to turn measured motor currents into d/q currents.',
    ],
    ports: {
      ia: 'Phase a.',
      ib: 'Phase b.',
      ic: 'Phase c.',
      alpha: 'α axis, aligned with phase a.',
      beta: 'β axis, 90° ahead of α.',
    },
    equations: ['alpha = (2 · ia − ib − ic)/3', 'beta = (ib − ic)/√3'],
    limitations: [
      'Any zero-sequence (common-mode) component (ia + ib + ic)/3 is discarded; it does not appear in either output.',
    ],
    tips: [
      'All three inputs are used. Connect ic even when the phases sum to zero; it is not reconstructed from ia and ib.',
    ],
    seeAlso: ['park', 'inverseClarke', 'piController', 'pmSyncMachine'],
  },

  inverseClarke: {
    description: [
      'Converts a stationary-frame (α, β) pair back into three phase quantities, adding the zero-sequence input to each phase (the Modelica library space-phasor transform in reverse). It undoes Clarke transform exactly.',
      'In a field-oriented drive it turns the α, β voltage commands into the three phase voltages for the inverter.',
    ],
    ports: {
      alpha: 'α axis, aligned with phase a.',
      beta: 'β axis, 90° ahead of α.',
      zero: 'Zero-sequence (common-mode) component added to every phase. Wire a Constant 0 when there is none.',
      va: 'Phase a.',
      vb: 'Phase b.',
      vc: 'Phase c.',
    },
    equations: [
      'va = alpha + zero',
      'vb = −alpha/2 + (√3/2) · beta + zero',
      'vc = −alpha/2 − (√3/2) · beta + zero',
    ],
    tips: [
      'The zero input must be connected; it is how common-mode injection (third-harmonic or min–max) enters a modulator.',
    ],
    seeAlso: ['clarke', 'park', 'threePhaseSignalVoltage'],
  },

  park: {
    description: [
      'Rotates a stationary-frame (α, β) pair into a frame turning at the input angle (the Modelica library rotator). With the electrical rotor angle θe, `d` is the flux-aligned component and `q` the one 90° ahead of it: for motor currents, flux-producing and torque-producing.',
      'Uses the d-axis-aligned convention: at theta = 0, the d axis coincides with α. The same block rotates back: feed it −θe to turn d, q voltage commands into α, β.',
    ],
    ports: {
      alpha: 'α axis, typically from Clarke transform.',
      beta: 'β axis.',
      theta:
        'Electrical rotor angle θe, in radians (mechanical angle times pole pairs).',
      id: 'd axis.',
      iq: 'q axis.',
    },
    equations: [
      'id = alpha · cos(theta) + beta · sin(theta)',
      'iq = −alpha · sin(theta) + beta · cos(theta)',
    ],
    limitations: [
      'Uses theta as given: no angle estimation, filtering, or sensor delay.',
    ],
    tips: [
      'Feed theta from an Angle sensor on the rotor through a Gain of the pole pairs. A mechanical angle gives wrong d/q values unless the machine has one pole pair.',
      'For the inverse rotation, negate theta with Unary minus.',
    ],
    seeAlso: [
      'clarke',
      'inverseClarke',
      'piController',
      'pmSyncMachine',
      'angleSensor',
    ],
  },

  piController: {
    description: [
      'A continuous PI controller with output limits and anti-windup, from the Modelica library (LimPID with a PI structure). It forms the error between the reference and the measurement itself, so no Subtract block is needed.',
      'When the output reaches a limit, back-calculation pulls the integral back so the controller leaves saturation without overshoot.',
    ],
    ports: {
      reference: 'Setpoint.',
      measured: 'Measured value, in the same units as the reference.',
      y: 'Controller output, limited to the range from Lower limit to Upper limit.',
    },
    parameters: {
      k: 'Gain, applied to both the proportional and the integral term. Must not be 0.',
      Ti: 'Integral time, in seconds: the integral gain is k / Ti. Larger values mean slower integral action.',
      yMax: 'Upper limit of the output.',
      yMin: 'Lower limit of the output.',
    },
    equations: [
      'e = reference − measured',
      'v = k · (e + xi)',
      'y = max(yMin, min(yMax, v))',
      'dxi/dt = (e + (y − v)/(k · 0.9)) / Ti, with xi = 0 at time 0',
    ],
    limitations: [
      'The anti-windup time constant is Ti · Ni with the library default Ni = 0.9; it is not adjustable here.',
      'Continuous: for a fixed-rate controller that exports to C exactly, use PI (discrete).',
    ],
    tips: [
      'Converting from proportional and integral gains kp, ki: k = kp and Ti = kp / ki.',
    ],
    seeAlso: ['pidController', 'pi', 'limitedIntegrator', 'saturation'],
  },

  pidController: {
    description: [
      'A continuous PID controller with a filtered derivative, output limits and anti-windup, from the Modelica library (LimPID with a PID structure). It forms the error between the reference and the measurement itself.',
      'The derivative acts on the measurement only (set-point weight 0), so a reference step causes no derivative kick.',
    ],
    ports: {
      reference: 'Setpoint.',
      measured: 'Measured value, in the same units as the reference.',
      y: 'Controller output, limited to the range from Lower limit to Upper limit.',
    },
    parameters: {
      k: 'Gain, applied to every term. Must not be 0.',
      Ti: 'Integral time, in seconds: the integral gain is k / Ti.',
      Td: 'Derivative time, in seconds: the derivative gain is k · Td. 0 or more.',
      Nd: 'Derivative filter ratio: the derivative is filtered with time constant Td / Nd. At least 1; 10 is usual.',
      yMax: 'Upper limit of the output.',
      yMin: 'Lower limit of the output.',
    },
    equations: [
      'e = reference − measured',
      'dxd/dt = (−measured − xd) / (Td/Nd)',
      'v = k · (e + xi + Td · (−measured − xd) / (Td/Nd))',
      'y = max(yMin, min(yMax, v))',
      'dxi/dt = (e + (y − v)/(k · 0.9)) / Ti, with xi = xd = 0 at time 0',
    ],
    limitations: [
      'The anti-windup time constant is Ti · Ni with the library default Ni = 0.9; the set-point weights are fixed at 1 (proportional) and 0 (derivative).',
      'Continuous: for a fixed-rate controller that exports to C exactly, use Discrete PID.',
    ],
    tips: [
      'Converting from parallel gains kp, ki, kd: k = kp, Ti = kp / ki, Td = kd / kp.',
    ],
    seeAlso: ['piController', 'discretePID', 'derivative', 'saturation'],
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
        'Output limit, at least 0.001, in the unit of the output. Clamps both the output and the integral to ±limit.',
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
      'No derivative term. For one, use Discrete PID; for a continuous controller with back-calculation anti-windup, use PI (continuous).',
      'The error is read only at sample instants; nothing between samples is seen.',
    ],
    tips: [
      'Choose samplePeriod well below the loop’s time constants; each sample is a simulation event.',
    ],
    seeAlso: [
      'discretePID',
      'pidController',
      'piController',
      'zoh',
      'saturation',
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
    seeAlso: ['pi', 'pidController', 'zoh', 'unitDelay', 'discreteIntegrator'],
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
    seeAlso: ['pulse', 'pwmSignal', 'booleanStep', 'booleanToReal'],
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
