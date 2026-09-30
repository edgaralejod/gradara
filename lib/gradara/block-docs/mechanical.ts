import type { BlockDoc } from './types';

// Rotational and translational mechanics. Sign convention throughout: a torque or force
// acting on a flange is positive when it acts into the component (flange.tau, flange.f).

export const docs: Record<string, BlockDoc> = {
  // ── Rotational: loads and components ────────────────────────────────────────────────

  shaftLoad: {
    description: [
      'A complete test load for a motor shaft: an inertia with viscous friction to the housing and a load torque that steps up at a set time. Use it to check how a speed or current controller rejects a load disturbance.',
      'The load torque is also sent to the TL output, so you can plot it next to the motor torque.',
    ],
    ports: {
      flange:
        'Shaft flange. Torque into the flange drives the load in the positive direction.',
      loadTorque: 'The load torque currently applied, in N·m (signal output).',
    },
    parameters: {
      J: 'Moment of inertia of the load, in kg·m². Must be positive.',
      damping:
        'Viscous friction coefficient to the housing, in N·m·s. Zero or positive.',
      initialLoad: 'Load torque before the step, in N·m.',
      stepLoad: 'Torque added to the load at loadTime, in N·m.',
      loadTime: 'Time of the load step, in seconds.',
    },
    equations: [
      'loadTorque = initialLoad for time < loadTime, initialLoad + stepLoad afterward',
      'J · dω/dt = flange.tau − damping · ω − loadTorque',
      'ω = dφ/dt, with φ(0) = 0 and ω(0) = 0',
    ],
    limitations: [
      'The load torque does not depend on speed or direction: it always acts in the negative direction. If the drive torque is smaller than the load, the shaft turns backward rather than stalling.',
      'The initial angle and speed are fixed at zero. Driving the flange from a speed source, or rigidly joining another block that also fixes its initial speed, over-determines the initial conditions.',
    ],
    tips: [
      'For a load with a different profile, combine Inertia (ideal) with Torque source or Torque step.',
    ],
    seeAlso: ['inertia', 'rotInertia', 'torqueStep', 'pmsm', 'motor'],
  },

  inertia: {
    description: [
      'A rotating load with inertia and viscous friction to the housing. Both flanges are rigidly attached to the same body, so the block can sit between a motor and further drivetrain parts.',
    ],
    ports: {
      a: 'Shaft flange a. Torque into the flange is positive.',
      b: 'Shaft flange b, rigidly joined to a (same angle).',
    },
    parameters: {
      J: 'Moment of inertia, in kg·m². Must be positive.',
      damping:
        'Viscous friction coefficient to the housing, in N·m·s. Zero or positive.',
    },
    equations: [
      'a.phi = b.phi = φ',
      'ω = dφ/dt',
      'J · dω/dt = a.tau + b.tau − damping · ω',
    ],
    limitations: [
      'The body starts at rest at φ = 0; these initial conditions are fixed. Rigidly connecting it to another block that fixes its own initial angle or speed (another Inertia & load, a Speed source) over-determines the initial conditions.',
      'Friction is purely viscous; there is no Coulomb friction or stiction.',
    ],
    tips: [
      'For a lossless inertia without fixed initial conditions, use Inertia (ideal).',
    ],
    seeAlso: ['rotInertia', 'shaftLoad', 'rotDamper', 'motor', 'sensor'],
  },

  rotInertia: {
    description: [
      'An ideal rotating mass with two flanges and no losses. Both flanges share the angle of the body. Use it for rotors, flywheels, and wheels, and add damping or friction with separate blocks.',
    ],
    ports: {
      flange_a: 'Flange a. Torque into the flange is positive.',
      flange_b: 'Flange b, rigidly joined to flange_a.',
    },
    parameters: { J: 'Moment of inertia, in kg·m². Zero or positive.' },
    equations: [
      'flange_a.phi = flange_b.phi = φ',
      'ω = dφ/dt',
      'J · dω/dt = flange_a.tau + flange_b.tau',
    ],
    limitations: [
      'No friction or damping to the housing. Add Torsion damper to Fixed (rotational) for viscous losses.',
    ],
    seeAlso: ['inertia', 'rotDamper', 'rotSpring', 'idealGear', 'rotFixed'],
  },

  rotFixed: {
    description: [
      'Fixes a rotational flange to the housing at a constant angle. Use it as the reference for springs, dampers, and clutches that act against the housing.',
    ],
    ports: {
      flange:
        'Flange held at the fixed angle. It takes whatever reaction torque is needed.',
    },
    parameters: { phi0: 'The fixed angle, in radians.' },
    equations: ['flange.phi = phi0'],
    seeAlso: ['transFixed', 'rotSpring', 'rotDamper'],
  },

  springDamper: {
    description: [
      'A linear torsion spring and viscous damper in parallel between two shafts. Use it for a compliant coupling or a flexible shaft.',
    ],
    ports: {
      a: 'Flange a. Torque into the flange is positive.',
      b: 'Flange b. Receives the opposite torque: b.tau = −a.tau.',
    },
    parameters: {
      c: 'Torsional stiffness, in N·m/rad. Zero or positive.',
      d: 'Damping coefficient, in N·m·s. Zero or positive.',
    },
    equations: [
      'τ = c · (b.phi − a.phi) + d · (dφ_b/dt − dφ_a/dt)',
      'b.tau = τ, a.tau = −τ',
    ],
    limitations: [
      'The spring is unstretched when both flanges are at the same angle; there is no offset parameter.',
    ],
    tips: [
      'For an unstretched angle other than zero, use Torsion spring and Torsion damper in parallel.',
    ],
    seeAlso: ['rotSpring', 'rotDamper', 'rotBacklash', 'transSpringDamper'],
  },

  rotSpring: {
    description: [
      'A linear torsion spring between two flanges. Connect it between two inertias to model shaft elasticity, or between an inertia and Fixed (rotational) to model a return spring.',
    ],
    ports: {
      flange_a: 'Flange a. Receives −τ.',
      flange_b: 'Flange b. Receives τ, the spring torque.',
    },
    parameters: {
      c: 'Torsional stiffness, in N·m/rad. Zero or positive.',
      phi_rel0:
        'Relative angle at which the spring exerts no torque, in radians.',
    },
    equations: [
      'φ_rel = flange_b.phi − flange_a.phi',
      'τ = c · (φ_rel − phi_rel0)',
      'flange_b.tau = τ, flange_a.tau = −τ',
    ],
    limitations: [
      'No damping and no mass. A stiff spring between two inertias makes the model stiff; add a little damping in parallel.',
    ],
    seeAlso: ['rotDamper', 'springDamper', 'rotBacklash', 'transSpring'],
  },

  rotDamper: {
    description: [
      'A linear viscous damper between two flanges: the torque is proportional to the relative speed. Connect it to Fixed (rotational) for friction to the housing.',
    ],
    ports: {
      flange_a: 'Flange a. Receives −τ.',
      flange_b: 'Flange b. Receives τ, the damping torque.',
    },
    parameters: { d: 'Damping coefficient, in N·m·s/rad. Zero or positive.' },
    equations: [
      'ω_rel = d(flange_b.phi − flange_a.phi)/dt',
      'τ = d · ω_rel',
      'flange_b.tau = τ, flange_a.tau = −τ',
    ],
    limitations: ['Purely viscous: no Coulomb friction or stiction.'],
    seeAlso: ['rotSpring', 'springDamper', 'clutch', 'transDamper'],
  },

  rotBacklash: {
    description: [
      'A free play of b in series with a parallel spring and damper. Within the play no torque is transmitted; outside it the flanges are in contact through the spring and damper. Combine it with Ideal gear to model a gearbox with backlash.',
      'The contact torque only pushes: it is set to zero when the damper would pull the flanges together, and the damping torque is limited to the spring torque, so the torque is continuous at the start of contact.',
    ],
    ports: {
      flange_a: 'Flange a. Receives −τ.',
      flange_b: 'Flange b. Receives τ, the contact torque.',
    },
    parameters: {
      b: 'Total backlash (full width of the free play), in radians. The play spans ±b/2 around zero relative angle.',
      c: 'Contact stiffness, in N·m/rad. Must be greater than zero.',
      d: 'Contact damping, in N·m·s/rad. Zero or positive.',
    },
    equations: [
      'φ_rel = flange_b.phi − flange_a.phi, ω_rel = dφ_rel/dt',
      '|φ_rel| ≤ b/2: τ = 0',
      'φ_rel > b/2: τ_c = c · (φ_rel − b/2), τ = τ_c + min(τ_c, d · ω_rel), or 0 if τ_c + d · ω_rel ≤ 0',
      'φ_rel < −b/2: τ_c = c · (φ_rel + b/2), τ = τ_c + max(τ_c, d · ω_rel), or 0 if τ_c + d · ω_rel ≥ 0',
      'flange_b.tau = τ, flange_a.tau = −τ',
    ],
    limitations: [
      'If b is below 1e-10 rad the play is ignored and the block is a plain spring and damper.',
      'During initialization the play is replaced by a linear characteristic of slope c/3 for |φ_rel| < 1.5 · b/2, so the initial state may differ slightly from the true contact state.',
      'Each contact change is a solver event; very small b with oscillating loads makes the run slow.',
    ],
    seeAlso: ['idealGear', 'rotSpring', 'springDamper', 'hardStop'],
  },

  idealGear: {
    description: [
      'A lossless gear fixed to the housing, with no inertia, elasticity, or backlash. Flange a turns ratio times as far as flange b, and the torque is scaled by the same factor, so power is conserved.',
    ],
    ports: {
      flange_a: 'Input side flange. Angle φ_a = ratio · φ_b.',
      flange_b: 'Output side flange.',
    },
    parameters: {
      ratio:
        'Transmission ratio φ_a/φ_b. A value above 1 reduces speed and raises torque at flange_b; a negative value reverses direction.',
    },
    equations: [
      'flange_a.phi = ratio · flange_b.phi',
      '0 = ratio · flange_a.tau + flange_b.tau',
    ],
    limitations: [
      'No friction, efficiency loss, backlash, or tooth stiffness. Add Backlash or Torsion spring on either side for those effects.',
    ],
    tips: ['An inertia J behind the gear appears as J/ratio² at flange_a.'],
    seeAlso: ['rotBacklash', 'gearR2T', 'rollingWheel', 'rotInertia'],
  },

  clutch: {
    description: [
      'A friction clutch between two flanges, pressed together by a normal force set through the fn input. While slipping it transmits a friction torque proportional to the normal force; once the relative speed reaches zero the flanges lock until the transmitted torque exceeds the static limit.',
      'The sliding friction coefficient is fixed at μ = 0.5 for all slip speeds. Stuck and sliding phases are switched by solver events.',
    ],
    ports: {
      f_normalized:
        'Normalized normal force, nominally 0 to 1; fn = fn_max · f_normalized. At zero or below, the clutch is open and transmits no torque.',
      flange_a: 'Flange a. Receives −τ.',
      flange_b: 'Flange b. Receives τ, the friction torque.',
    },
    parameters: {
      fn_max: 'Normal force at f_normalized = 1, in newtons. Zero or positive.',
      cgeo: 'Geometry constant, in meters, converting force times friction coefficient into torque. For N friction interfaces with inner and outer radii rᵢ and rₒ, cgeo = N · (rₒ + rᵢ)/2.',
      peak: 'Ratio of the maximum static torque to the sliding torque at zero slip. At least 1.',
    },
    equations: [
      'fn = fn_max · f_normalized',
      'ω_rel = d(flange_b.phi − flange_a.phi)/dt',
      'Sliding (ω_rel ≠ 0): τ = sign(ω_rel) · μ · cgeo · fn, with μ = 0.5',
      'Stuck (ω_rel = 0): τ follows from the torque balance while |τ| ≤ peak · μ · cgeo · fn',
      'Open (fn ≤ 0): τ = 0',
      'flange_b.tau = τ, flange_a.tau = −τ',
    ],
    limitations: [
      'The friction coefficient cannot be changed and does not vary with slip speed or temperature.',
      'f_normalized is not limited; values above 1 give more than fn_max.',
      'Rigid when stuck: no torsional compliance in the plates.',
    ],
    tips: [
      'Drive fn from a Ramp or a rate-limited signal for a smooth engagement.',
    ],
    seeAlso: ['rotDamper', 'rotInertia', 'massStops', 'ramp'],
  },

  rollingWheel: {
    description: [
      'An ideal wheel that rolls without slip: it converts the rotation of the axle into translation of the contact point. Use it to connect a rotational drivetrain to a vehicle mass.',
    ],
    ports: {
      flangeR: 'Rotational flange (the axle). Torque into it is positive.',
      flangeT:
        'Translational flange (the road contact). Force into it is positive.',
    },
    parameters: { radius: 'Wheel radius, in meters. Must be positive.' },
    equations: [
      'flangeT.s = radius · flangeR.phi',
      '0 = radius · flangeT.f + flangeR.tau',
    ],
    limitations: [
      'No wheel inertia, rolling resistance, or tire slip. Add Inertia (ideal) on the axle for the wheel’s own inertia.',
    ],
    seeAlso: ['gearR2T', 'mass', 'rotInertia', 'idealGear'],
  },

  gearR2T: {
    description: [
      'An ideal rack and pinion, or any ideal rotary-to-linear transmission. The rotational flange turns ratio radians per meter of travel of the translational flange.',
    ],
    ports: {
      flangeR: 'Rotational flange (the pinion). Torque into it is positive.',
      flangeT: 'Translational flange (the rack). Force into it is positive.',
    },
    parameters: {
      ratio:
        'Transmission ratio flangeR.phi/flangeT.s, in rad/m. For a pinion of radius r, ratio = 1/r. A negative value reverses direction.',
    },
    equations: [
      'flangeR.phi = ratio · flangeT.s',
      '0 = ratio · flangeR.tau + flangeT.f',
    ],
    limitations: ['No mass, inertia, friction, backlash, or elasticity.'],
    seeAlso: ['rollingWheel', 'idealGear', 'mass'],
  },

  // ── Rotational: sources ─────────────────────────────────────────────────────────────

  torqueSource: {
    description: [
      'Applies the input signal as a torque to the flange, reacting against the housing. Use it for an actuator whose torque is computed by a controller or a signal source.',
    ],
    ports: {
      tau: 'Torque to apply, in N·m. A positive value accelerates the flange in the positive direction.',
      flange: 'Flange the torque acts on.',
    },
    equations: ['flange.tau = −tau'],
    limitations: [
      'The reaction torque goes to the housing; there is no support flange.',
    ],
    seeAlso: ['constantTorque', 'torqueStep', 'speedSource', 'forceSource'],
  },

  constantTorque: {
    description: [
      'Applies a constant torque to the flange, independent of speed and direction.',
    ],
    ports: { flange: 'Flange the torque acts on.' },
    parameters: {
      tau_constant:
        'The torque, in N·m. A positive value accelerates the flange in the positive direction; a negative value acts as a load.',
    },
    equations: ['flange.tau = −tau_constant'],
    limitations: [
      'The torque does not reverse with speed: a negative value used as a load drives an unpowered shaft backward instead of holding it.',
    ],
    seeAlso: ['torqueStep', 'torqueSource', 'constantForce'],
  },

  torqueStep: {
    description: [
      'Applies an offset torque that steps up by a fixed amount at the step time. Use it as a load disturbance.',
    ],
    ports: { flange: 'Flange the torque acts on.' },
    parameters: {
      stepTorque: 'Height of the step, in N·m. Negative values act as a load.',
      offsetTorque: 'Torque before the step, in N·m.',
      startTime: 'Time of the step, in seconds.',
    },
    equations: [
      'τ = offsetTorque + (0 for time < startTime, stepTorque afterward)',
      'flange.tau = −τ',
    ],
    limitations: [
      'The step is instantaneous and does not depend on speed or direction.',
    ],
    seeAlso: ['constantTorque', 'torqueSource', 'shaftLoad', 'forceStep'],
  },

  speedSource: {
    description: [
      'Forces the flange to follow a reference speed, supplying whatever torque that takes. The reference is passed through a first-order filter with critical frequency f_crit, so a step in w_ref gives a finite acceleration.',
    ],
    ports: {
      w_ref: 'Reference angular velocity, in rad/s.',
      flange: 'Driven flange.',
    },
    parameters: {
      f_crit:
        'Corner frequency of the reference filter, in Hz. Must be positive; at 0 the speed never changes.',
    },
    equations: [
      'ω = d(flange.phi)/dt',
      'dω/dt = 2π · f_crit · (w_ref − ω)',
      'Initial: flange.phi = 0, ω = w_ref',
    ],
    limitations: [
      'The initial angle is fixed at 0 and the initial speed at w_ref; do not also fix the initial state of an inertia rigidly attached to the flange.',
      'Torque is unlimited: the source is ideal.',
    ],
    tips: [
      'Raise f_crit for closer tracking; a very high value makes the model stiff.',
    ],
    seeAlso: ['constantSpeed', 'torqueSource', 'transSpeedSource'],
  },

  constantSpeed: {
    description: [
      'Holds the flange at a constant angular velocity, independent of the torque needed.',
    ],
    ports: { flange: 'Driven flange.' },
    parameters: { w_fixed: 'The angular velocity, in rad/s.' },
    equations: ['d(flange.phi)/dt = w_fixed'],
    limitations: [
      'The speed is imposed from the first instant, so any inertia rigidly attached to the flange cannot have its own initial speed.',
    ],
    seeAlso: ['speedSource', 'constantTorque'],
  },

  // ── Rotational: sensors ─────────────────────────────────────────────────────────────

  sensor: {
    description: [
      'Measures the absolute angular velocity of the flange without loading it.',
    ],
    ports: {
      flange: 'Measured flange. No torque is exchanged.',
      y: 'Angular velocity, in rad/s.',
    },
    equations: ['y = d(flange.phi)/dt', 'flange.tau = 0'],
    limitations: ['Ideal: no noise, delay, or resolution limit.'],
    seeAlso: ['rotSpeedSensor', 'angleSensor', 'relSpeedSensor'],
  },

  rotSpeedSensor: {
    description: [
      'Measures the absolute angular velocity of the flange without loading it.',
    ],
    ports: {
      flange: 'Measured flange. No torque is exchanged.',
      w: 'Angular velocity, in rad/s.',
    },
    equations: ['w = d(flange.phi)/dt', 'flange.tau = 0'],
    limitations: ['Ideal: no noise, delay, or resolution limit.'],
    seeAlso: ['sensor', 'rotAccSensor', 'relSpeedSensor', 'angleSensor'],
  },

  angleSensor: {
    description: [
      'Measures the absolute angle of the flange, in radians, without loading it. Use it for position feedback in a servo loop.',
    ],
    ports: {
      flange: 'Measured flange. No torque is exchanged.',
      y: 'Absolute angle, in radians. It is not wrapped to one revolution.',
    },
    equations: ['y = flange.phi', 'flange.tau = 0'],
    limitations: [
      'Ideal: no quantization, noise, or delay, unlike a real encoder.',
    ],
    seeAlso: ['sensor', 'rotSpeedSensor', 'resolver', 'positionSensor'],
  },

  rotAccSensor: {
    description: [
      'Measures the absolute angular acceleration of the flange without loading it.',
    ],
    ports: {
      flange: 'Measured flange. No torque is exchanged.',
      a: 'Angular acceleration, in rad/s².',
    },
    equations: ['a = d²(flange.phi)/dt²', 'flange.tau = 0'],
    limitations: [
      'The angle is differentiated twice, so the output jumps wherever the applied torque jumps.',
    ],
    seeAlso: ['rotSpeedSensor', 'transAccSensor'],
  },

  torqueSensor: {
    description: [
      'Measures the torque transmitted through it, from flange a to flange b. The two flanges are rigidly joined, so the sensor adds no stiffness or inertia.',
    ],
    ports: {
      a: 'Flange a.',
      b: 'Flange b, at the same angle as a.',
      y: 'Torque at flange a, in N·m. Positive when torque flows into the sensor at a.',
    },
    equations: ['a.phi = b.phi', 'a.tau + b.tau = 0', 'y = a.tau'],
    limitations: ['Ideal: no compliance, noise, or bandwidth limit.'],
    seeAlso: ['rotPowerSensor', 'forceSensor', 'relSpeedSensor'],
  },

  rotPowerSensor: {
    description: [
      'Measures the mechanical power passing through it, from flange a to flange b. The flanges are rigidly joined.',
    ],
    ports: {
      power:
        'Power, in watts. Positive when power flows in at flange_a and out at flange_b.',
      flange_a: 'Flange a.',
      flange_b: 'Flange b, at the same angle as flange_a.',
    },
    equations: [
      'flange_a.phi = flange_b.phi',
      'flange_a.tau + flange_b.tau = 0',
      'power = flange_a.tau · d(flange_a.phi)/dt',
    ],
    seeAlso: ['torqueSensor', 'rotSpeedSensor', 'powerSensor'],
  },

  relSpeedSensor: {
    description: [
      'Measures the angular velocity of flange b relative to flange a, without transmitting torque. Use it to monitor slip across a clutch or twist rate across a spring.',
    ],
    ports: {
      w_rel: 'Relative angular velocity, in rad/s.',
      flange_a: 'Reference flange. No torque is exchanged.',
      flange_b: 'Measured flange. No torque is exchanged.',
    },
    equations: [
      'w_rel = d(flange_b.phi − flange_a.phi)/dt',
      'flange_a.tau = flange_b.tau = 0',
    ],
    seeAlso: ['rotSpeedSensor', 'torqueSensor', 'clutch'],
  },

  // ── Translational: components ───────────────────────────────────────────────────────

  transFixed: {
    description: [
      'Fixes a translational flange at a constant position. Use it as the wall or frame that springs, dampers, and stops push against.',
    ],
    ports: {
      flange:
        'Flange held at the fixed position. It takes whatever reaction force is needed.',
    },
    parameters: { s0: 'The fixed position, in meters.' },
    equations: ['flange.s = s0'],
    seeAlso: ['rotFixed', 'transSpring', 'transDamper'],
  },

  mass: {
    description: [
      'A sliding point mass with two flanges, both at the position of the mass. It has no friction; add a Damper to Fixed (translational) for viscous losses.',
    ],
    ports: {
      flange_a: 'Flange a. Force into the flange is positive.',
      flange_b: 'Flange b, at the same position as flange_a.',
    },
    parameters: { m: 'Mass, in kilograms. Zero or positive.' },
    equations: [
      'flange_a.s = flange_b.s = s',
      'v = ds/dt',
      'm · dv/dt = flange_a.f + flange_b.f',
    ],
    limitations: [
      'No friction, no end stops, and no length (both flanges at one point). For stops and friction, use Mass with stops.',
    ],
    seeAlso: ['massStops', 'transDamper', 'transSpring', 'rollingWheel'],
  },

  transSpring: {
    description: ['A linear spring between two translational flanges.'],
    ports: {
      flange_a: 'Flange a. Receives −f.',
      flange_b: 'Flange b. Receives f, the spring force.',
    },
    parameters: {
      c: 'Stiffness, in N/m. Zero or positive.',
      s_rel0:
        'Unstretched length (relative position at which the force is zero), in meters.',
    },
    equations: [
      's_rel = flange_b.s − flange_a.s',
      'f = c · (s_rel − s_rel0)',
      'flange_b.f = f, flange_a.f = −f',
    ],
    limitations: ['No damping and no mass.'],
    seeAlso: ['transDamper', 'transSpringDamper', 'hardStop', 'rotSpring'],
  },

  transDamper: {
    description: [
      'A linear viscous damper between two translational flanges: the force is proportional to the relative velocity. Connect it to Fixed (translational) for drag against the frame.',
    ],
    ports: {
      flange_a: 'Flange a. Receives −f.',
      flange_b: 'Flange b. Receives f, the damping force.',
    },
    parameters: { d: 'Damping coefficient, in N·s/m. Zero or positive.' },
    equations: [
      'v_rel = d(flange_b.s − flange_a.s)/dt',
      'f = d · v_rel',
      'flange_b.f = f, flange_a.f = −f',
    ],
    limitations: ['Purely viscous: no Coulomb friction or stiction.'],
    seeAlso: ['transSpring', 'transSpringDamper', 'massStops', 'rotDamper'],
  },

  transSpringDamper: {
    description: [
      'A linear spring and viscous damper in parallel between two translational flanges. Use it for a suspension or a compliant mount.',
    ],
    ports: {
      flange_a: 'Flange a. Receives −f.',
      flange_b: 'Flange b. Receives f.',
    },
    parameters: {
      c: 'Stiffness, in N/m. Zero or positive.',
      d: 'Damping coefficient, in N·s/m. Zero or positive.',
      s_rel0: 'Unstretched length, in meters.',
    },
    equations: [
      's_rel = flange_b.s − flange_a.s, v_rel = ds_rel/dt',
      'f = c · (s_rel − s_rel0) + d · v_rel',
      'flange_b.f = f, flange_a.f = −f',
    ],
    seeAlso: ['transSpring', 'transDamper', 'hardStop', 'springDamper'],
  },

  hardStop: {
    description: [
      'A spring and damper that act only in contact. Contact occurs when the distance flange_b.s − flange_a.s falls below s_rel0; above it the block exerts no force.',
      'The contact force only pushes the flanges apart. The damping part is limited to the size of the spring part, so the force starts from zero at first contact and never pulls.',
    ],
    ports: {
      flange_a: 'Flange a. Receives −f.',
      flange_b: 'Flange b. Receives f, which is zero or negative (pushing).',
    },
    parameters: {
      c: 'Contact stiffness, in N/m. Zero or positive.',
      d: 'Contact damping, in N·s/m. Zero or positive.',
      s_rel0:
        'Relative position at which contact begins, in meters. This is a free length, not a gap measured from the current position.',
    },
    equations: [
      's_rel = flange_b.s − flange_a.s, v_rel = ds_rel/dt',
      'Contact when s_rel < s_rel0:',
      'f_c = c · (s_rel − s_rel0), f = f_c + min(max(d · v_rel, f_c), −f_c)',
      'No contact: f = 0',
      'flange_b.f = f, flange_a.f = −f',
    ],
    limitations: [
      'If both flanges start at the same position, s_rel = 0, which is inside the contact region for any positive s_rel0: the stop starts compressed by s_rel0. Set initial positions accordingly.',
      'Initialization can fail if a steady force pushes the flanges apart and nothing else balances it.',
    ],
    seeAlso: ['massStops', 'transSpringDamper', 'rotBacklash'],
  },

  massStops: {
    description: [
      'A sliding mass with viscous, Coulomb, and Stribeck friction against the frame, limited to travel between two hard stops. The mass sticks at zero speed until the net force exceeds the breakaway force.',
      'Reaching a stop is fully inelastic: the position is clamped to the stop and the velocity is reset to zero.',
    ],
    ports: {
      flange_a: 'Flange a. Force into the flange is positive.',
      flange_b: 'Flange b, at the same position as flange_a.',
    },
    parameters: {
      m: 'Mass, in kilograms. Zero or positive.',
      smax: 'Upper stop position, in meters. Must be greater than smin.',
      smin: 'Lower stop position, in meters.',
      F_prop: 'Viscous friction coefficient, in N·s/m. Zero or positive.',
      F_Coulomb:
        'Constant (Coulomb) friction force while sliding, in newtons. Zero or positive.',
      F_Stribeck:
        'Extra friction force at low speed, decaying with speed, in newtons. Zero or positive.',
      fexp: 'Decay rate of the Stribeck term, in s/m. Zero or positive.',
    },
    equations: [
      'm · dv/dt = flange_a.f + flange_b.f − f, with v = ds/dt',
      'Sliding forward: f = F_prop · v + F_Coulomb + F_Stribeck · e^(−fexp·|v|)',
      'Sliding backward: f = F_prop · v − F_Coulomb − F_Stribeck · e^(−fexp·|v|)',
      'Stuck (v = 0): |f| ≤ 1.001 · (F_Coulomb + F_Stribeck); f follows from the force balance',
      'At s = smin or s = smax: s is held at the stop and v is reset to 0',
    ],
    limitations: [
      'The mass is a point; both flanges share its position.',
      'Impacts at the stops lose all kinetic energy; there is no bounce. For an elastic stop, use Mass with Hard stop.',
      'Initialization fails if the starting position lies outside smin…smax.',
    ],
    seeAlso: ['mass', 'hardStop', 'transDamper', 'clutch'],
  },

  // ── Translational: sources ──────────────────────────────────────────────────────────

  forceSource: {
    description: [
      'Applies the input signal as a force to the flange, reacting against the frame.',
    ],
    ports: {
      f: 'Force to apply, in newtons. A positive value accelerates the flange in the positive direction.',
      flange: 'Flange the force acts on.',
    },
    equations: ['flange.f = −f'],
    seeAlso: ['constantForce', 'forceStep', 'transSpeedSource', 'torqueSource'],
  },

  constantForce: {
    description: [
      'Applies a constant force to the flange, independent of speed and direction. Use it for gravity on a vertical axis or a constant load.',
    ],
    ports: { flange: 'Flange the force acts on.' },
    parameters: {
      f_constant:
        'The force, in newtons. Positive accelerates the flange in the positive direction; negative acts as a load.',
    },
    equations: ['flange.f = −f_constant'],
    tips: [
      'For gravity on a mass m with positive direction upward, set f_constant = −9.81 · m.',
    ],
    seeAlso: ['forceStep', 'forceSource', 'constantTorque'],
  },

  forceStep: {
    description: [
      'Applies an offset force that steps up by a fixed amount at the step time.',
    ],
    ports: { flange: 'Flange the force acts on.' },
    parameters: {
      stepForce:
        'Height of the step, in newtons. Negative values act as a load.',
      offsetForce: 'Force before the step, in newtons.',
      startTime: 'Time of the step, in seconds.',
    },
    equations: [
      'F = offsetForce + (0 for time < startTime, stepForce afterward)',
      'flange.f = −F',
    ],
    seeAlso: ['constantForce', 'forceSource', 'torqueStep'],
  },

  transSpeedSource: {
    description: [
      'Forces the flange to follow a reference velocity, supplying whatever force that takes. The reference passes through a first-order filter with critical frequency f_crit.',
    ],
    ports: {
      v_ref: 'Reference velocity, in m/s.',
      flange: 'Driven flange.',
    },
    parameters: {
      f_crit:
        'Corner frequency of the reference filter, in Hz. Must be positive; at 0 the velocity never changes.',
    },
    equations: [
      'v = d(flange.s)/dt',
      'dv/dt = 2π · f_crit · (v_ref − v)',
      'Initial: flange.s = 0, v = v_ref',
    ],
    limitations: [
      'The initial position is fixed at 0 and the initial velocity at v_ref. Force is unlimited.',
    ],
    seeAlso: ['positionSource', 'forceSource', 'speedSource'],
  },

  positionSource: {
    description: [
      'Forces the flange to follow a reference position, supplying whatever force that takes. The reference passes through a second-order critically damped (Bessel) filter with critical frequency f_crit, so the flange has continuous velocity even for a step in s_ref.',
    ],
    ports: {
      s_ref: 'Reference position, in meters.',
      flange: 'Driven flange.',
    },
    parameters: {
      f_crit:
        'Critical frequency of the reference filter, in Hz. Must be positive.',
    },
    equations: [
      'ω_c = 2π · f_crit',
      'd²s/dt² = (ω_c · (s_ref − s) − 1.3617 · ds/dt) · ω_c/0.6180, with s = flange.s',
      'Initial: flange.s = s_ref',
    ],
    limitations: ['Force is unlimited: the source is ideal.'],
    seeAlso: ['transSpeedSource', 'positionSensor', 'forceSource'],
  },

  // ── Translational: sensors ──────────────────────────────────────────────────────────

  positionSensor: {
    description: [
      'Measures the absolute position of the flange without loading it.',
    ],
    ports: {
      flange: 'Measured flange. No force is exchanged.',
      s: 'Position, in meters.',
    },
    equations: ['s = flange.s', 'flange.f = 0'],
    seeAlso: ['velocitySensor', 'relPositionSensor', 'angleSensor'],
  },

  velocitySensor: {
    description: [
      'Measures the absolute velocity of the flange without loading it.',
    ],
    ports: {
      flange: 'Measured flange. No force is exchanged.',
      v: 'Velocity, in m/s.',
    },
    equations: ['v = d(flange.s)/dt', 'flange.f = 0'],
    seeAlso: ['positionSensor', 'transAccSensor', 'rotSpeedSensor'],
  },

  transAccSensor: {
    description: [
      'Measures the absolute acceleration of the flange without loading it.',
    ],
    ports: {
      flange: 'Measured flange. No force is exchanged.',
      a: 'Acceleration, in m/s².',
    },
    equations: ['a = d²(flange.s)/dt²', 'flange.f = 0'],
    limitations: [
      'The position is differentiated twice, so the output jumps wherever the applied force jumps.',
    ],
    seeAlso: ['velocitySensor', 'rotAccSensor'],
  },

  forceSensor: {
    description: [
      'Measures the force transmitted through it, from flange a to flange b. The two flanges are rigidly joined.',
    ],
    ports: {
      f: 'Force at flange_a, in newtons. Positive when force acts into the sensor at flange_a.',
      flange_a: 'Flange a.',
      flange_b: 'Flange b, at the same position as flange_a.',
    },
    equations: [
      'flange_a.s = flange_b.s',
      'flange_a.f + flange_b.f = 0',
      'f = flange_a.f',
    ],
    seeAlso: ['torqueSensor', 'relPositionSensor'],
  },

  relPositionSensor: {
    description: [
      'Measures the position of flange b relative to flange a, without transmitting force. Use it to monitor the stretch of a spring or the clearance at a stop.',
    ],
    ports: {
      s_rel: 'Relative position flange_b.s − flange_a.s, in meters.',
      flange_a: 'Reference flange. No force is exchanged.',
      flange_b: 'Measured flange. No force is exchanged.',
    },
    equations: [
      's_rel = flange_b.s − flange_a.s',
      'flange_a.f = flange_b.f = 0',
    ],
    seeAlso: ['positionSensor', 'forceSensor', 'hardStop'],
  },
};
