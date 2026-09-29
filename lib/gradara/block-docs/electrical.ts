import type { BlockDoc } from './types';

export const docs: Record<string, BlockDoc> = {
  // Reference and passive elements

  ground: {
    description: [
      'Fixes the potential of the node it connects to at 0 V. Every electrical circuit needs at least one Ground so its node voltages are defined.',
    ],
    ports: {
      p: 'Pin held at 0 V. Takes whatever current the circuit returns to it.',
    },
    equations: ['p.v = 0'],
    tips: [
      'Connect one Ground to each electrically separate circuit, for example to each side of a transformer.',
    ],
    seeAlso: ['dcSource', 'voltageSensor'],
  },

  resistor: {
    description: [
      'An ideal linear resistor between its two pins: the voltage across it is proportional to the current through it (Ohm’s law).',
    ],
    ports: {
      p: 'Positive pin. Current into p is counted as positive.',
      n: 'Negative pin.',
    },
    parameters: { R: 'Resistance, in ohms. At least 1 µΩ.' },
    equations: ['v = p.v − n.v', 'i = p.i, p.i + n.i = 0', 'v = R · i'],
    limitations: [
      'No temperature dependence, noise, or inductance. For heating, use Resistor (thermal).',
    ],
    seeAlso: [
      'heatingResistor',
      'variableResistor',
      'conductor',
      'potentiometer',
    ],
  },

  conductor: {
    description: [
      'An ideal linear conductor: the current through it is proportional to the voltage across it. It is a resistor specified by conductance, which allows G = 0 (an open circuit).',
    ],
    ports: {
      p: 'Positive pin. Current into p is counted as positive.',
      n: 'Negative pin.',
    },
    parameters: {
      G: 'Conductance, in siemens. 0 or more; 0 makes the block an open circuit.',
    },
    equations: ['v = p.v − n.v', 'i = p.i, p.i + n.i = 0', 'i = G · v'],
    limitations: [
      'No temperature dependence (the MSL temperature coefficient is fixed at 0).',
    ],
    seeAlso: ['resistor', 'variableResistor'],
  },

  capacitor: {
    description: [
      'An ideal linear capacitor. The current through it is proportional to the rate of change of the voltage across it.',
    ],
    ports: {
      p: 'Positive pin. Current into p charges the capacitor.',
      n: 'Negative pin.',
    },
    parameters: { C: 'Capacitance, in farads. At least 1 pF.' },
    equations: [
      'v = p.v − n.v',
      'p.i + n.i = 0',
      'C · dv/dt = p.i',
      'v(0) = 0',
    ],
    limitations: [
      'Starts discharged: the initial voltage is fixed at 0 V and cannot be changed.',
      'No leakage, series resistance, or voltage limit.',
    ],
    tips: [
      'Connecting it directly across a voltage source forces an instant change in its voltage; add a small series resistor.',
    ],
    seeAlso: ['variableCapacitor', 'supercap', 'inductor'],
  },

  inductor: {
    description: [
      'An ideal linear inductor. The voltage across it is proportional to the rate of change of the current through it.',
    ],
    ports: {
      p: 'Positive pin. Current into p is counted as positive.',
      n: 'Negative pin.',
    },
    parameters: { L: 'Inductance, in henries. At least 1 pH.' },
    equations: [
      'v = p.v − n.v',
      'i = p.i, p.i + n.i = 0',
      'L · di/dt = v',
      'i(0) = 0',
    ],
    limitations: [
      'Starts with zero current; the initial current is fixed and cannot be changed.',
      'No saturation, winding resistance, or core losses. For saturation, use Saturating inductor.',
    ],
    tips: [
      'Do not break an inductor’s current path with an ideal switch or open circuit: the current cannot jump to 0. Give it a freewheeling path, such as a diode.',
    ],
    seeAlso: [
      'saturatingInductor',
      'variableInductor',
      'mutualInductor',
      'capacitor',
    ],
  },

  heatingResistor: {
    description: [
      'A linear resistor with a thermal port. Its resistance changes linearly with the port temperature, and all of its electrical loss flows out of the port as heat.',
      'Use it to couple an electrical circuit to a thermal model, for example a heater or a winding that warms up.',
    ],
    ports: {
      p: 'Positive pin. Current into p is counted as positive.',
      n: 'Negative pin.',
      heatPort:
        'Thermal port. Its temperature sets the resistance; the loss power leaves through it.',
    },
    parameters: {
      R: 'Resistance at the reference temperature, in ohms. 0 or more.',
      T_ref:
        'Reference temperature, in kelvin, at which the resistance equals R.',
      alpha:
        'Linear temperature coefficient, in 1/K. The default 0.0039 is close to copper; 0 gives a constant resistance.',
    },
    equations: [
      'v = p.v − n.v, i = p.i, p.i + n.i = 0',
      'R_actual = R · (1 + alpha · (heatPort.T − T_ref))',
      'v = R_actual · i',
      'heatPort.Q_flow = −v · i',
    ],
    limitations: [
      'The simulation stops with an error if 1 + alpha · (heatPort.T − T_ref) falls to 0 or below.',
      'Linear temperature dependence only; no inductance or thermal mass of its own.',
    ],
    tips: [
      'The heat port must be connected. Attach a Heat capacitor for the resistor’s own thermal mass, or a Fixed temperature to hold it constant.',
    ],
    seeAlso: [
      'resistor',
      'heatCapacitor',
      'thermalConductor',
      'fixedTemperature',
    ],
  },

  variableResistor: {
    description: [
      'A linear resistor whose resistance is set at each instant by an input signal. Use it for loads, sensors, or resistances that change during a run.',
    ],
    ports: {
      R: 'Resistance, in ohms.',
      p: 'Positive pin. Current into p is counted as positive.',
      n: 'Negative pin.',
    },
    equations: ['v = p.v − n.v, i = p.i, p.i + n.i = 0', 'v = R · i'],
    limitations: [
      'No temperature dependence.',
      'The input is not checked: a negative value gives a negative resistance, which supplies power.',
    ],
    tips: [
      'An input of exactly 0 is a short circuit. Keep it above 0 unless the circuit tolerates a short.',
    ],
    seeAlso: ['resistor', 'potentiometer', 'conductor'],
  },

  variableCapacitor: {
    description: [
      'A capacitor whose capacitance is set by an input signal. The charge is capacitance times voltage, so changing the capacitance at fixed charge changes the voltage.',
    ],
    ports: {
      C: 'Capacitance, in farads. Must stay 0 or more.',
      p: 'Positive pin. Current into p is counted as positive.',
      n: 'Negative pin.',
    },
    parameters: {
      Cmin: 'Lower bound on the capacitance used in the equations, in farads. Keeps the model solvable when the input reaches 0.',
    },
    equations: [
      'v = p.v − n.v, i = p.i, p.i + n.i = 0',
      'Q = max(C, Cmin) · v',
      'i = dQ/dt',
    ],
    limitations: [
      'The simulation stops with an error if the input goes negative.',
      'The initial voltage is not fixed by the block.',
    ],
    seeAlso: ['capacitor', 'variableInductor', 'variableResistor'],
  },

  variableInductor: {
    description: [
      'An inductor whose inductance is set by an input signal. The flux linkage is inductance times current, so changing the inductance at fixed flux changes the current.',
    ],
    ports: {
      L: 'Inductance, in henries. Must stay 0 or more.',
      p: 'Positive pin. Current into p is counted as positive.',
      n: 'Negative pin.',
    },
    parameters: {
      Lmin: 'Lower bound on the inductance used in the equations, in henries. Keeps the model solvable when the input reaches 0.',
    },
    equations: [
      'v = p.v − n.v, i = p.i, p.i + n.i = 0',
      'Psi = max(L, Lmin) · i',
      'v = dPsi/dt',
    ],
    limitations: [
      'The simulation stops with an error if the input goes negative.',
      'The initial current is not fixed by the block.',
    ],
    seeAlso: ['inductor', 'saturatingInductor', 'variableCapacitor'],
  },

  potentiometer: {
    description: [
      'A resistor of total resistance R with a sliding contact (wiper). The position input splits R into two parts: 0 puts the wiper at pin_n, 1 puts it at pin_p.',
    ],
    ports: {
      pin_p: 'End pin at position 1.',
      pin_n: 'End pin at position 0.',
      contact: 'Wiper pin.',
      r: 'Wiper position, from 0 to 1. Values outside that range are clamped.',
    },
    parameters: {
      R: 'Total resistance between pin_p and pin_n, in ohms. 0 or more.',
    },
    equations: [
      'r′ = min(1, max(0, r))',
      'pin_p.v − contact.v = R · (1 − r′) · pin_p.i',
      'pin_n.v − contact.v = R · r′ · pin_n.i',
      'pin_p.i + pin_n.i + contact.i = 0',
    ],
    limitations: [
      'No temperature dependence, contact resistance, or wiper travel limits beyond the clamp.',
    ],
    tips: [
      'At either end of travel one section has zero resistance, which shorts the wiper to that end pin.',
    ],
    seeAlso: ['variableResistor', 'resistor'],
  },

  saturatingInductor: {
    description: [
      'An inductor with a smooth saturation curve. At small currents the inductance is Lzer; as the current grows the inductance falls toward Linf. The curve passes through Lnom at the current Inom.',
    ],
    ports: {
      p: 'Positive pin. Current into p is counted as positive.',
      n: 'Negative pin.',
    },
    parameters: {
      Inom: 'Nominal current, in amperes, at which the inductance equals Lnom.',
      Lnom: 'Inductance at Inom (flux linkage divided by current), in henries. Must lie strictly between Linf and Lzer.',
      Lzer: 'Inductance near zero current, in henries. Must be greater than Lnom.',
      Linf: 'Inductance at very large current, in henries. Must be less than Lnom.',
    },
    equations: [
      'v = p.v − n.v, i = p.i, p.i + n.i = 0',
      'Psi = Linf · i + (Lzer − Linf) · Ipar · atan(i / Ipar)',
      'v = dPsi/dt',
      'Ipar is solved at the start so that Psi(Inom) / Inom = Lnom',
    ],
    limitations: [
      'The simulation stops with an error unless Linf < Lnom < Lzer.',
      'No hysteresis, core losses, or winding resistance. The curve is symmetric in current.',
    ],
    seeAlso: ['inductor', 'variableInductor', 'mutualInductor'],
  },

  // Coupled and two-port elements

  mutualInductor: {
    description: [
      'Two magnetically coupled inductors: a transformer described by its self and mutual inductances. Use it when leakage and magnetizing inductance matter.',
    ],
    ports: {
      p1: 'Primary positive pin. Current into p1 is the primary current i1.',
      n1: 'Primary negative pin.',
      p2: 'Secondary positive pin. Current into p2 is the secondary current i2.',
      n2: 'Secondary negative pin.',
    },
    parameters: {
      L1: 'Primary self-inductance, in henries.',
      L2: 'Secondary self-inductance, in henries.',
      M: 'Mutual inductance, in henries. For a physical coupling keep M ≤ √(L1 · L2); the coupling factor is M / √(L1 · L2).',
    },
    equations: [
      'v1 = p1.v − n1.v, i1 = p1.i, p1.i + n1.i = 0',
      'v2 = p2.v − n2.v, i2 = p2.i, p2.i + n2.i = 0',
      'v1 = L1 · di1/dt + M · di2/dt',
      'v2 = M · di1/dt + L2 · di2/dt',
    ],
    limitations: [
      'Linear: no saturation, core losses, or winding resistance. Add Resistors in series for copper loss.',
      'The values are not checked: M > √(L1 · L2) is accepted but not physical.',
    ],
    tips: [
      'The dotted ends are p1 and p2: with M > 0, a rising current into p1 makes p2 positive with respect to n2.',
      'Each side needs its own path to Ground if the two circuits are otherwise separate.',
    ],
    seeAlso: ['idealTransformer', 'inductor', 'threePhaseTransformer'],
  },

  idealTransformer: {
    description: [
      'An ideal transformer with turns ratio n: voltages scale by n and currents by 1/n, with no losses, leakage, or magnetizing current. It passes DC as well as AC.',
    ],
    ports: {
      p1: 'Primary positive pin. Current into p1 is the primary current i1.',
      n1: 'Primary negative pin.',
      p2: 'Secondary positive pin. Current into p2 is the secondary current i2.',
      n2: 'Secondary negative pin.',
    },
    parameters: {
      n: 'Turns ratio, primary to secondary: v1 / v2. Use a positive value; n = 2 steps the voltage down by half.',
    },
    equations: [
      'v1 = p1.v − n1.v, i1 = p1.i, p1.i + n1.i = 0',
      'v2 = p2.v − n2.v, i2 = p2.i, p2.i + n2.i = 0',
      'v1 = n · v2',
      'i2 = −n · i1',
    ],
    limitations: [
      'No magnetizing inductance: the MSL option for it is turned off and not exposed, so the block also transforms DC.',
      'No leakage inductance, winding resistance, or saturation.',
    ],
    tips: [
      'Each side needs its own path to Ground if the two circuits are otherwise separate.',
    ],
    seeAlso: ['mutualInductor', 'gyrator', 'threePhaseTransformer'],
  },

  gyrator: {
    description: [
      'An ideal gyrator: the current at each port is set by the voltage at the other. It turns a capacitor on one side into an inductance on the other, and conserves power when G1 = G2.',
    ],
    ports: {
      p1: 'Port 1 positive pin. Current into p1 is i1.',
      n1: 'Port 1 negative pin.',
      p2: 'Port 2 positive pin. Current into p2 is i2.',
      n2: 'Port 2 negative pin.',
    },
    parameters: {
      G1: 'Gyration conductance from port 1 voltage to port 2 current, in siemens.',
      G2: 'Gyration conductance from port 2 voltage to port 1 current, in siemens.',
    },
    equations: [
      'v1 = p1.v − n1.v, i1 = p1.i, p1.i + n1.i = 0',
      'v2 = p2.v − n2.v, i2 = p2.i, p2.i + n2.i = 0',
      'i1 = G2 · v2',
      'i2 = −G1 · v1',
    ],
    tips: [
      'A capacitor C on port 2 appears at port 1 as an inductance C / (G1 · G2).',
    ],
    seeAlso: ['idealTransformer', 'vccs'],
  },

  vcvs: {
    description: [
      'A linear voltage-controlled voltage source. Port 1 senses a voltage without drawing current; port 2 is an ideal voltage source of gain times that voltage.',
    ],
    ports: {
      p1: 'Control input, positive pin. Draws no current.',
      n1: 'Control input, negative pin.',
      p2: 'Output, positive pin.',
      n2: 'Output, negative pin.',
    },
    parameters: { gain: 'Voltage gain, dimensionless. Any real number.' },
    equations: [
      'v1 = p1.v − n1.v, v2 = p2.v − n2.v',
      'p1.i = n1.i = 0',
      'p2.i + n2.i = 0',
      'v2 = gain · v1',
    ],
    limitations: [
      'Ideal: infinite input impedance, zero output impedance, unlimited bandwidth and output.',
    ],
    seeAlso: ['vccs', 'ccvs', 'cccs', 'opAmpLimited'],
  },

  vccs: {
    description: [
      'A linear voltage-controlled current source. Port 1 senses a voltage without drawing current; port 2 carries a current proportional to it.',
    ],
    ports: {
      p1: 'Control input, positive pin. Draws no current.',
      n1: 'Control input, negative pin.',
      p2: 'Output, positive pin. The output current flows into p2 and out of n2 through the block.',
      n2: 'Output, negative pin.',
    },
    parameters: {
      transConductance: 'Transconductance, in siemens. Any real number.',
    },
    equations: [
      'v1 = p1.v − n1.v',
      'p1.i = n1.i = 0',
      'p2.i + n2.i = 0',
      'p2.i = transConductance · v1',
    ],
    limitations: [
      'Ideal: infinite input and output impedance, no compliance limit.',
    ],
    tips: [
      'Leave no output node with only current sources attached; the node voltage is then undefined.',
    ],
    seeAlso: ['vcvs', 'ccvs', 'cccs', 'gyrator'],
  },

  ccvs: {
    description: [
      'A linear current-controlled voltage source. Port 1 is a short circuit that senses its current; port 2 is an ideal voltage source proportional to that current.',
    ],
    ports: {
      p1: 'Control input, positive pin. The sensed current i1 flows into p1.',
      n1: 'Control input, negative pin. Held at the same voltage as p1.',
      p2: 'Output, positive pin.',
      n2: 'Output, negative pin.',
    },
    parameters: {
      transResistance: 'Transresistance, in ohms. Any real number.',
    },
    equations: [
      'i1 = p1.i, p1.i + n1.i = 0',
      'p1.v = n1.v',
      'v2 = p2.v − n2.v, p2.i + n2.i = 0',
      'v2 = transResistance · i1',
    ],
    limitations: ['Ideal: zero input and output impedance, unlimited output.'],
    seeAlso: ['cccs', 'vcvs', 'vccs', 'currentSensor'],
  },

  cccs: {
    description: [
      'A linear current-controlled current source. Port 1 is a short circuit that senses its current; port 2 carries gain times that current.',
    ],
    ports: {
      p1: 'Control input, positive pin. The sensed current i1 flows into p1.',
      n1: 'Control input, negative pin. Held at the same voltage as p1.',
      p2: 'Output, positive pin. The output current flows into p2 and out of n2 through the block.',
      n2: 'Output, negative pin.',
    },
    parameters: { gain: 'Current gain, dimensionless. Any real number.' },
    equations: [
      'i1 = p1.i, p1.i + n1.i = 0',
      'p1.v = n1.v',
      'p2.i + n2.i = 0',
      'p2.i = gain · i1',
    ],
    limitations: [
      'Ideal: zero input impedance, infinite output impedance, no compliance limit.',
    ],
    seeAlso: ['ccvs', 'vccs', 'vcvs'],
  },

  opAmp: {
    description: [
      'An ideal operational amplifier (nullor): the two inputs draw no current and are forced to the same voltage, and the output supplies whatever current that takes. Use it with external feedback resistors.',
    ],
    ports: {
      in_p: 'Non-inverting input. Draws no current.',
      in_n: 'Inverting input. Draws no current.',
      out: 'Output pin. Its current is unconstrained; it returns through Ground.',
    },
    equations: ['in_p.v = in_n.v', 'in_p.i = 0', 'in_n.i = 0'],
    limitations: [
      'No gain limit, output swing limit, bandwidth, offset, or current limit.',
      'Only works with negative feedback. Without a feedback path to in_n, or with positive feedback, the circuit has no unique solution.',
    ],
    seeAlso: ['opAmpLimited', 'vcvs'],
  },

  opAmpLimited: {
    description: [
      'An operational amplifier with finite open-loop gain whose output voltage is clipped to the supply rails. Use it where saturation matters, such as comparators or loops that can hit the rails.',
    ],
    ports: {
      in_p: 'Non-inverting input. Draws no current.',
      in_n: 'Inverting input. Draws no current.',
      out: 'Output pin, an ideal voltage source to Ground. Its current is unconstrained.',
    },
    parameters: {
      V0: 'Open-loop voltage gain, dimensionless. 0 or more.',
      Vps: 'Positive supply rail, in volts: the highest output voltage.',
      Vns: 'Negative supply rail, in volts: the lowest output voltage. Set it below Vps.',
    },
    equations: [
      'v_in = in_p.v − in_n.v',
      'in_p.i = 0, in_n.i = 0',
      'out.v = min(Vps, max(Vns, V0 · v_in))',
    ],
    limitations: [
      'The rails are fixed values, not pins; the block draws no supply current in the circuit.',
      'No bandwidth, slew rate, offset, or output current limit. Saturation is a hard clip.',
    ],
    seeAlso: ['opAmp', 'vcvs'],
  },

  // Sources

  dcSource: {
    description: [
      'An ideal constant voltage source. Use it for DC supplies and buses.',
    ],
    ports: {
      p: 'Positive terminal, V volts above n.',
      n: 'Negative terminal.',
    },
    parameters: { V: 'Voltage, in volts. Any real number.' },
    equations: ['p.v − n.v = V', 'p.i + n.i = 0'],
    limitations: [
      'No internal resistance or current limit. For a source that sags under load, add a series Resistor or use Battery.',
    ],
    tips: [
      'Current flowing out of p into the circuit appears as a negative p.i: the source is delivering power.',
    ],
    seeAlso: ['signalVoltage', 'stepVoltage', 'batteryStack', 'dcCurrent'],
  },

  dcCurrent: {
    description: ['An ideal constant current source.'],
    ports: {
      p: 'Positive pin. The source current I flows into p, through the source, and out of n.',
      n: 'Negative pin. The current I leaves the source here into the external circuit.',
    },
    parameters: { I: 'Current, in amperes. Any real number.' },
    equations: ['p.i = I', 'p.i + n.i = 0'],
    limitations: [
      'No voltage limit: the source produces whatever voltage the load requires.',
    ],
    tips: [
      'The direction follows the Modelica convention: a positive I pushes current out of n. Flip the pins, or the sign of I, if it runs the wrong way.',
      'Never leave it open or in series with an ideal switch that can open; its voltage is then undefined.',
    ],
    seeAlso: ['signalCurrent', 'sineCurrent', 'dcSource'],
  },

  sineVoltage: {
    description: [
      'An ideal sinusoidal voltage source with amplitude, frequency, phase, and DC offset. Use it for AC mains and test signals.',
    ],
    ports: {
      p: 'Positive terminal.',
      n: 'Negative terminal.',
    },
    parameters: {
      V: 'Peak amplitude, in volts. The default 325 V is the peak of 230 V RMS.',
      f: 'Frequency, in Hz. 0 or more.',
      phase: 'Phase at time 0, in radians.',
      offset: 'DC offset, in volts.',
    },
    equations: [
      'p.v − n.v = offset + V · sin(2π · f · time + phase)',
      'p.i + n.i = 0',
    ],
    limitations: [
      'No internal impedance. The wave starts at time 0; there is no start time.',
    ],
    tips: ['V is the peak value: for a given RMS voltage, set V = √2 · V_rms.'],
    seeAlso: ['sineCurrent', 'dcSource', 'signalVoltage', 'threePhaseSource'],
  },

  sineCurrent: {
    description: [
      'An ideal sinusoidal current source with amplitude, frequency, phase, and DC offset.',
    ],
    ports: {
      p: 'Positive pin. The source current flows into p, through the source, and out of n.',
      n: 'Negative pin.',
    },
    parameters: {
      I: 'Peak amplitude, in amperes.',
      f: 'Frequency, in Hz. 0 or more.',
      phase: 'Phase at time 0, in radians.',
      offset: 'DC offset, in amperes.',
    },
    equations: [
      'p.i = offset + I · sin(2π · f · time + phase)',
      'p.i + n.i = 0',
    ],
    limitations: [
      'No voltage limit. The wave starts at time 0; there is no start time.',
    ],
    tips: [
      'As with DC current, a positive value pushes current out of n into the circuit.',
    ],
    seeAlso: ['dcCurrent', 'signalCurrent', 'sineVoltage'],
  },

  stepVoltage: {
    description: [
      'An ideal voltage source that holds Offset until the step time, then jumps to Offset + V.',
    ],
    ports: {
      p: 'Positive terminal.',
      n: 'Negative terminal.',
    },
    parameters: {
      V: 'Height of the step, in volts. Negative values step down.',
      offset: 'Voltage before the step, in volts.',
      startTime: 'Time of the step, in seconds. 0 or more.',
    },
    equations: [
      'p.v − n.v = offset for time < startTime',
      'p.v − n.v = offset + V for time ≥ startTime',
      'p.i + n.i = 0',
    ],
    limitations: [
      'The jump is instantaneous. Into a capacitor with no series resistance, it demands an infinite current.',
    ],
    seeAlso: ['rampVoltage', 'pulseVoltage', 'dcSource', 'step'],
  },

  rampVoltage: {
    description: [
      'An ideal voltage source that holds Offset until Start time, rises linearly by V over Duration, then stays at Offset + V.',
    ],
    ports: {
      p: 'Positive terminal.',
      n: 'Negative terminal.',
    },
    parameters: {
      V: 'Total rise, in volts. Negative values ramp down.',
      duration: 'Time taken to rise, in seconds. Must be greater than 0.',
      offset: 'Voltage before the ramp, in volts.',
      startTime: 'Time the ramp starts, in seconds. 0 or more.',
    },
    equations: [
      'p.v − n.v = offset for time < startTime',
      'p.v − n.v = offset + V · (time − startTime) / duration for startTime ≤ time < startTime + duration',
      'p.v − n.v = offset + V afterward',
      'p.i + n.i = 0',
    ],
    tips: [
      'Use it for soft-start supplies that would otherwise charge capacitors with a current spike.',
    ],
    seeAlso: ['stepVoltage', 'signalVoltage', 'ramp'],
  },

  pulseVoltage: {
    description: [
      'An ideal voltage source producing a periodic rectangular wave. Each period starts at Offset + V for Width percent of the period, then drops to Offset.',
    ],
    ports: {
      p: 'Positive terminal.',
      n: 'Negative terminal.',
    },
    parameters: {
      V: 'Pulse height above Offset, in volts.',
      width:
        'High time, in percent of the period. Must be greater than 0 and at most 100.',
      period: 'Period, in seconds. Must be greater than 0.',
      offset: 'Low level, in volts.',
    },
    equations: [
      'p.v − n.v = offset + V while mod(time, period) < period · width / 100',
      'p.v − n.v = offset otherwise',
      'p.i + n.i = 0',
    ],
    limitations: [
      'Edges are instantaneous. The first period starts high at time 0; there is no start delay.',
    ],
    tips: [
      'For a gate signal driven by a duty-cycle input, use PWM generator instead.',
    ],
    seeAlso: ['stepVoltage', 'pwmSignal', 'pulse'],
  },

  signalVoltage: {
    description: [
      'An ideal voltage source whose voltage equals its input signal. Use it to drive a circuit from a controller or any computed signal.',
    ],
    ports: {
      p: 'Positive terminal.',
      n: 'Negative terminal.',
      v: 'Commanded voltage p.v − n.v, in volts.',
    },
    equations: ['p.v − n.v = v', 'p.i + n.i = 0'],
    limitations: [
      'No internal resistance or current limit. The voltage follows the input instantly.',
    ],
    seeAlso: ['voltage', 'signalCurrent', 'dcSource'],
  },

  voltage: {
    description: [
      'An ideal voltage source whose voltage equals its input signal. It behaves the same as Controlled voltage, with the input on the left.',
    ],
    ports: {
      u: 'Commanded voltage p.v − n.v, in volts.',
      p: 'Positive terminal.',
      n: 'Negative terminal.',
    },
    equations: ['p.v − n.v = u', 'p.i + n.i = 0'],
    limitations: [
      'No internal resistance or current limit. The voltage follows the input instantly.',
    ],
    tips: ['Typical use: a controller output driving DC motor.'],
    seeAlso: ['signalVoltage', 'motor', 'dcSource'],
  },

  signalCurrent: {
    description: [
      'An ideal current source whose current equals its input signal.',
    ],
    ports: {
      p: 'Positive pin. The commanded current flows into p, through the source, and out of n.',
      n: 'Negative pin.',
      i: 'Commanded current p.i, in amperes.',
    },
    equations: ['p.i = i', 'p.i + n.i = 0'],
    limitations: [
      'No voltage limit: the source produces whatever voltage the load requires.',
    ],
    tips: ['A positive input pushes current out of n into the circuit.'],
    seeAlso: ['signalVoltage', 'dcCurrent', 'sineCurrent'],
  },

  // Storage

  batteryStack: {
    description: [
      'A battery pack of Ns series by Np parallel identical cells. The open-circuit voltage rises linearly with state of charge (SOC) from OCVmin when empty to OCVmax when full, behind a fixed internal resistance.',
      'The pack starts full (SOC = 1). SOC is the integral of the terminal current divided by the pack capacity.',
    ],
    ports: {
      p: 'Positive terminal. Current into p charges the pack; discharge current is negative.',
      n: 'Negative terminal.',
    },
    parameters: {
      Ns: 'Number of cells in series. Scales voltage and resistance.',
      Np: 'Number of cells in parallel. Scales capacity and divides resistance.',
      Q: 'Capacity of one cell, in ampere-hours.',
      OCVmax: 'Open-circuit voltage of one cell at SOC = 1, in volts.',
      OCVmin:
        'Open-circuit voltage of one cell at SOC = 0, in volts. Must be below OCVmax.',
      Ri: 'Internal resistance of one cell, in ohms.',
    },
    equations: [
      'i = p.i, p.i + n.i = 0',
      'dSOC/dt = i / (Np · Q · 3600), SOC(0) = 1',
      'OCV = Ns · (OCVmin + SOC · (OCVmax − OCVmin))',
      'p.v − n.v = OCV + (Ns · Ri / Np) · i',
    ],
    limitations: [
      'SOC is held between 0 and 1 without stopping the run: an empty pack keeps supplying current at Ns · OCVmin, and charging a full pack has no effect on SOC.',
      'No RC transient, temperature effects, self-discharge, or aging. The initial SOC cannot be changed.',
    ],
    seeAlso: ['supercap', 'dcSource', 'currentSensor', 'powerSensor'],
  },

  supercap: {
    description: [
      'A supercapacitor modeled as an ideal capacitor C behind a series resistance Rs, starting at voltage V0.',
    ],
    ports: {
      p: 'Positive terminal. Current into p charges the capacitor.',
      n: 'Negative terminal.',
    },
    parameters: {
      C: 'Capacitance, in farads.',
      Rs: 'Equivalent series resistance, in ohms.',
      Vnom: 'Nominal voltage, in volts. Only sets the self-discharge path, which is disabled here, so it does not affect the result.',
      V0: 'Initial voltage of the internal capacitance, in volts.',
    },
    equations: [
      'i = p.i, p.i + n.i = 0',
      'C · dvC/dt = i, vC(0) = V0',
      'p.v − n.v = vC + Rs · i',
    ],
    limitations: [
      'Linear capacitance; no self-discharge, voltage dependence, or temperature effects.',
      'The voltage is not limited to Vnom: charging beyond it is allowed.',
    ],
    seeAlso: ['capacitor', 'batteryStack'],
  },

  // Switches and semiconductors

  idealSwitch: {
    description: [
      'An ideal bidirectional switch controlled by a real-valued gate signal. A gate above 0.5 closes it into a short circuit; otherwise it is an open circuit.',
    ],
    ports: {
      p: 'Positive pin. Current into p is counted as positive.',
      n: 'Negative pin.',
      gate: 'Gate signal. Closed while gate > 0.5, open otherwise; 0/1 PWM signals work directly.',
    },
    equations: [
      'p.i + n.i = 0',
      'closed (gate > 0.5): p.v = n.v',
      'open: p.i = 0',
    ],
    limitations: [
      'Zero on-resistance and zero off-conductance (MSL IdealClosingSwitch with Ron = 0 and Goff = 0). No losses, dead time, or switching transients.',
      'Current flows in either direction when closed.',
    ],
    tips: [
      'Opening it in series with an inductor, or closing it across a charged capacitor or a voltage source, has no finite solution. Provide a freewheeling diode or a small resistance.',
    ],
    seeAlso: ['closingSwitch', 'openingSwitch', 'diode', 'pwmPair'],
  },

  diode: {
    description: [
      'A simple diode: a very small resistance when forward biased and an open circuit when reverse biased. There is no forward voltage drop.',
    ],
    ports: {
      p: 'Anode. Forward current flows into p.',
      n: 'Cathode.',
    },
    equations: [
      'v = p.v − n.v, p.i + n.i = 0',
      'p.i = v / 1e−4 for v > 0 (0.1 mΩ on-resistance)',
      'p.i = 0 for v ≤ 0',
    ],
    limitations: [
      'Fixed 0.1 mΩ on-resistance and zero reverse current; no threshold voltage, reverse recovery, junction capacitance, or temperature effects.',
      'The change between states is not handled as an event, so the solver steps across the corner at v = 0 by itself.',
    ],
    tips: [
      'For an adjustable on-resistance and off-conductance use Ideal diode; for a realistic forward drop use Diode (exponential).',
    ],
    seeAlso: ['idealDiode', 'diodeShockley', 'idealSwitch', 'diodeBridge'],
  },

  // Sensors

  voltageSensor: {
    description: [
      'Measures the voltage between two nodes and outputs it as a signal. It draws no current, so it does not load the circuit.',
    ],
    ports: {
      p: 'Positive measuring pin.',
      n: 'Negative measuring pin.',
      y: 'Measured voltage p.v − n.v, in volts.',
    },
    equations: ['y = p.v − n.v', 'p.i = 0', 'n.i = 0'],
    limitations: [
      'Ideal: infinite input impedance, no bandwidth limit or noise.',
    ],
    seeAlso: ['currentSensor', 'powerSensor', 'scope'],
  },

  currentSensor: {
    description: [
      'Measures the current in a branch and outputs it as a signal. Place it in series; it has no voltage drop.',
    ],
    ports: {
      p: 'Pin where the measured current enters.',
      n: 'Pin where the measured current leaves.',
      y: 'Measured current, in amperes. Positive when current flows from p to n through the sensor.',
    },
    equations: ['y = p.i', 'p.v = n.v', 'p.i + n.i = 0'],
    limitations: ['Ideal: zero resistance, no bandwidth limit or noise.'],
    tips: ['If the reading has the wrong sign, swap p and n.'],
    seeAlso: ['voltageSensor', 'powerSensor', 'scope'],
  },

  powerSensor: {
    description: [
      'Measures instantaneous electrical power as the product of a branch current and a voltage. The current path goes in series through pc and nc; the voltage is sensed between pv and nv.',
    ],
    ports: {
      pc: 'Current path in. Current into pc is counted as positive.',
      nc: 'Current path out. Held at the same voltage as pc.',
      pv: 'Positive voltage-sensing pin. Draws no current.',
      nv: 'Negative voltage-sensing pin. Draws no current.',
      power: 'Instantaneous power, in watts.',
    },
    equations: [
      'pc.v = nc.v, pc.i + nc.i = 0',
      'pv.i = nv.i = 0',
      'power = pc.i · (pv.v − nv.v)',
    ],
    limitations: [
      'Instantaneous value only; for average power, filter or integrate the output.',
    ],
    tips: [
      'To measure the power taken by a load, put pc–nc in series with it and connect pv and nv across it.',
    ],
    seeAlso: ['currentSensor', 'voltageSensor', 'rotPowerSensor'],
  },

  // Machines and drives

  motor: {
    description: [
      'A permanent-magnet DC motor: armature resistance and inductance in series with a back-EMF proportional to shaft speed. The same constant k gives torque per ampere.',
    ],
    ports: {
      p: 'Positive armature terminal. Current into p is the armature current i.',
      n: 'Negative armature terminal.',
      flange:
        'Rotor shaft. The motor applies torque k · i to what is connected; w is its speed.',
    },
    parameters: {
      R: 'Armature resistance, in ohms.',
      L: 'Armature inductance, in henries.',
      k: 'Motor constant: torque per ampere in N·m/A, equal to back-EMF per rad/s in V·s/rad.',
    },
    equations: [
      'v = p.v − n.v, i = p.i, p.i + n.i = 0',
      'w = d(flange.phi)/dt',
      'L · di/dt = v − R · i − k · w, i(0) = 0',
      'torque on the load = k · i (flange.tau = −k · i)',
    ],
    limitations: [
      'No rotor inertia, friction, brush drop, or saturation. Connect an inertia to the shaft; without one the shaft has no mass.',
      'The armature starts with zero current.',
    ],
    seeAlso: ['dcPmMachine', 'inertia', 'shaftLoad', 'voltage'],
  },

  inverter: {
    description: [
      'An averaged three-phase inverter for control studies. It takes three phase-voltage commands, adds min–max common-mode injection, and clips each phase to the DC bus. The outputs are the phase voltages averaged over a switching period, as signals.',
      'Min–max injection extends the linear range: balanced sinusoidal commands pass without clipping up to an amplitude of Vdc / √3.',
    ],
    ports: {
      ua: 'Phase a voltage command, in volts.',
      ub: 'Phase b voltage command, in volts.',
      uc: 'Phase c voltage command, in volts.',
      va: 'Phase a output voltage, in volts, relative to the DC-bus midpoint.',
      vb: 'Phase b output voltage, in volts, relative to the DC-bus midpoint.',
      vc: 'Phase c output voltage, in volts, relative to the DC-bus midpoint.',
    },
    parameters: {
      Vdc: 'DC bus voltage, in volts. At least 1 V. Each output is limited to ±Vdc/2.',
    },
    equations: [
      'offset = (max(ua, ub, uc) + min(ua, ub, uc)) / 2',
      'va = max(−Vdc/2, min(Vdc/2, ua − offset))',
      'vb = max(−Vdc/2, min(Vdc/2, ub − offset))',
      'vc = max(−Vdc/2, min(Vdc/2, uc − offset))',
    ],
    limitations: [
      'Signal-level model: no switching ripple, dead time, or device losses, and it draws no current from a DC source.',
      'The DC bus is an ideal constant; it does not sag with load.',
    ],
    tips: [
      'The injected common-mode offset does not affect a machine’s d/q currents, since the Park transform removes it.',
    ],
    seeAlso: ['pmsm', 'inversePark', 'threePhaseInverter', 'pwmSignal'],
  },

  pmsm: {
    description: [
      'A three-phase permanent-magnet synchronous motor modeled in the rotor d/q frame. Phase voltages come in as signals, are transformed to d/q using the rotor’s electrical angle, and drive the d/q current equations. Torque acts on the mechanical shaft.',
      'It also outputs the phase currents, electrical angle, speed, and torque as ideal measurements, ready for field-oriented control.',
    ],
    ports: {
      va: 'Phase a voltage, in volts.',
      vb: 'Phase b voltage, in volts.',
      vc: 'Phase c voltage, in volts.',
      flange: 'Rotor shaft. The motor applies torque Te to what is connected.',
      ia: 'Phase a current, in amperes.',
      ib: 'Phase b current, in amperes.',
      ic: 'Phase c current, in amperes.',
      theta:
        'Electrical rotor angle, in radians: polePairs times the shaft angle. It is not wrapped to one turn.',
      wm: 'Mechanical shaft speed, in rad/s.',
      rpm: 'Mechanical shaft speed, in revolutions per minute.',
      torque: 'Electromagnetic torque Te, in N·m.',
    },
    parameters: {
      R: 'Stator phase resistance, in ohms.',
      Ld: 'd-axis inductance, in henries.',
      Lq: 'q-axis inductance, in henries. Ld = Lq gives a surface-mount machine with no reluctance torque.',
      psi: 'Permanent-magnet flux linkage, in webers.',
      polePairs: 'Number of pole pairs.',
    },
    equations: [
      'theta = polePairs · flange.phi, wm = d(flange.phi)/dt, we = polePairs · wm',
      'vd = (2/3) · Σ vk · cos(theta − θk), vq = −(2/3) · Σ vk · sin(theta − θk), θk = 0, 2π/3, −2π/3 for a, b, c',
      'Ld · did/dt = vd − R · id + we · Lq · iq',
      'Lq · diq/dt = vq − R · iq − we · (Ld · id + psi)',
      'torque = 1.5 · polePairs · (psi · iq + (Ld − Lq) · id · iq), flange.tau = −torque',
      'ia = id · cos(theta) − iq · sin(theta), and likewise for b and c',
      'rpm = wm · 60 / (2π)',
    ],
    limitations: [
      'The phase voltages are signals, not pins: the motor draws no power from an electrical circuit. Drive it from Three-phase inverter or voltage commands.',
      'Sinusoidal back-EMF, constant inductances; no saturation, iron losses, cogging, or zero-sequence current.',
      'No rotor inertia or friction; connect an inertia to the shaft. The d/q currents start at 0.',
    ],
    seeAlso: [
      'inverter',
      'park',
      'clarke',
      'inversePark',
      'currentPI',
      'pmSyncMachine',
      'inertia',
    ],
  },
};
