import type { BlockDoc } from './types';

// Semiconductors, switches, power converters, and three-phase blocks. Each wraps a class
// from the Modelica Standard Library 4.1.0; fixed values quoted here are that class’s
// defaults, which the block does not expose.

const RON =
  'On resistance, in ohms: the slope of the conducting branch. 0 or more; the default 10 µΩ is near-ideal.';
const GOFF =
  'Off conductance, in siemens: the slope of the blocking branch, so the leakage is Goff · v. 0 or more; the default 10 µS leaks 10 µA per volt.';
const RON_T = 'On resistance of each transistor, in ohms. 0 or more.';
const RON_D = 'On resistance of each freewheeling diode, in ohms. 0 or more.';
const FIXED_CONVERTER =
  'Ideal switches: transistors are GTO-type switches that conduct only forward, and diodes switch at 0 V. Off conductance is fixed at 10 µS and knee voltages at 0 V. No switching times, reverse recovery, or conduction voltage drop beyond the on resistance.';

export const docs: Record<string, BlockDoc> = {
  // Semiconductors

  idealDiode: {
    description: [
      'A piecewise-linear diode: a small resistance Ron when conducting, a small conductance Goff when blocking. It switches at the knee point v = Vknee with no smooth transition.',
      'Use it for rectifiers and freewheeling paths where the exact forward curve does not matter.',
    ],
    ports: {
      p: 'Anode. Current into p is counted as positive (forward).',
      n: 'Cathode.',
    },
    parameters: {
      Ron: RON,
      Goff: GOFF,
      Vknee:
        'Forward threshold voltage, in volts. 0 or more; the diode conducts once v exceeds it.',
    },
    equations: [
      'v = p.v − n.v, i = p.i',
      'Blocking (v < Vknee): i = Goff · v',
      'Conducting: v = Vknee + Ron · (i − Goff · Vknee)',
    ],
    limitations: [
      'No reverse recovery, junction capacitance, or reverse breakdown.',
      'Each change of state is an event; many diodes switching at high frequency slow the simulation.',
    ],
    tips: [
      'Set Vknee to about 0.7 V for a silicon forward drop, or use Diode (exponential) for the smooth curve.',
    ],
    seeAlso: ['diodeShockley', 'diode', 'zenerDiode', 'diodeBridge'],
  },

  diodeShockley: {
    description: [
      'A diode with the exponential Shockley characteristic plus a parallel leakage resistance. Use it where the forward voltage or the soft turn-on matters.',
      'Above 15 · Vt the exponential continues as a straight line with the same slope, which keeps the solver stable at large currents.',
    ],
    ports: {
      p: 'Anode. Current into p is counted as positive (forward).',
      n: 'Cathode.',
    },
    parameters: {
      Ids: 'Saturation current, in amperes. Positive; a larger value lowers the forward voltage.',
      Vt: 'Voltage equivalent of temperature (n · k · T / q), in volts. Positive; it sets how sharp the knee is.',
      R: 'Parallel leakage resistance, in ohms. Positive; the default 100 MΩ is negligible in most circuits.',
    },
    equations: [
      'v = p.v − n.v, i = p.i',
      'i = Ids · (exp(v / Vt) − 1) + v / R, for v ≤ 15 · Vt',
      'i = Ids · (exp(15) · (1 + v / Vt − 15) − 1) + v / R, for v > 15 · Vt',
    ],
    limitations: [
      'No temperature dependence (Vt is fixed), reverse breakdown, junction capacitance, or reverse recovery.',
      'No series resistance; above 15 · Vt the linear continuation acts as one.',
    ],
    tips: [
      'With the defaults, the forward voltage is about 0.28 V at 1 mA and 0.55 V at 1 A.',
    ],
    seeAlso: ['idealDiode', 'zenerDiode', 'diode'],
  },

  zenerDiode: {
    description: [
      'A diode with three regions: exponential forward conduction, a leakage region, and exponential reverse breakdown near −Bv. Use it for voltage references and clamps.',
    ],
    ports: {
      p: 'Anode. Current into p is counted as positive (forward). In breakdown, current flows from n to p.',
      n: 'Cathode. Connect it to the more positive node for Zener operation.',
    },
    parameters: {
      Bv: 'Breakdown voltage, in volts, as a positive number: the reverse voltage at which the breakdown current reaches 0.7 A.',
    },
    equations: [
      'v = p.v − n.v, i = p.i',
      'i = Ids · (exp(v / Vt) − 1) − Ibv · exp(−(v + Bv) / (Nbv · Vt)) + v / R',
      'Fixed: Ids = 1 µA, Vt = 0.04 V, Ibv = 0.7 A, Nbv = 0.74, R = 100 MΩ',
      'Both exponentials continue linearly beyond 30 times their scale voltage.',
    ],
    limitations: [
      'Only Bv is adjustable. The knee current Ibv = 0.7 A is large, so at milliampere currents the clamp voltage is about 0.2 V below Bv.',
      'No temperature dependence, capacitance, or dynamic resistance setting.',
    ],
    seeAlso: ['diodeShockley', 'idealDiode'],
  },

  idealThyristor: {
    description: [
      'An ideal thyristor (SCR). It turns on when fire is true while the anode–cathode voltage is forward, then stays on after fire goes false until its current falls to zero.',
      'Fire is level-sensitive: while fire stays true the thyristor behaves like an ideal diode.',
    ],
    ports: {
      fire: 'Gate command (Boolean). A true value turns the thyristor on if it is forward biased.',
      p: 'Anode. Current into p is counted as positive.',
      n: 'Cathode.',
    },
    parameters: { Ron: RON, Goff: GOFF },
    equations: [
      'v = p.v − n.v, i = p.i',
      'Off: i = Goff · v; on: v = Ron · i',
      'off = (s < 0) or (pre(off) and not fire), where s < 0 means v < 0 while off, or i < 0 while on',
    ],
    limitations: [
      'Knee voltage fixed at 0 V. No holding or latching current, gate current, dv/dt triggering, turn-off time, or reverse recovery.',
    ],
    tips: [
      'Short fire pulses are enough to trigger it; delay them from the voltage zero crossing to set the firing angle.',
    ],
    seeAlso: ['idealGTO', 'thyristorBridge', 'idealDiode'],
  },

  idealGTO: {
    description: [
      'An ideal gate turn-off thyristor: it conducts only while fire is true and the device is forward biased, and turns off as soon as fire goes false.',
      'Use it as a generic unidirectional power switch (IGBT or GTO); add an antiparallel diode for reverse current.',
    ],
    ports: {
      fire: 'Gate command (Boolean). True allows forward conduction; false blocks.',
      p: 'Anode. Current into p is counted as positive.',
      n: 'Cathode.',
    },
    parameters: { Ron: RON, Goff: GOFF },
    equations: [
      'v = p.v − n.v, i = p.i',
      'Off: i = Goff · v; on: v = Ron · i',
      'off = (s < 0) or not fire, where s < 0 means v < 0 while off, or i < 0 while on',
    ],
    limitations: [
      'Knee voltage fixed at 0 V. Blocks reverse current even when fire is true. No switching times, tail current, or switching losses.',
      'Turning it off with inductive current and no freewheeling path forces the current into Goff, which produces a very large voltage.',
    ],
    seeAlso: [
      'idealThyristor',
      'closingSwitch',
      'idealDiode',
      'singlePhaseInverter',
    ],
  },

  nmos: {
    description: [
      'An N-channel MOSFET using a simplified Shichman–Hodges (level 1) model with a body effect. Drain and source are interchangeable: the lower-potential terminal acts as the source.',
      'The fixed process parameters describe a small integrated device carrying microamperes to milliamperes, not a power MOSFET.',
    ],
    ports: {
      D: 'Drain.',
      G: 'Gate. Draws no current.',
      S: 'Source.',
      B: 'Bulk (body). Draws no current; it only shifts the threshold. Usually tied to S or the lowest potential.',
    },
    parameters: {
      W: 'Channel width, in meters. Must exceed 2.5 µm, since the effective width is W − 2.5 µm.',
      L: 'Channel length, in meters. Must exceed 1.5 µm, since the effective length is L − 1.5 µm.',
    },
    equations: [
      'us = min(D.v, S.v), uds = |D.v − S.v|, ubs = min(B.v − us, 0)',
      'β = Beta · (W + dW) / (L + dL)',
      'ugst = (G.v − us − Vt + K2 · ubs) · K5',
      'id = uds / RDS, for ugst ≤ 0',
      'id = β · uds · (ugst − uds / 2) + uds / RDS, for ugst > uds',
      'id = β · ugst² / 2 + uds / RDS, otherwise',
      'Fixed: Beta = 41 µA/V², Vt = 0.8 V, K2 = 1.144, K5 = 0.7311, dW = −2.5 µm, dL = −1.5 µm, RDS = 10 MΩ',
    ],
    limitations: [
      'Static model: no gate, junction, or overlap capacitances, so no switching transients. No body diode, and no temperature dependence.',
    ],
    tips: [
      'For a power switch driven by a Boolean, use GTO thyristor or Switch (Boolean) instead.',
    ],
    seeAlso: ['pmos', 'npn', 'idealGTO'],
  },

  pmos: {
    description: [
      'A P-channel MOSFET using a simplified Shichman–Hodges (level 1) model with a body effect. Drain and source are interchangeable: the higher-potential terminal acts as the source.',
      'The fixed process parameters describe a small integrated device, not a power MOSFET.',
    ],
    ports: {
      D: 'Drain.',
      G: 'Gate. Draws no current.',
      S: 'Source.',
      B: 'Bulk (body). Draws no current; it only shifts the threshold. Usually tied to S or the highest potential.',
    },
    parameters: {
      W: 'Channel width, in meters. Must exceed 2.5 µm, since the effective width is W − 2.5 µm.',
      L: 'Channel length, in meters. Must exceed 2.1 µm, since the effective length is L − 2.1 µm.',
    },
    equations: [
      'us = max(D.v, S.v), uds = min(D.v, S.v) − us, ubs = max(B.v − us, 0)',
      'β = Beta · (W + dW) / (L + dL)',
      'ugst = (G.v − us − Vt + K2 · ubs) · K5',
      'id = uds / RDS, for ugst ≥ 0',
      'id = −β · uds · (ugst − uds / 2) + uds / RDS, for ugst < uds',
      'id = −β · ugst² / 2 + uds / RDS, otherwise',
      'Fixed: Beta = 10.5 µA/V², Vt = −1 V, K2 = 0.41, K5 = 0.839, dW = −2.5 µm, dL = −2.1 µm, RDS = 10 MΩ',
    ],
    limitations: [
      'Static model: no capacitances, so no switching transients. No body diode, and no temperature dependence.',
    ],
    seeAlso: ['nmos', 'pnp'],
  },

  npn: {
    description: [
      'An NPN bipolar transistor using the Ebers–Moll model with the Early effect, transit-time charge, and junction capacitances.',
    ],
    ports: {
      C: 'Collector.',
      B: 'Base.',
      E: 'Emitter. Carries the sum of collector and base currents, less the substrate current.',
    },
    parameters: { Bf: 'Forward current gain β. Positive.' },
    equations: [
      'vbe = B.v − E.v, vbc = B.v − C.v',
      'ibe = Is · (exp(vbe / Vt) − 1) + Gbe · vbe, ibc = Is · (exp(vbc / Vt) − 1) + Gbc · vbc',
      'C.i = (ibe − ibc) · (1 − Vak · vbc) − ibc / Br − cbc · d(vbc)/dt − iS',
      'B.i = ibe / Bf + ibc / Br + cbc · d(vbc)/dt + cbe · d(vbe)/dt',
      'iS = −Ccs · d(C.v)/dt',
      'Fixed: Br = 0.1, Is = 0.1 fA, Vt = 25.85 mV, Vak = 0.02 1/V, Tauf = 0.12 ns, Taur = 5 ns, Cje = 0.4 pF, Cjc = 0.5 pF, Ccs = 1 pF, Gbe = Gbc = 1 fS',
    ],
    limitations: [
      'Only Bf is adjustable. No base, collector, or emitter series resistance, and no temperature dependence.',
      'The substrate is implicitly grounded: Ccs connects the collector to ground.',
      'The exponentials continue linearly above 40 · Vt (about 1 V).',
    ],
    seeAlso: ['pnp', 'nmos', 'diodeShockley'],
  },

  pnp: {
    description: [
      'A PNP bipolar transistor using the Ebers–Moll model with the Early effect, transit-time charge, and junction capacitances.',
    ],
    ports: {
      C: 'Collector.',
      B: 'Base.',
      E: 'Emitter.',
    },
    parameters: { Bf: 'Forward current gain β. Positive.' },
    equations: [
      'veb = E.v − B.v, vcb = C.v − B.v',
      'ieb = Is · (exp(veb / Vt) − 1) + Gbe · veb, icb = Is · (exp(vcb / Vt) − 1) + Gbc · vcb',
      'C.i = icb / Br + ccb · d(vcb)/dt + (icb − ieb) · (1 − Vak · vcb) − iS',
      'B.i = −ieb / Bf − icb / Br − ceb · d(veb)/dt − ccb · d(vcb)/dt',
      'iS = −Ccs · d(C.v)/dt',
      'Fixed: Br = 0.1, Is = 0.1 fA, Vt = 25.85 mV, Vak = 0.02 1/V, Tauf = 0.12 ns, Taur = 5 ns, Cje = 0.4 pF, Cjc = 0.5 pF, Ccs = 1 pF, Gbe = Gbc = 1 fS',
    ],
    limitations: [
      'Only Bf is adjustable. No series resistances and no temperature dependence.',
      'The substrate is implicitly grounded: Ccs connects the collector to ground.',
    ],
    seeAlso: ['npn', 'pmos'],
  },

  closingSwitch: {
    description: [
      'An ideal bidirectional switch that is closed while control is true and open while it is false. Use it for relays, contactors, and scheduled connections.',
    ],
    ports: {
      control: 'Boolean command: true closes the switch.',
      p: 'Terminal 1. Current into p is counted as positive.',
      n: 'Terminal 2.',
    },
    parameters: { Ron: RON, Goff: GOFF },
    equations: [
      'v = p.v − n.v, i = p.i',
      'Closed (control true): v = Ron · i',
      'Open (control false): i = Goff · v',
    ],
    limitations: [
      'Switches instantly with no arc or bounce. Opening an inductive current forces it through Goff and gives a large voltage spike.',
    ],
    tips: [
      'For an opening switch that models the arc, use Breaker (with arc).',
    ],
    seeAlso: ['openingSwitch', 'twoWaySwitch', 'breaker', 'idealSwitch'],
  },

  openingSwitch: {
    description: [
      'An ideal bidirectional switch that is open while control is true and closed while it is false. Use it to disconnect a branch or inject a fault at a set time.',
    ],
    ports: {
      control: 'Boolean command: true opens the switch.',
      p: 'Terminal 1. Current into p is counted as positive.',
      n: 'Terminal 2.',
    },
    parameters: { Ron: RON, Goff: GOFF },
    equations: [
      'v = p.v − n.v, i = p.i',
      'Closed (control false): v = Ron · i',
      'Open (control true): i = Goff · v',
    ],
    limitations: [
      'Switches instantly with no arc. Interrupting an inductive current gives a large voltage spike.',
    ],
    seeAlso: ['closingSwitch', 'breaker', 'twoWaySwitch'],
  },

  twoWaySwitch: {
    description: [
      'An ideal single-pole double-throw switch: p connects to n1 while control is false and to n2 while it is true. The unselected path is open.',
    ],
    ports: {
      p: 'Common terminal.',
      n1: 'Terminal selected while control is false.',
      n2: 'Terminal selected while control is true.',
      control: 'Boolean selector: false selects n1, true selects n2.',
    },
    parameters: {
      Ron: 'On resistance of the selected path, in ohms. 0 or more.',
      Goff: 'Off conductance of the unselected path, in siemens. 0 or more.',
    },
    equations: [
      'p.i + n1.i + n2.i = 0',
      'control false: p.v − n1.v = Ron · i1, i2 = Goff · (p.v − n2.v)',
      'control true: p.v − n2.v = Ron · i2, i1 = Goff · (p.v − n1.v)',
      'i1 = −n1.i and i2 = −n2.i are the currents from p to each terminal',
    ],
    limitations: [
      'Break-before-make timing is not modeled: both paths change at the same instant.',
    ],
    seeAlso: ['closingSwitch', 'openingSwitch'],
  },

  breaker: {
    description: [
      'An opening switch with a simple arc model. While control is false it is closed. When control turns true, an arc keeps current flowing with a voltage that starts at V0 and rises at dVdt up to Vmax.',
      'The arc quenches once the current has fallen to the leakage level, and the switch then blocks with conductance Goff until it closes again.',
    ],
    ports: {
      control: 'Boolean trip command: true opens the contacts.',
      p: 'Terminal 1. Current into p is counted as positive.',
      n: 'Terminal 2.',
    },
    parameters: {
      Ron: 'Closed-contact resistance, in ohms. 0 or more.',
      Goff: 'Conductance after the arc quenches, in siemens. 0 or more.',
      V0: 'Arc voltage at the instant of opening, in volts. 0 or more.',
      dVdt: 'Rate at which the arc voltage rises, in V/s. 0 or more.',
      Vmax: 'Maximum arc voltage, in volts. The arc voltage stops rising here; reaching it does not by itself quench the arc.',
    },
    equations: [
      'v = p.v − n.v, i = p.i',
      'Closed: v = Ron · i',
      'Arcing: v = min(Vmax, V0 + dVdt · (time − tOpen)) · sign(i)',
      'Quenched once |i| ≤ Goff · |v|; then i = Goff · v',
    ],
    limitations: [
      'The arc voltage depends only on time since opening, not on current, cooling, or contact gap. There is no re-strike after quenching.',
      'In an AC circuit the arc quenches at the next current zero. In a DC circuit it quenches only if the arc voltage can drive the current to zero, typically when Vmax exceeds the source voltage.',
    ],
    seeAlso: ['openingSwitch', 'closingSwitch'],
  },

  // Converters

  buckConverter: {
    description: [
      'The switches of a step-down (buck) chopper: a transistor from dc_p1 to dc_p2 and a freewheeling diode from dc_n1 (anode) to dc_p2 (cathode). dc_n1 and dc_n2 are the same node.',
      'The block has no inductor or capacitor. Add a series inductor and a capacitor after dc_p2 to form the converter.',
    ],
    ports: {
      dc_p1: 'Input positive terminal.',
      dc_n1: 'Input negative terminal, connected internally to dc_n2.',
      dc_p2:
        'Output positive terminal: the switch node where transistor and diode meet.',
      dc_n2: 'Output negative terminal, connected internally to dc_n1.',
      fire_p: 'Transistor gate (Boolean). True turns the transistor on.',
    },
    parameters: { RonTransistor: RON_T, RonDiode: RON_D },
    equations: [
      'fire_p true: dc_p2 follows dc_p1 (through RonTransistor)',
      'fire_p false: the diode carries the inductor current from dc_n1 to dc_p2',
      'Continuous conduction, duty cycle d: mean(v2) ≈ d · v1',
    ],
    limitations: [FIXED_CONVERTER, 'Power flows only from input to output.'],
    tips: ['Drive fire_p from the fire output of a PWM generator.'],
    seeAlso: [
      'pwmSignal',
      'boostConverter',
      'buckBoostConverter',
      'inductor',
      'capacitor',
    ],
  },

  boostConverter: {
    description: [
      'The switches of a step-up (boost) chopper: a transistor across the input (dc_p1 to dc_n1) and a diode from dc_p1 to dc_p2. dc_n1 and dc_n2 are the same node.',
      'The block has no inductor. Put an inductor in series between the source and dc_p1, and a capacitor across the output.',
    ],
    ports: {
      dc_p1:
        'Input positive terminal: the switch node. Connect it to the source through the boost inductor.',
      dc_n1: 'Input negative terminal, connected internally to dc_n2.',
      dc_p2: 'Output positive terminal (diode cathode).',
      dc_n2: 'Output negative terminal, connected internally to dc_n1.',
      fire_p:
        'Transistor gate (Boolean). True shorts dc_p1 to dc_n1 through the transistor.',
    },
    parameters: { RonTransistor: RON_T, RonDiode: RON_D },
    equations: [
      'fire_p true: v1 ≈ 0, the inductor charges from the source',
      'fire_p false: the diode carries the inductor current to dc_p2',
      'Continuous conduction, duty cycle d: mean(v2) ≈ vsource / (1 − d)',
    ],
    limitations: [
      FIXED_CONVERTER,
      'Without an external series inductor, turning the transistor on shorts the source.',
    ],
    seeAlso: ['pwmSignal', 'buckConverter', 'buckBoostConverter', 'inductor'],
  },

  buckBoostConverter: {
    description: [
      'A bidirectional half-bridge chopper: two transistors, each with an antiparallel diode. The low-side switch sits across port 1 (dc_p1 to dc_n1); the high-side switch conducts from dc_p2 to dc_p1. dc_n1 and dc_n2 are the same node.',
      'Port 1 is the switch node and needs an external series inductor; port 2 is the high-voltage bus. Switching fire_p boosts power from port 1 to port 2; switching fire_n bucks power from port 2 to port 1.',
    ],
    ports: {
      dc_p1:
        'Low-voltage side positive terminal: the switch node. Connect it through the inductor.',
      dc_n1:
        'Low-voltage side negative terminal, connected internally to dc_n2.',
      dc_p2: 'High-voltage side positive terminal.',
      dc_n2:
        'High-voltage side negative terminal, connected internally to dc_n1.',
      fire_p:
        'Gate of the low-side transistor (dc_p1 to dc_n1). Its duty cycle sets the step-up ratio.',
      fire_n:
        'Gate of the high-side transistor (dc_p2 to dc_p1). Its duty cycle sets the step-down ratio.',
    },
    parameters: { RonTransistor: RON_T, RonDiode: RON_D },
    equations: [
      'Complementary gating, fire_p duty cycle d, continuous conduction: mean(v1) ≈ (1 − d) · v2',
      'The sign of the inductor current sets the direction of power flow.',
    ],
    limitations: [
      FIXED_CONVERTER,
      'It cannot produce v1 > v2: it is not a four-switch non-inverting buck-boost.',
      'fire_p and fire_n both true shorts port 2. No dead time is inserted.',
    ],
    tips: [
      'Drive fire_p from fire and fire_n from notFire of one PWM generator.',
    ],
    seeAlso: ['pwmSignal', 'buckConverter', 'boostConverter', 'hBridge'],
  },

  hBridge: {
    description: [
      'A four-quadrant DC chopper made of two half-bridge legs across the input. Leg p drives dc_p2 and leg n drives dc_n2; each leg has two transistors with antiparallel diodes.',
      'Each fire input controls one leg: true turns on its upper transistor, false its lower transistor. The complement is generated inside, so a leg cannot short the input.',
    ],
    ports: {
      dc_p1: 'DC supply positive terminal.',
      dc_n1: 'DC supply negative terminal.',
      dc_p2: 'Output terminal of leg p.',
      dc_n2: 'Output terminal of leg n. Not connected to dc_n1.',
      fire_p: 'Leg p command: true connects dc_p2 to dc_p1, false to dc_n1.',
      fire_n: 'Leg n command: true connects dc_n2 to dc_p1, false to dc_n1.',
    },
    parameters: { RonTransistor: RON_T, RonDiode: RON_D },
    equations: [
      'v2 = dc_p2.v − dc_n2.v, v1 = dc_p1.v − dc_n1.v',
      'fire_p and not fire_n: v2 = +v1; fire_n and not fire_p: v2 = −v1; fire_p = fire_n: v2 = 0',
      'Bipolar PWM (fire_n = not fire_p), duty cycle d: mean(v2) = (2d − 1) · v1',
    ],
    limitations: [
      FIXED_CONVERTER,
      'No dead time between the upper and lower switch of a leg.',
    ],
    tips: [
      'For bipolar PWM, drive fire_p from fire and fire_n from notFire of one PWM generator; a duty cycle of 0.5 gives zero mean output.',
    ],
    seeAlso: [
      'pwmSignal',
      'singlePhaseInverter',
      'dcPmMachine',
      'buckBoostConverter',
    ],
  },

  pwmSignal: {
    description: [
      'Generates a pulse-width-modulated fire signal and its complement. The duty-cycle input is clipped to 0…1, sampled at the start of each switching period, and compared with a sawtooth carrier that rises from 0 to 1 once per period.',
    ],
    ports: {
      dutyCycle: 'Duty cycle, dimensionless. Values outside 0…1 are clipped.',
      fire: 'PWM output (Boolean): true while the held duty cycle exceeds the carrier.',
      notFire: 'Complement of fire.',
    },
    parameters: {
      f: 'Switching frequency, in Hz. Positive; the switching period is 1 / f.',
    },
    equations: [
      'dk = min(max(dutyCycle(k / f), 0), 1), held for k / f ≤ time < (k + 1) / f',
      'carrier = f · time − floor(f · time)',
      'fire = dk > carrier, notFire = not fire',
    ],
    limitations: [
      'Sawtooth carrier only, starting at time 0 (trailing-edge modulation). No dead time between fire and notFire.',
      'The duty cycle is sampled once per period, so the output lags the input by up to one period.',
    ],
    tips: [
      'Each period adds two events; keep the maximum step size well below 1 / f.',
    ],
    seeAlso: ['buckConverter', 'hBridge', 'buckBoostConverter', 'pwmPair'],
  },

  diodeBridge: {
    description: [
      'A single-phase full-wave (two-pulse) rectifier of four ideal diodes. dc_p is fed from ac_p and ac_n through two diodes; dc_n returns through the other two.',
      'There is no smoothing capacitor; add one across dc_p and dc_n if needed.',
    ],
    ports: {
      ac_p: 'AC terminal 1.',
      ac_n: 'AC terminal 2.',
      dc_p: 'DC positive terminal (common cathode of the upper diodes).',
      dc_n: 'DC negative terminal (common anode of the lower diodes).',
    },
    parameters: {
      RonDiode: 'On resistance of each diode, in ohms. 0 or more.',
      GoffDiode: 'Off conductance of each diode, in siemens. 0 or more.',
    },
    equations: [
      'With a resistive load and no capacitor: dc_p.v − dc_n.v ≈ |ac_p.v − ac_n.v|',
    ],
    limitations: [
      'Ideal diodes with the knee voltage fixed at 0 V: no forward drop, reverse recovery, or junction capacitance.',
    ],
    seeAlso: ['thyristorBridge', 'idealDiode', 'capacitor'],
  },

  thyristorBridge: {
    description: [
      'A single-phase fully controlled (two-pulse) bridge of four ideal thyristors. Delaying the fire signals from the AC zero crossings sets the firing angle α and so the mean DC voltage.',
      'fire_p fires the pair that conducts while ac_p is above ac_n (ac_p to dc_p and dc_n to ac_n). fire_n fires the pair for the other half-cycle (ac_n to dc_p and dc_n to ac_p).',
    ],
    ports: {
      ac_p: 'AC terminal 1.',
      ac_n: 'AC terminal 2.',
      dc_p: 'DC positive terminal.',
      dc_n: 'DC negative terminal.',
      fire_p: 'Gate command for the positive half-cycle pair (Boolean).',
      fire_n: 'Gate command for the negative half-cycle pair (Boolean).',
    },
    parameters: {
      RonThyristor: 'On resistance of each thyristor, in ohms. 0 or more.',
      GoffThyristor:
        'Off conductance of each thyristor, in siemens. 0 or more.',
    },
    equations: [
      'Continuous DC current, AC amplitude V̂: mean(dc_p.v − dc_n.v) = (2 · V̂ / π) · cos α',
    ],
    limitations: [
      'Ideal thyristors with the knee voltage fixed at 0 V. No holding current, turn-off time, or commutation overlap unless you add source inductance.',
      'Firing logic is not included; you supply both fire signals.',
    ],
    tips: [
      'A thyristor latches, so short pulses at the line frequency, delayed by α / (2π · f), are enough. A fire signal held true makes its pair act as diodes.',
    ],
    seeAlso: ['diodeBridge', 'idealThyristor', 'booleanPulse'],
  },

  singlePhaseInverter: {
    description: [
      'A single-phase two-level inverter leg (half-bridge): an upper transistor from dc_p to ac and a lower transistor from ac to dc_n, each with an antiparallel freewheeling diode.',
    ],
    ports: {
      dc_p: 'DC bus positive terminal.',
      dc_n: 'DC bus negative terminal.',
      ac: 'AC output terminal (the leg midpoint).',
      fire_p: 'Upper transistor gate (Boolean). True connects ac to dc_p.',
      fire_n: 'Lower transistor gate (Boolean). True connects ac to dc_n.',
    },
    parameters: { RonTransistor: RON_T, RonDiode: RON_D },
    equations: [
      'fire_p true: ac.v ≈ dc_p.v; fire_n true: ac.v ≈ dc_n.v',
      'Both false: the diodes set ac.v by the direction of the load current',
    ],
    limitations: [
      FIXED_CONVERTER,
      'fire_p and fire_n both true shorts the DC bus; nothing prevents it and no dead time is inserted.',
    ],
    tips: [
      'Drive fire_p from fire and fire_n from notFire of one PWM generator.',
      'For an AC load, return it to a DC midpoint, such as the junction of two series capacitors or two sources.',
    ],
    seeAlso: ['threePhaseInverter', 'hBridge', 'pwmSignal', 'inverter'],
  },

  threePhaseInverter: {
    description: [
      'A three-phase two-level voltage-source inverter: three half-bridge legs across the DC bus, each with an upper and lower transistor and antiparallel diodes. Each switch has its own fire input.',
    ],
    ports: {
      dc_p: 'DC bus positive terminal.',
      dc_n: 'DC bus negative terminal.',
      ac: 'Three-phase output plug carrying phases a, b, and c (the three leg midpoints).',
      fa_p: 'Phase a upper transistor gate: true connects a to dc_p.',
      fb_p: 'Phase b upper transistor gate: true connects b to dc_p.',
      fc_p: 'Phase c upper transistor gate: true connects c to dc_p.',
      fa_n: 'Phase a lower transistor gate: true connects a to dc_n.',
      fb_n: 'Phase b lower transistor gate: true connects b to dc_n.',
      fc_n: 'Phase c lower transistor gate: true connects c to dc_n.',
    },
    parameters: { RonTransistor: RON_T, RonDiode: RON_D },
    equations: [
      'For phase k: upper on → vk ≈ dc_p.v; lower on → vk ≈ dc_n.v; both off → set by the diodes and the phase current',
    ],
    limitations: [
      FIXED_CONVERTER,
      'The upper and lower gates of a phase both true short the DC bus. No dead time is inserted.',
    ],
    tips: [
      'Drive each phase pair from one PWM generator (fire to the upper gate, notFire to the lower gate).',
      'For a model without switching ripple, use the averaged Inverter.',
    ],
    seeAlso: [
      'singlePhaseInverter',
      'inverter',
      'pwmSignal',
      'inductionMachine',
      'pmSyncMachine',
    ],
  },

  // Three-phase

  threePhaseSource: {
    description: [
      'Three sinusoidal voltage sources, one per phase, forming a balanced positive-sequence (a, b, c) system. Phase k acts between phase k of plug_p and phase k of plug_n.',
      'plug_n is a three-phase plug, not a single neutral pin. Connect a Star point to it to make a wye source with a neutral.',
    ],
    ports: {
      plug_p: 'Three-phase output plug (phases a, b, c).',
      plug_n:
        'Three-phase return plug: the negative terminal of each phase source.',
    },
    parameters: {
      V: 'Peak amplitude of each phase voltage, in volts (not rms). The default 325 V is 230 V rms phase, 400 V line to line.',
      f: 'Frequency, in Hz. 0 or more.',
    },
    equations: [
      'va = V · sin(2π · f · time)',
      'vb = V · sin(2π · f · time − 2π/3)',
      'vc = V · sin(2π · f · time − 4π/3)',
      'vk = plug_p.k.v − plug_n.k.v',
    ],
    limitations: [
      'Ideal sources: no internal impedance, harmonics, or imbalance. Phase angle and offset are fixed at 0.',
    ],
    tips: ['Connect plug_n to a Star point and ground the star’s N pin.'],
    seeAlso: [
      'star',
      'threePhaseResistor',
      'threePhaseInductor',
      'sineVoltage',
    ],
  },

  threePhaseResistor: {
    description: [
      'Three independent linear resistors, one in each phase between plug_p and plug_n.',
    ],
    ports: {
      plug_p:
        'Three-phase plug (phases a, b, c). Current into plug_p is counted as positive.',
      plug_n: 'Three-phase plug (phases a, b, c).',
    },
    parameters: { R: 'Resistance of each phase, in ohms. Positive.' },
    equations: [
      'vk = R · ik for k = a, b, c, with vk = plug_p.k.v − plug_n.k.v',
    ],
    limitations: ['Same value in every phase. No temperature dependence.'],
    tips: [
      'For a wye load, connect plug_n to a Star point; for a delta load, connect it through a Delta connection.',
    ],
    seeAlso: [
      'threePhaseInductor',
      'threePhaseCapacitor',
      'star',
      'delta',
      'resistor',
    ],
  },

  threePhaseInductor: {
    description: [
      'Three independent linear inductors, one in each phase between plug_p and plug_n, with no coupling between phases.',
    ],
    ports: {
      plug_p:
        'Three-phase plug (phases a, b, c). Current into plug_p is counted as positive.',
      plug_n: 'Three-phase plug (phases a, b, c).',
    },
    parameters: { L: 'Inductance of each phase, in henries. Positive.' },
    equations: ['vk = L · d(ik)/dt for k = a, b, c'],
    limitations: ['No mutual coupling, saturation, or winding resistance.'],
    tips: [
      'Use it as a line reactor or grid impedance, often in series with a 3-phase resistor.',
    ],
    seeAlso: ['threePhaseResistor', 'threePhaseCapacitor', 'inductor'],
  },

  threePhaseCapacitor: {
    description: [
      'Three independent linear capacitors, one in each phase between plug_p and plug_n.',
    ],
    ports: {
      plug_p:
        'Three-phase plug (phases a, b, c). Current into plug_p is counted as positive.',
      plug_n: 'Three-phase plug (phases a, b, c).',
    },
    parameters: { C: 'Capacitance of each phase, in farads. Positive.' },
    equations: ['ik = C · d(vk)/dt for k = a, b, c'],
    limitations: ['No leakage or series resistance.'],
    seeAlso: ['threePhaseResistor', 'threePhaseInductor', 'capacitor'],
  },

  star: {
    description: [
      'Joins the three phases of a plug at one neutral pin, forming a wye (star) point.',
    ],
    ports: {
      plug_p: 'Three-phase plug (phases a, b, c), all joined to pin_n.',
      pin_n:
        'Neutral pin (single-phase). Carries the sum of the three phase currents.',
    },
    equations: [
      'plug_p.a.v = plug_p.b.v = plug_p.c.v = pin_n.v',
      'plug_p.a.i + plug_p.b.i + plug_p.c.i + pin_n.i = 0',
    ],
    tips: [
      'Ground pin_n to reference a floating three-phase circuit; leave it unconnected for an isolated neutral.',
    ],
    seeAlso: ['delta', 'threePhaseSource', 'ground'],
  },

  delta: {
    description: [
      'Connects three single-phase elements in delta. Wire the elements’ plug_p to the line and to this block’s plug_p, and their plug_n to this block’s plug_n. Element a then sits between lines a and b, b between b and c, and c between c and a.',
    ],
    ports: {
      plug_p: 'Three-phase plug in order a, b, c.',
      plug_n:
        'Three-phase plug in order b, c, a: its phase a is joined to phase b of plug_p, and so on.',
    },
    equations: [
      'plug_n.a = plug_p.b, plug_n.b = plug_p.c, plug_n.c = plug_p.a (same potential and current balance)',
    ],
    seeAlso: ['star', 'threePhaseResistor', 'threePhaseTransformer'],
  },

  phaseA: {
    description: [
      'Taps phase a of a three-phase plug as a single-phase pin, so single-phase blocks can connect to it. The other phases carry no current through this block.',
    ],
    ports: {
      plug_p: 'Three-phase plug (phases a, b, c).',
      pin_p: 'Single-phase pin at the potential of phase a.',
    },
    equations: [
      'pin_p.v = plug_p.a.v',
      'plug_p.a.i = −pin_p.i, plug_p.b.i = plug_p.c.i = 0',
    ],
    seeAlso: ['phaseB', 'phaseC', 'star'],
  },

  phaseB: {
    description: [
      'Taps phase b of a three-phase plug as a single-phase pin, so single-phase blocks can connect to it. The other phases carry no current through this block.',
    ],
    ports: {
      plug_p: 'Three-phase plug (phases a, b, c).',
      pin_p: 'Single-phase pin at the potential of phase b.',
    },
    equations: [
      'pin_p.v = plug_p.b.v',
      'plug_p.b.i = −pin_p.i, plug_p.a.i = plug_p.c.i = 0',
    ],
    seeAlso: ['phaseA', 'phaseC', 'star'],
  },

  phaseC: {
    description: [
      'Taps phase c of a three-phase plug as a single-phase pin, so single-phase blocks can connect to it. The other phases carry no current through this block.',
    ],
    ports: {
      plug_p: 'Three-phase plug (phases a, b, c).',
      pin_p: 'Single-phase pin at the potential of phase c.',
    },
    equations: [
      'pin_p.v = plug_p.c.v',
      'plug_p.c.i = −pin_p.i, plug_p.a.i = plug_p.b.i = 0',
    ],
    seeAlso: ['phaseA', 'phaseB', 'star'],
  },

  threePhaseTransformer: {
    description: [
      'A three-phase two-winding transformer with vector group Dy1: delta-connected high-voltage winding, star-connected low-voltage winding with an accessible neutral. The low-voltage side lags the high-voltage side by 30°.',
      'Each winding has a fixed series resistance and leakage inductance; the core is ideal.',
    ],
    ports: {
      plug1:
        'High-voltage three-phase plug (phases a, b, c), delta winding. No neutral.',
      plug2: 'Low-voltage three-phase plug (phases a, b, c), star winding.',
      starpoint2: 'Neutral of the low-voltage star winding (single-phase pin).',
    },
    parameters: {
      n: 'Ratio of high-voltage to low-voltage line-to-line voltage. Positive.',
    },
    equations: [
      'No load: line-to-line voltage of plug1 = n · line-to-line voltage of plug2',
      'Fixed per phase: R1 = R2 = 10 mΩ, L1σ = L2σ = 1 mH, at 20 °C',
    ],
    limitations: [
      'Ideal core: no magnetizing current, core loss, saturation, or inrush.',
      'The winding resistances and leakage inductances are not adjustable. At 50 Hz, 1 mH is about 0.31 Ω per winding, which is large for low-voltage, high-current use.',
    ],
    tips: [
      'Ground starpoint2 to reference the low-voltage side; the delta side has no ground path of its own.',
    ],
    seeAlso: ['idealTransformer', 'threePhaseSource', 'delta', 'star'],
  },

  threePhaseCurrentSensor: {
    description: [
      'Measures the three phase currents flowing from plug_p to plug_n. Insert it in series; it has no voltage drop.',
    ],
    ports: {
      plug_p: 'Three-phase plug (phases a, b, c) where current enters.',
      plug_n: 'Three-phase plug (phases a, b, c) where current leaves.',
      ia: 'Phase a current, in amperes, positive from plug_p to plug_n.',
      ib: 'Phase b current, in amperes, positive from plug_p to plug_n.',
      ic: 'Phase c current, in amperes, positive from plug_p to plug_n.',
    },
    equations: ['plug_p.k.v = plug_n.k.v', 'ik = plug_p.k.i for k = a, b, c'],
    tips: ['Feed ia, ib, ic to a Clarke transform for α–β currents.'],
    seeAlso: [
      'threePhaseVoltageSensor',
      'threePhasePowerSensor',
      'clarke',
      'currentSensor',
    ],
  },

  threePhaseVoltageSensor: {
    description: [
      'Measures the three voltages between corresponding phases of plug_p and plug_n. It draws no current.',
      'For phase-to-neutral voltages, connect plug_n to a Star point tied to the neutral.',
    ],
    ports: {
      plug_p: 'Three-phase plug (phases a, b, c), positive side.',
      plug_n: 'Three-phase plug (phases a, b, c), reference side.',
      va: 'plug_p.a.v − plug_n.a.v, in volts.',
      vb: 'plug_p.b.v − plug_n.b.v, in volts.',
      vc: 'plug_p.c.v − plug_n.c.v, in volts.',
    },
    equations: [
      'vk = plug_p.k.v − plug_n.k.v for k = a, b, c',
      'plug_p.k.i = plug_n.k.i = 0',
    ],
    seeAlso: [
      'threePhaseCurrentSensor',
      'threePhasePowerSensor',
      'star',
      'voltageSensor',
    ],
  },

  threePhasePowerSensor: {
    description: [
      'Measures the total instantaneous power of a three-phase circuit. The current path pc–nc goes in series; the voltage path pv–nv goes across the element.',
    ],
    ports: {
      pc: 'Current path input (phases a, b, c). Current enters here.',
      nc: 'Current path output (phases a, b, c). Zero voltage drop from pc.',
      pv: 'Voltage path positive plug (phases a, b, c). Draws no current.',
      nv: 'Voltage path reference plug (phases a, b, c). Draws no current.',
      power: 'Total instantaneous power, in watts.',
    },
    equations: [
      'power = Σ (pv.k.v − nv.k.v) · pc.k.i, summed over k = a, b, c',
    ],
    limitations: [
      'Instantaneous power only; for average or reactive power, filter or process the output.',
    ],
    tips: [
      'For power into a load: pc on the source side, nc to the load, pv to the load’s phases, nv to its star point or return.',
    ],
    seeAlso: [
      'threePhaseCurrentSensor',
      'threePhaseVoltageSensor',
      'powerSensor',
    ],
  },
};
