import type { BlockDoc } from './types';

// Machines, magnetic flux tubes, and heat transfer. Every block here wraps a class from the
// Modelica Standard Library 4.1.0; the relations below are those of the wrapped class with
// the values Gradara passes to it.

export const docs: Record<string, BlockDoc> = {
  // ─── Machines ───────────────────────────────────────────────────────────────

  dcPmMachine: {
    description: [
      'A DC machine whose field comes from permanent magnets. The armature is a resistance and inductance in series with an induced voltage proportional to speed; the torque is proportional to armature current. It runs as a motor or a generator, depending on the direction of power flow.',
      'The machine constant is not entered directly. It is derived from the nominal operating point: the induced voltage at nominal current and speed is VaNominal − Ra · IaNominal.',
    ],
    ports: {
      pin_ap:
        'Positive armature terminal. Current into pin_ap is the armature current ia; positive ia with positive speed is motoring.',
      pin_an: 'Negative armature terminal.',
      flange:
        'Shaft, rotational. The rotor inertia Jr sits on this flange. The stator is fixed to ground internally.',
    },
    parameters: {
      VaNominal:
        'Armature voltage at the nominal operating point, in volts. Must exceed Ra · IaNominal.',
      IaNominal: 'Armature current at the nominal operating point, in amperes.',
      wNominal:
        'Speed at the nominal operating point, in rad/s. The default 149.2 rad/s is 1425 rpm.',
      Ra: 'Armature resistance, in ohms.',
      La: 'Armature inductance, in henries. Sets the electrical time constant La/Ra.',
      Jr: 'Rotor moment of inertia, in kg·m².',
    },
    equations: [
      'kΦ = (VaNominal − Ra · IaNominal) / wNominal',
      'pin_ap.v − pin_an.v = Ra · ia + La · dia/dt + kΦ · ω',
      'τe = kΦ · ia',
      'Jr · dω/dt = τe + flange.τ',
    ],
    limitations: [
      'Constant magnet flux: no armature reaction, saturation, or demagnetization.',
      'No friction, core, stray-load, or brush losses (the library loss records are left at zero).',
      'Temperatures are fixed at 20 °C, so Ra does not change with heating.',
    ],
    tips: [
      'To match a datasheet, enter the rated voltage, current, and speed; the torque constant follows. With the defaults kΦ ≈ 0.637 V·s/rad (N·m/A).',
      'Drive it from an H-bridge or a DC source; connect a load with Inertia or Shaft load.',
    ],
    seeAlso: [
      'dcShuntMachine',
      'dcSeriesMachine',
      'motor',
      'hBridge',
      'shaftLoad',
      'rotSpeedSensor',
    ],
  },

  dcShuntMachine: {
    description: [
      'A DC machine with a wound field on its own pair of terminals. Supply the field separately for a separately excited machine, or connect it in parallel with the armature for shunt operation.',
      'The flux is linear in the field current. The machine constant at nominal field current is derived from the nominal operating point, as for the permanent-magnet machine, and scales with ie / IeNominal.',
    ],
    ports: {
      pin_ap:
        'Positive armature terminal. Current into pin_ap is the armature current ia.',
      pin_an: 'Negative armature terminal.',
      pin_ep:
        'Positive field terminal. Current into pin_ep is the field current ie.',
      pin_en: 'Negative field terminal.',
      flange:
        'Shaft, rotational, carrying the rotor inertia Jr. The stator is fixed to ground internally.',
    },
    parameters: {
      VaNominal:
        'Armature voltage at the nominal operating point, in volts. Must exceed Ra · IaNominal.',
      IaNominal: 'Armature current at the nominal operating point, in amperes.',
      wNominal:
        'Speed at the nominal operating point, in rad/s (default 1425 rpm).',
      IeNominal: 'Field current at the nominal operating point, in amperes.',
      Ra: 'Armature resistance, in ohms.',
      La: 'Armature inductance, in henries.',
      Jr: 'Rotor moment of inertia, in kg·m².',
    },
    equations: [
      'kΦN = (VaNominal − Ra · IaNominal) / wNominal',
      'pin_ep.v − pin_en.v = Re · ie + Le · die/dt, with Re = 100 Ω and Le = 1 H',
      'pin_ap.v − pin_an.v = Ra · ia + La · dia/dt + kΦN · (ie / IeNominal) · ω',
      'τe = kΦN · (ie / IeNominal) · ia',
      'Jr · dω/dt = τe + flange.τ',
    ],
    limitations: [
      'The field resistance (100 Ω) and inductance (1 H) are fixed and not exposed, so IeNominal is reached at 100 V · IeNominal across the field.',
      'Linear magnetics: no saturation or armature reaction.',
      'No friction, core, stray-load, or brush losses. Temperatures are fixed at 20 °C.',
    ],
    tips: [
      'With no field current the machine produces no torque and no back EMF. Energize the field before, or together with, the armature.',
      'For shunt operation with the defaults, a 100 V supply gives the nominal 1 A field current.',
    ],
    seeAlso: ['dcPmMachine', 'dcSeriesMachine', 'dcSource', 'shaftLoad'],
  },

  dcSeriesMachine: {
    description: [
      'A series-excited DC machine, as used for traction. The field winding has its own terminals; connect it in series with the armature so the same current flows through both. The torque then grows with the square of the current.',
      'The machine constant is derived from the nominal operating point, with the field carrying IaNominal at that point.',
    ],
    ports: {
      pin_ap:
        'Positive armature terminal. Current into pin_ap is the armature current ia.',
      pin_an: 'Negative armature terminal.',
      pin_ep:
        'Positive field terminal. Current into pin_ep is the field current ie.',
      pin_en: 'Negative field terminal.',
      flange:
        'Shaft, rotational, carrying the rotor inertia Jr. The stator is fixed to ground internally.',
    },
    parameters: {
      VaNominal:
        'Terminal voltage at the nominal operating point, in volts. Must exceed (Ra + 0.01 Ω) · IaNominal.',
      IaNominal:
        'Current at the nominal operating point, in amperes; also the nominal field current.',
      wNominal:
        'Speed at the nominal operating point, in rad/s (default 1425 rpm).',
      Ra: 'Armature resistance, in ohms.',
      La: 'Armature inductance, in henries.',
      Jr: 'Rotor moment of inertia, in kg·m².',
    },
    equations: [
      'kΦN = (VaNominal − (Ra + Re) · IaNominal) / wNominal, with Re = 0.01 Ω',
      'pin_ep.v − pin_en.v = Re · ie + Le · die/dt, with Le = 0.5 mH',
      'pin_ap.v − pin_an.v = Ra · ia + La · dia/dt + kΦN · (ie / IaNominal) · ω',
      'τe = kΦN · (ie / IaNominal) · ia, so τe = kΦN · ia² / IaNominal when ie = ia',
      'Jr · dω/dt = τe + flange.τ',
    ],
    limitations: [
      'The field resistance (0.01 Ω) and inductance (0.5 mH) are fixed and not exposed.',
      'Linear magnetics: the flux keeps rising with current, with no saturation.',
      'No friction, core, stray-load, or brush losses. Temperatures are fixed at 20 °C.',
    ],
    tips: [
      'The field is not connected internally. For series operation, wire pin_an to pin_ep and supply the machine between pin_ap and pin_en.',
      'Unloaded, a series machine speeds up without bound. Always attach a load.',
    ],
    seeAlso: ['dcPmMachine', 'dcShuntMachine', 'shaftLoad', 'rotSpeedSensor'],
  },

  inductionMachine: {
    description: [
      'A three-phase squirrel-cage induction machine, modeled with space phasors: stator resistance and leakage, a main-field inductance, and a rotor cage referred to the stator. It develops torque from slip, the difference between the field speed 2π · f / p and the rotor speed.',
      'Only resistances and inertia are exposed. The inductances are fixed as reactances at fsNominal, so changing fsNominal rescales them.',
    ],
    ports: {
      plug_sp:
        'Stator phase terminals a, b, c. Current into plug_sp is counted as positive.',
      plug_sn:
        'Stator winding ends. Connect them to a Star point for a star connection, or through Delta.',
      flange:
        'Shaft, rotational, carrying the rotor inertia Jr. The stator is fixed to ground internally.',
    },
    parameters: {
      p: 'Number of pole pairs, an integer ≥ 1. Synchronous speed is 2π · fsNominal / p.',
      fsNominal:
        'Nominal supply frequency, in hertz. Sets the inductances from fixed reactances.',
      Rs: 'Stator resistance per phase, in ohms.',
      Rr: 'Rotor resistance per phase, referred to the stator, in ohms. Sets the slip at a given torque.',
      Jr: 'Rotor moment of inertia, in kg·m².',
    },
    equations: [
      'vs = Rs · is + Lsσ · dis/dt + dψm/dt (stator space phasors)',
      '0 = Rr · ir + Lrσ · dir/dt + dψm/dt (rotor, in rotor coordinates)',
      'ψm = Lm · (is + ir)',
      'τe = (3/2) · p · (ψm,α · is,β − ψm,β · is,α)',
      'Lm = 2.898 Ω / (2π · fsNominal), Lsσ = Lrσ = 0.102 Ω / (2π · fsNominal)',
    ],
    limitations: [
      'Linear magnetics: no saturation of the main or leakage paths.',
      'No iron, friction, or stray-load losses. Temperatures are fixed at 20 °C.',
      'Single cage: no deep-bar or double-cage effects.',
    ],
    tips: [
      'The fixed reactances correspond to the library’s 100 V, 100 A per-phase reference machine. Supply about 100 V RMS per phase at fsNominal for sensible currents.',
      'Started direct on line from a Three-phase source, the machine draws a large inrush current before it reaches its slip speed.',
    ],
    seeAlso: [
      'pmSyncMachine',
      'reluctanceMachine',
      'threePhaseSource',
      'star',
      'threePhaseInverter',
      'threePhasePowerSensor',
    ],
  },

  pmSyncMachine: {
    description: [
      'A three-phase permanent-magnet synchronous machine with a damper cage on the rotor, from the Modelica library. The magnets give a fixed rotor flux; torque comes from the stator current in quadrature with it.',
      'The back EMF is fixed at 112.3 V RMS per phase at fsNominal. Inductances are fixed as reactances at fsNominal, so changing fsNominal rescales them and the magnet flux.',
    ],
    ports: {
      plug_sp:
        'Stator phase terminals a, b, c. Current into plug_sp is counted as positive.',
      plug_sn:
        'Stator winding ends. Connect them to a Star point for a star connection.',
      flange:
        'Shaft, rotational, carrying the rotor inertia Jr. The stator is fixed to ground internally.',
    },
    parameters: {
      p: 'Number of pole pairs, an integer ≥ 1. Synchronous speed is 2π · f / p.',
      fsNominal:
        'Nominal frequency, in hertz. The open-circuit voltage 112.3 V RMS is reached at this frequency.',
      Rs: 'Stator resistance per phase, in ohms.',
      Jr: 'Rotor moment of inertia, in kg·m².',
    },
    equations: [
      'ψPM = √2 · 112.3 V / (2π · fsNominal) (peak, rotor d axis)',
      'vs = Rs · is + Lsσ · dis/dt + dψm/dt (stator space phasors)',
      'ψm,d = Lmd · (is,d + ir,d) + ψPM, ψm,q = Lmq · (is,q + ir,q)',
      'τe = (3/2) · p · (ψm,α · is,β − ψm,β · is,α) = (3/2) · p · ψPM · is,q in steady state',
      'Lmd = Lmq = 0.3 Ω / (2π · fsNominal), Lsσ = 0.1 Ω / (2π · fsNominal)',
    ],
    limitations: [
      'Surface-magnet rotor (Lmd = Lmq), so there is no reluctance torque.',
      'Linear magnetics: no saturation, no demagnetization, no cogging.',
      'No iron, magnet, friction, or stray-load losses. Temperatures are fixed at 20 °C.',
      'The damper cage (0.04 Ω per axis) is always present. It damps transients but is not found in most inverter-fed PM machines.',
    ],
    tips: [
      'Drive it from an inverter with field-oriented control, taking the rotor angle from Electrical angle sensor or Resolver.',
      'For a simpler PMSM with directly entered dq parameters, see PMSM.',
    ],
    seeAlso: [
      'pmsm',
      'threePhaseInverter',
      'hallSensor',
      'resolver',
      'park',
      'inductionMachine',
    ],
  },

  reluctanceMachine: {
    description: [
      'A three-phase synchronous reluctance machine with a damper cage. The rotor has no magnets or windings; torque comes from the difference between its d-axis and q-axis inductances.',
      'Inductances are fixed as reactances at fsNominal (d axis 2.9 Ω, q axis 0.9 Ω), so changing fsNominal rescales them.',
    ],
    ports: {
      plug_sp:
        'Stator phase terminals a, b, c. Current into plug_sp is counted as positive.',
      plug_sn:
        'Stator winding ends. Connect them to a Star point for a star connection.',
      flange:
        'Shaft, rotational, carrying the rotor inertia Jr. The stator is fixed to ground internally.',
    },
    parameters: {
      p: 'Number of pole pairs, an integer ≥ 1. Synchronous speed is 2π · f / p.',
      fsNominal:
        'Nominal frequency, in hertz. Sets the inductances from fixed reactances.',
      Rs: 'Stator resistance per phase, in ohms.',
      Jr: 'Rotor moment of inertia, in kg·m².',
    },
    equations: [
      'vs = Rs · is + Lsσ · dis/dt + dψm/dt (stator space phasors)',
      'ψm,d = Lmd · (is,d + ir,d), ψm,q = Lmq · (is,q + ir,q)',
      'τe = (3/2) · p · (Lmd − Lmq) · is,d · is,q in steady state',
      'Lmd = 2.9 Ω / (2π · fsNominal), Lmq = 0.9 Ω / (2π · fsNominal), Lsσ = 0.1 Ω / (2π · fsNominal)',
    ],
    limitations: [
      'Linear magnetics: no saturation or cross-coupling between axes.',
      'No iron, friction, or stray-load losses. Temperatures are fixed at 20 °C.',
      'The damper cage (0.04 Ω per axis) is always present; it lets the machine start on line and pull into step.',
    ],
    seeAlso: ['pmSyncMachine', 'inductionMachine', 'threePhaseSource', 'star'],
  },

  hallSensor: {
    description: [
      'Outputs the electrical rotor angle of a machine with p pole pairs, wrapped to 0…2π, as a Hall or encoder commutation sensor reports it. It exerts no torque on the shaft.',
    ],
    ports: {
      flange: 'Shaft to measure, rotational. Draws no torque.',
      y: 'Electrical angle θe, in radians, in the range 0 to 2π.',
    },
    parameters: {
      p: 'Number of pole pairs, an integer ≥ 1. Match the machine.',
    },
    equations: [
      'y = mod(p · (flange.φ + π/p), 2π) = mod(p · flange.φ + π, 2π)',
    ],
    limitations: [
      'The mounting offset is fixed at −π/p, so y = π when the shaft angle is zero. Account for this in commutation or Park transforms.',
      'Continuous output: no quantization to Hall sectors or encoder counts.',
    ],
    seeAlso: ['resolver', 'angleSensor', 'park', 'pmSyncMachine'],
  },

  resolver: {
    description: [
      'A sine–cosine resolver on a shaft: it outputs the sine and cosine of the electrical angle p·φ, and their negatives, as ideal unit-amplitude signals. It exerts no torque on the shaft.',
    ],
    ports: {
      flange: 'Shaft to measure, rotational. Draws no torque.',
      sin: 'sin θ.',
      cos: 'cos θ.',
      nsin: '−sin θ.',
      ncos: '−cos θ.',
    },
    parameters: {
      p: 'Number of pole pairs, an integer ≥ 1. Use 1 for a single-speed resolver.',
    },
    equations: [
      'θ = p · flange.φ',
      'sin = sin θ, cos = cos θ',
      'nsin = −sin θ, ncos = −cos θ',
    ],
    limitations: [
      'No carrier excitation or demodulation: the outputs are the ideal envelopes.',
      'θ is measured from the shaft’s angle at zero; there is no mounting-offset parameter.',
    ],
    tips: [
      'Recover the angle from sin and cos with a two-argument arctangent.',
    ],
    seeAlso: ['hallSensor', 'angleSensor', 'park'],
  },

  // ─── Magnetic ───────────────────────────────────────────────────────────────

  reluctance: {
    description: [
      'A constant magnetic reluctance: the magnetic potential difference across it is proportional to the flux through it. Use it for an air gap or a linear core section in a lumped magnetic circuit.',
    ],
    ports: {
      port_p:
        'Positive magnetic port. Flux entering port_p is counted as positive Φ.',
      port_n: 'Negative magnetic port.',
    },
    parameters: { R_m: 'Reluctance, in A/Wb (1/H). Use a positive value.' },
    equations: [
      'V_m = port_p.V_m − port_n.V_m',
      'V_m = R_m · Φ, with Φ = port_p.Φ',
    ],
    limitations: ['Linear: no saturation, hysteresis, or eddy currents.'],
    tips: ['An air gap of length l and area A has R_m = l / (μ0 · A).'],
    seeAlso: ['permeance', 'variableReluctance', 'winding', 'magneticGround'],
  },

  permeance: {
    description: [
      'A constant magnetic permeance, the reciprocal of reluctance: the flux through it is proportional to the magnetic potential difference across it.',
    ],
    ports: {
      port_p:
        'Positive magnetic port. Flux entering port_p is counted as positive Φ.',
      port_n: 'Negative magnetic port.',
    },
    parameters: { G_m: 'Permeance, in Wb/A (H). Use a positive value.' },
    equations: [
      'V_m = port_p.V_m − port_n.V_m',
      'Φ = G_m · V_m, with Φ = port_p.Φ',
    ],
    limitations: ['Linear: no saturation, hysteresis, or eddy currents.'],
    tips: ['A winding of N turns on a permeance G_m has inductance N² · G_m.'],
    seeAlso: ['reluctance', 'variableReluctance', 'winding'],
  },

  variableReluctance: {
    description: [
      'A reluctance set at each instant by an input signal, for example a gap that opens and closes. The reluctance does not need to be constant or positive, but a zero or negative value is not physical.',
    ],
    ports: {
      R_m: 'Reluctance, in A/Wb.',
      port_p:
        'Positive magnetic port. Flux entering port_p is counted as positive Φ.',
      port_n: 'Negative magnetic port.',
    },
    equations: [
      'V_m = port_p.V_m − port_n.V_m',
      'V_m = R_m · Φ, with Φ = port_p.Φ',
    ],
    limitations: [
      'No force on a moving part: changing the reluctance does not produce a mechanical reaction.',
    ],
    seeAlso: ['reluctance', 'permeance'],
  },

  winding: {
    description: [
      'Couples an electrical winding of N turns to a magnetic circuit. The current drives a magnetomotive force N · i into the magnetic side, and the rate of change of flux induces the voltage on the electrical side. The coupling is lossless.',
    ],
    ports: {
      p: 'Positive electrical pin. Current into p is the winding current i.',
      n: 'Negative electrical pin.',
      port_p:
        'Positive magnetic port. Positive i raises port_p above port_n, driving flux out of port_p through the external circuit.',
      port_n: 'Negative magnetic port.',
    },
    parameters: { N: 'Number of turns, ≥ 1.' },
    equations: [
      'v = p.v − n.v, V_m = port_p.V_m − port_n.V_m',
      'V_m = N · i',
      'N · dΦ/dt = −v, with Φ = port_p.Φ (flux entering port_p)',
    ],
    limitations: [
      'No winding resistance or leakage inductance. Add a Resistor in series for copper loss.',
    ],
    tips: [
      'With a reluctance R_m between port_p and port_n, the winding looks like an inductor of N² / R_m from the electrical side.',
      'Every magnetic circuit needs a Magnetic ground.',
    ],
    seeAlso: [
      'reluctance',
      'magneticGround',
      'fluxSensor',
      'resistor',
      'inductor',
    ],
  },

  magneticGround: {
    description: [
      'The zero of magnetic potential. Every magnetic circuit needs exactly one, as every electrical circuit needs a Ground.',
    ],
    ports: {
      port: 'Magnetic port, held at V_m = 0. Any flux can flow in or out.',
    },
    equations: ['port.V_m = 0'],
    seeAlso: ['winding', 'reluctance', 'ground'],
  },

  mmfSource: {
    description: [
      'A constant magnetomotive force between its ports, whatever flux passes through. Use it for an idealized coil with fixed ampere-turns or, with a series reluctance, a simple permanent-magnet model.',
    ],
    ports: {
      port_p: 'Positive magnetic port, held V_m above port_n.',
      port_n: 'Negative magnetic port.',
    },
    parameters: {
      V_m: 'Magnetomotive force, in amperes (ampere-turns). Any real value.',
    },
    equations: ['port_p.V_m − port_n.V_m = V_m', 'port_p.Φ + port_n.Φ = 0'],
    limitations: [
      'An ideal source: no internal reluctance. Connect a reluctance in series to model a magnet’s own reluctance.',
    ],
    seeAlso: ['signalMmfSource', 'fluxSource', 'reluctance', 'winding'],
  },

  signalMmfSource: {
    description: [
      'A magnetomotive force between its ports set by an input signal. Use it to drive a magnetic circuit without modeling the electrical side of a winding.',
    ],
    ports: {
      V_m: 'Magnetomotive force, in amperes (ampere-turns).',
      port_p: 'Positive magnetic port, held V_m above port_n.',
      port_n: 'Negative magnetic port.',
    },
    equations: ['port_p.V_m − port_n.V_m = V_m', 'port_p.Φ + port_n.Φ = 0'],
    limitations: ['An ideal source: no internal reluctance.'],
    seeAlso: ['mmfSource', 'winding', 'fluxSource'],
  },

  fluxSource: {
    description: [
      'Forces a constant magnetic flux through itself, whatever the magnetic potential difference across it.',
    ],
    ports: {
      port_p: 'Positive magnetic port. The flux Phi enters here.',
      port_n: 'Negative magnetic port. The flux Phi leaves here.',
    },
    parameters: { Phi: 'Magnetic flux, in webers. Any real value.' },
    equations: ['port_p.Φ = Phi', 'port_p.Φ + port_n.Φ = 0'],
    limitations: [
      'An ideal source. Do not connect it in series with a winding or another flux source.',
    ],
    seeAlso: ['mmfSource', 'fluxSensor'],
  },

  fluxSensor: {
    description: [
      'Measures the magnetic flux through it. Insert it in series in the flux path; it has no magnetic potential drop.',
    ],
    ports: {
      Phi: 'Flux from port_p to port_n through the sensor, in webers.',
      port_p: 'Positive magnetic port.',
      port_n: 'Negative magnetic port.',
    },
    equations: ['Phi = port_p.Φ', 'port_p.V_m = port_n.V_m'],
    seeAlso: ['mmfSensor', 'winding'],
  },

  mmfSensor: {
    description: [
      'Measures the magnetic potential difference between two points. Connect it in parallel; no flux passes through it.',
    ],
    ports: {
      V_m: 'Magnetic potential difference port_p.V_m − port_n.V_m, in amperes.',
      port_p: 'Positive magnetic port.',
      port_n: 'Negative magnetic port.',
    },
    equations: ['V_m = port_p.V_m − port_n.V_m', 'port_p.Φ = 0'],
    seeAlso: ['fluxSensor', 'reluctance'],
  },

  // ─── Thermal ────────────────────────────────────────────────────────────────

  heatCapacitor: {
    description: [
      'A lumped mass at one uniform temperature that stores heat. Its temperature rises with the net heat flowing into its port.',
    ],
    ports: {
      port: 'Heat port at the body temperature T, in kelvin. Heat flow into the port is positive and heats the body.',
    },
    parameters: {
      C: 'Heat capacity, in J/K: specific heat times mass (cp · m). Use a positive value.',
    },
    equations: ['C · dT/dt = port.Q_flow, with T = port.T'],
    limitations: [
      'One lumped temperature: no gradients inside the body.',
      'The initial temperature is the library default of 293.15 K (20 °C) and is not a parameter.',
    ],
    tips: [
      'Connect it to Fixed temperature through a Thermal conductor for a first-order heat-up with time constant C / G.',
    ],
    seeAlso: [
      'thermalConductor',
      'fixedHeatFlow',
      'temperatureSensor',
      'heatingResistor',
    ],
  },

  thermalConductor: {
    description: [
      'Linear heat conduction between two ports with no heat storage: the heat flow is proportional to the temperature difference.',
    ],
    ports: {
      port_a: 'Heat port a. Heat flow Q from a to b enters here.',
      port_b: 'Heat port b. Q leaves here.',
    },
    parameters: {
      G: 'Thermal conductance, in W/K. For a slab, G = k · A / L.',
    },
    equations: [
      'ΔT = port_a.T − port_b.T',
      'Q = G · ΔT',
      'port_a.Q_flow = Q, port_b.Q_flow = −Q',
    ],
    limitations: [
      'Constant conductance, independent of temperature. No heat storage.',
    ],
    seeAlso: ['thermalResistor', 'convection', 'heatCapacitor'],
  },

  thermalResistor: {
    description: [
      'Linear thermal resistance between two ports with no heat storage: the temperature difference is proportional to the heat flow. Equivalent to Thermal conductor with G = 1 / R.',
    ],
    ports: {
      port_a: 'Heat port a. Heat flow Q from a to b enters here.',
      port_b: 'Heat port b. Q leaves here.',
    },
    parameters: { R: 'Thermal resistance, in K/W. Use a positive value.' },
    equations: [
      'ΔT = port_a.T − port_b.T',
      'ΔT = R · Q',
      'port_a.Q_flow = Q, port_b.Q_flow = −Q',
    ],
    limitations: [
      'Constant resistance, independent of temperature. No heat storage.',
    ],
    tips: [
      'Datasheet junction-to-case and case-to-ambient values in K/W can be entered directly and chained in series.',
    ],
    seeAlso: ['thermalConductor', 'heatCapacitor', 'fixedTemperature'],
  },

  convection: {
    description: [
      'Convective heat transfer between a solid surface and a fluid, with the conductance given by an input signal. Use it when the heat transfer coefficient depends on flow speed or another computed quantity.',
    ],
    ports: {
      solid:
        'Heat port at the solid surface. Heat flow Q from solid to fluid enters here.',
      fluid: 'Heat port at the fluid. Q leaves here.',
      Gc: 'Convective conductance h · A, in W/K.',
    },
    equations: [
      'ΔT = solid.T − fluid.T',
      'Q = Gc · ΔT',
      'solid.Q_flow = Q, fluid.Q_flow = −Q',
    ],
    limitations: [
      'No heat storage in the boundary layer. The fluid is a single temperature.',
    ],
    tips: ['For a constant coefficient, feed Gc from a Constant block.'],
    seeAlso: ['thermalConductor', 'radiation', 'constant', 'fixedTemperature'],
  },

  radiation: {
    description: [
      'Radiative heat exchange between two surfaces, following the Stefan–Boltzmann law. The heat flow grows with the difference of the fourth powers of the absolute temperatures.',
    ],
    ports: {
      port_a: 'Heat port of surface a. Heat flow Q from a to b enters here.',
      port_b: 'Heat port of surface b. Q leaves here.',
    },
    parameters: {
      Gr: 'Net radiation conductance, in m²: an area weighted by emissivities and view factor. For a small body in large surroundings, Gr = ε · A.',
    },
    equations: [
      'Q = Gr · σ · (port_a.T⁴ − port_b.T⁴), σ = 5.67 × 10⁻⁸ W/(m²·K⁴)',
      'port_a.Q_flow = Q, port_b.Q_flow = −Q',
    ],
    limitations: ['Gray, diffuse surfaces with a fixed Gr. No heat storage.'],
    tips: [
      'Temperatures are absolute; the ports must be in kelvin, as all thermal ports are.',
    ],
    seeAlso: ['convection', 'thermalConductor', 'fixedTemperature'],
  },

  fixedTemperature: {
    description: [
      'Holds its port at a constant temperature, supplying or absorbing whatever heat flow that takes. Use it for ambient air, a coolant, or a heat sink held at a known temperature.',
    ],
    ports: { port: 'Heat port held at T.' },
    parameters: {
      T: 'Temperature, in kelvin (293.15 K is 20 °C). Must be ≥ 0.',
    },
    equations: ['port.T = T'],
    seeAlso: ['prescribedTemperature', 'fixedHeatFlow', 'thermalConductor'],
  },

  prescribedTemperature: {
    description: [
      'Holds its port at the temperature given by an input signal, supplying or absorbing whatever heat flow that takes.',
    ],
    ports: {
      T: 'Temperature to impose, in kelvin.',
      port: 'Heat port held at the input temperature.',
    },
    equations: ['port.T = T'],
    tips: ['The input is in kelvin. Add 273.15 to a Celsius signal.'],
    seeAlso: ['fixedTemperature', 'prescribedHeatFlow', 'temperatureSensor'],
  },

  fixedHeatFlow: {
    description: [
      'Injects a constant heat flow into whatever its port is connected to, whatever the port temperature. Use it for a steady power dissipation such as a component’s losses.',
    ],
    ports: {
      port: 'Heat port. The block delivers Q_flow out of this port into the connected network.',
    },
    parameters: {
      Q_flow:
        'Heat flow, in watts. Positive heats the connected network; negative cools it.',
    },
    equations: ['port.Q_flow = −Q_flow'],
    limitations: [
      'A network fed only by heat-flow sources, with no heat capacity or fixed temperature, has no defined temperature.',
    ],
    seeAlso: ['prescribedHeatFlow', 'heatCapacitor', 'fixedTemperature'],
  },

  prescribedHeatFlow: {
    description: [
      'Injects the heat flow given by an input signal into whatever its port is connected to. Use it to feed computed losses, for example electrical power dissipation, into a thermal model.',
    ],
    ports: {
      Q_flow:
        'Heat flow to inject, in watts. Positive heats the connected network.',
      port: 'Heat port. The block delivers Q_flow out of this port.',
    },
    equations: ['port.Q_flow = −Q_flow'],
    tips: [
      'Pair it with Power sensor to turn a component’s electrical loss into heat.',
    ],
    seeAlso: [
      'fixedHeatFlow',
      'prescribedTemperature',
      'heatCapacitor',
      'powerSensor',
    ],
  },

  temperatureSensor: {
    description: [
      'Measures the absolute temperature of a heat port. It draws no heat.',
    ],
    ports: {
      port: 'Heat port to measure. No heat flows through it.',
      T: 'Temperature, in kelvin.',
    },
    equations: ['T = port.T', 'port.Q_flow = 0'],
    tips: ['Subtract 273.15 for degrees Celsius.'],
    seeAlso: ['relTemperatureSensor', 'heatFlowSensor', 'heatCapacitor'],
  },

  heatFlowSensor: {
    description: [
      'Measures the heat flow through it. Insert it in series in a heat path; it has no temperature drop.',
    ],
    ports: {
      Q_flow: 'Heat flow from port_a to port_b, in watts.',
      port_a: 'Heat port a. Heat flow entering here is counted as positive.',
      port_b: 'Heat port b.',
    },
    equations: [
      'Q_flow = port_a.Q_flow',
      'port_a.T = port_b.T',
      'port_a.Q_flow + port_b.Q_flow = 0',
    ],
    seeAlso: ['temperatureSensor', 'relTemperatureSensor'],
  },

  relTemperatureSensor: {
    description: [
      'Measures the temperature difference between two heat ports. It draws no heat from either.',
    ],
    ports: {
      T_rel: 'Temperature difference port_a.T − port_b.T, in kelvin.',
      port_a: 'Heat port a. No heat flows through it.',
      port_b: 'Heat port b. No heat flows through it.',
    },
    equations: [
      'T_rel = port_a.T − port_b.T',
      'port_a.Q_flow = 0, port_b.Q_flow = 0',
    ],
    seeAlso: ['temperatureSensor', 'heatFlowSensor'],
  },
};
