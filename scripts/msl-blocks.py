#!/usr/bin/env python3
"""Generate lib/gradara/msl-blocks.ts: library blocks that wrap Modelica Standard Library classes.

Each entry below names an MSL 4.1.0 class, the block's parameters (each maps to
the MSL parameter of the same name unless `modifier` says otherwise), and how its
terminals are laid out. Terminal domains and directions come from
server/msl_index.json, so they always match the class. The script fails on any
class, parameter, or connector that is not in the index.

    python3 scripts/msl-blocks.py > lib/gradara/msl-blocks.ts
"""
from __future__ import annotations

import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
INDEX = json.loads((ROOT/'server'/'msl_index.json').read_text(encoding='utf-8'))['classes']

ANALOG = 'Modelica.Electrical.Analog'
ROT = 'Modelica.Mechanics.Rotational'
TRANS = 'Modelica.Mechanics.Translational'
HEAT = 'Modelica.Thermal.HeatTransfer'
MAG = 'Modelica.Magnetic.FluxTubes'
POLY = 'Modelica.Electrical.Polyphase'
PC = 'Modelica.Electrical.PowerConverters'
MACH = 'Modelica.Electrical.Machines'
BLK = 'Modelica.Blocks'

CAPTIONS = {'p': '+', 'n': '−', 'flange_a': 'a', 'flange_b': 'b', 'port_a': 'a', 'port_b': 'b', 'port_p': '+',
            'port_n': '−', 'plug_p': '+', 'plug_n': '−', 'heatPort': 'heat', 'flange': 'shaft', 'support': 'sup'}


def P(id, name, value, unit='', min=None, modifier=None, max=None):
    return dict(id=id, name=name, value=value, unit=unit, min=min, max=max, modifier=modifier)


BLOCKS: list[dict] = []


def B(kind, name, cls, symbol, category, description, params=(), *, sides=None, names=None, ports=None,
      exclude=(), include=(), modifiers=None, keywords=(), domain=None, equations=''):
    BLOCKS.append(dict(kind=kind, name=name, cls=cls, symbol=symbol, category=category, description=description,
                       params=list(params), sides=sides or {}, names=names or {}, ports=ports, exclude=set(exclude),
                       include=set(include), modifiers=modifiers or {}, keywords=list(keywords), domain=domain,
                       equations=equations))


# ----------------------------------------------------------------- rotational
B('rotFixed', 'Fixed (rotational)', f'{ROT}.Components.Fixed', '⏚', 'mechanical',
  'A flange fixed in the housing at a constant angle.', [P('phi0', 'Angle', 0, 'rad', modifier='phi0')],
  sides={'flange': 'top'}, keywords=['ground', 'reference', 'housing'])
B('rotSpring', 'Torsion spring', f'{ROT}.Components.Spring', 'c', 'mechanical',
  'Linear torsion spring: τ = c·(φ_rel − φ_rel0).', [P('c', 'Stiffness', 1e4, 'N·m/rad', 0), P('phi_rel0', 'Unstretched angle', 0, 'rad')],
  keywords=['stiffness', 'shaft', 'compliance'])
B('rotDamper', 'Torsion damper', f'{ROT}.Components.Damper', 'd', 'mechanical',
  'Linear rotational damper: τ = d·ω_rel.', [P('d', 'Damping', 1, 'N·m·s/rad', 0)], keywords=['viscous', 'friction'])
B('rotBacklash', 'Backlash', f'{ROT}.Components.ElastoBacklash', 'b', 'mechanical',
  'Spring and damper in series with a free play of b.',
  [P('b', 'Total backlash', 0.01, 'rad', 0), P('c', 'Stiffness', 1e5, 'N·m/rad', 0), P('d', 'Damping', 10, 'N·m·s/rad', 0)],
  keywords=['gap', 'play', 'gear'])
B('rotInertia', 'Inertia (ideal)', f'{ROT}.Components.Inertia', 'J', 'mechanical',
  'Rotating mass with two flanges and no losses.', [P('J', 'Inertia', 0.01, 'kg·m²', 0)], keywords=['mass', 'flywheel', 'rotor'])
B('idealGear', 'Ideal gear', f'{ROT}.Components.IdealGear', 'i', 'mechanical',
  'Lossless gear: φ_a = ratio·φ_b.', [P('ratio', 'Ratio', 2, '')], keywords=['gearbox', 'transmission', 'reduction'])
B('clutch', 'Clutch', f'{ROT}.Components.Clutch', 'clutch', 'mechanical',
  'Friction clutch; the normalized normal force f_n (0…1) engages it.',
  [P('fn_max', 'Maximum normal force', 1000, 'N', 0), P('cgeo', 'Geometry constant', 1, ''), P('peak', 'Stiction peak', 1.1, '', 1)],
  names={'f_normalized': 'fn'}, sides={'f_normalized': 'top'}, keywords=['friction', 'engage', 'coupling'])
B('rollingWheel', 'Rolling wheel', f'{ROT}.Components.IdealRollingWheel', 'wheel', 'mechanical',
  'Converts rotation to translation without slip: v = r·ω.', [P('radius', 'Radius', 0.3, 'm', 0)],
  names={'flangeR': 'rot', 'flangeT': 'lin'}, sides={'flangeR': 'left', 'flangeT': 'right'},
  keywords=['vehicle', 'tire', 'rack'])
B('gearR2T', 'Rack and pinion', f'{ROT}.Components.IdealGearR2T', 'R→T', 'mechanical',
  'Ideal rack and pinion: rotation to translation by a fixed ratio.', [P('ratio', 'Ratio', 100, 'rad/m')],
  names={'flangeR': 'rot', 'flangeT': 'lin'}, sides={'flangeR': 'left', 'flangeT': 'right'}, keywords=['pinion', 'linear'])
B('torqueSource', 'Torque source', f'{ROT}.Sources.Torque', 'τ', 'mechanical',
  'Applies the input signal as torque to the flange.', names={'tau': 'τ'}, sides={'tau': 'left', 'flange': 'right'},
  keywords=['actuator', 'drive', 'load'])
B('constantTorque', 'Constant torque', f'{ROT}.Sources.ConstantTorque', 'τ₀', 'mechanical',
  'A constant torque, independent of speed.', [P('tau_constant', 'Torque', 1, 'N·m')], sides={'flange': 'right'},
  keywords=['load'])
B('torqueStep', 'Torque step', f'{ROT}.Sources.TorqueStep', 'τ step', 'mechanical',
  'A torque step at a given time.', [P('stepTorque', 'Step', 1, 'N·m'), P('offsetTorque', 'Offset', 0, 'N·m'), P('startTime', 'Step time', 0.5, 's', 0)],
  sides={'flange': 'right'}, keywords=['load', 'disturbance'])
B('speedSource', 'Speed source', f'{ROT}.Sources.Speed', 'ω', 'mechanical',
  'Forces the flange to follow the input speed, filtered by a critical frequency.',
  [P('f_crit', 'Filter frequency', 50, 'Hz', 0)], modifiers={'exact': 'false'}, names={'w_ref': 'ω'},
  sides={'w_ref': 'left', 'flange': 'right'}, keywords=['drive', 'prescribed'])
B('constantSpeed', 'Constant speed', f'{ROT}.Sources.ConstantSpeed', 'ω₀', 'mechanical',
  'Holds the flange at a constant speed.', [P('w_fixed', 'Speed', 100, 'rad/s')], sides={'flange': 'right'})
B('rotSpeedSensor', 'Speed sensor (ideal)', f'{ROT}.Sensors.SpeedSensor', 'ω', 'mechanical',
  'Absolute angular velocity of the flange.', names={'w': 'ω'}, sides={'flange': 'left', 'w': 'right'}, keywords=['tachometer', 'rpm'])
B('rotAccSensor', 'Acceleration sensor', f'{ROT}.Sensors.AccSensor', 'α', 'mechanical',
  'Absolute angular acceleration of the flange.', names={'a': 'α'}, sides={'flange': 'left', 'a': 'right'})
B('rotPowerSensor', 'Power sensor (rotational)', f'{ROT}.Sensors.PowerSensor', 'P', 'mechanical',
  'Power flowing from flange a to flange b.', names={'power': 'P'}, sides={'power': 'bottom'}, keywords=['watt'])
B('relSpeedSensor', 'Relative speed sensor', f'{ROT}.Sensors.RelSpeedSensor', 'Δω', 'mechanical',
  'Speed of flange b relative to flange a.', names={'w_rel': 'Δω'}, sides={'w_rel': 'bottom'})

# -------------------------------------------------------------- translational
B('transFixed', 'Fixed (translational)', f'{TRANS}.Components.Fixed', '⏚', 'translational',
  'A translational flange fixed at a constant position.', [P('s0', 'Position', 0, 'm')], sides={'flange': 'top'},
  keywords=['ground', 'wall', 'reference'])
B('mass', 'Mass', f'{TRANS}.Components.Mass', 'm', 'translational',
  'A sliding mass with two flanges: m·a = f_a + f_b.', [P('m', 'Mass', 1, 'kg', 0)], keywords=['inertia', 'body', 'load'])
B('transSpring', 'Spring', f'{TRANS}.Components.Spring', 'k', 'translational',
  'Linear spring: f = c·(s_rel − s_rel0).', [P('c', 'Stiffness', 1000, 'N/m', 0), P('s_rel0', 'Unstretched length', 0, 'm')],
  keywords=['stiffness', 'compliance'])
B('transDamper', 'Damper', f'{TRANS}.Components.Damper', 'b', 'translational',
  'Linear damper: f = d·v_rel.', [P('d', 'Damping', 10, 'N·s/m', 0)], keywords=['viscous', 'shock absorber'])
B('transSpringDamper', 'Spring-damper', f'{TRANS}.Components.SpringDamper', 'k,b', 'translational',
  'Spring and damper in parallel.', [P('c', 'Stiffness', 1000, 'N/m', 0), P('d', 'Damping', 10, 'N·s/m', 0), P('s_rel0', 'Unstretched length', 0, 'm')],
  keywords=['suspension'])
B('hardStop', 'Hard stop', f'{TRANS}.Components.ElastoGap', 'gap', 'translational',
  'Spring and damper that act only when the gap closes (contact).',
  [P('c', 'Contact stiffness', 1e6, 'N/m', 0), P('d', 'Contact damping', 100, 'N·s/m', 0), P('s_rel0', 'Gap', 0.01, 'm')],
  keywords=['contact', 'end stop', 'impact'])
B('massStops', 'Mass with stops', f'{TRANS}.Components.MassWithStopAndFriction', 'm⊣⊢', 'translational',
  'Mass with Coulomb and viscous friction and hard end stops.',
  [P('m', 'Mass', 1, 'kg', 0), P('smax', 'Upper stop', 0.5, 'm'), P('smin', 'Lower stop', -0.5, 'm'),
   P('F_prop', 'Viscous friction', 1, 'N·s/m', 0), P('F_Coulomb', 'Coulomb friction', 5, 'N', 0),
   P('F_Stribeck', 'Stribeck friction', 10, 'N', 0), P('fexp', 'Stribeck decay', 2, 's/m', 0)],
  keywords=['friction', 'stiction', 'limit'])
B('forceSource', 'Force source', f'{TRANS}.Sources.Force', 'F', 'translational',
  'Applies the input signal as force to the flange.', names={'f': 'F'}, sides={'f': 'left', 'flange': 'right'},
  keywords=['actuator'])
B('constantForce', 'Constant force', f'{TRANS}.Sources.ConstantForce', 'F₀', 'translational',
  'A constant force.', [P('f_constant', 'Force', 1, 'N')], sides={'flange': 'right'}, keywords=['gravity', 'load'])
B('forceStep', 'Force step', f'{TRANS}.Sources.ForceStep', 'F step', 'translational',
  'A force step at a given time.', [P('stepForce', 'Step', 1, 'N'), P('offsetForce', 'Offset', 0, 'N'), P('startTime', 'Step time', 0.5, 's', 0)],
  sides={'flange': 'right'})
B('transSpeedSource', 'Velocity source', f'{TRANS}.Sources.Speed', 'v', 'translational',
  'Forces the flange to follow the input velocity.', [P('f_crit', 'Filter frequency', 50, 'Hz', 0)],
  modifiers={'exact': 'false'}, names={'v_ref': 'v'}, sides={'v_ref': 'left', 'flange': 'right'})
B('positionSource', 'Position source', f'{TRANS}.Sources.Position', 's', 'translational',
  'Forces the flange to follow the input position.', [P('f_crit', 'Filter frequency', 50, 'Hz', 0)],
  modifiers={'exact': 'false'}, names={'s_ref': 's'}, sides={'s_ref': 'left', 'flange': 'right'})
B('positionSensor', 'Position sensor', f'{TRANS}.Sensors.PositionSensor', 's', 'translational',
  'Absolute position of the flange.', sides={'flange': 'left', 's': 'right'}, keywords=['displacement', 'encoder'])
B('velocitySensor', 'Velocity sensor', f'{TRANS}.Sensors.SpeedSensor', 'v', 'translational',
  'Absolute velocity of the flange.', sides={'flange': 'left', 'v': 'right'}, keywords=['speed'])
B('transAccSensor', 'Acceleration sensor (linear)', f'{TRANS}.Sensors.AccSensor', 'a', 'translational',
  'Absolute acceleration of the flange.', sides={'flange': 'left', 'a': 'right'}, keywords=['accelerometer'])
B('forceSensor', 'Force sensor', f'{TRANS}.Sensors.ForceSensor', 'F', 'translational',
  'Force transmitted from flange a to flange b.', names={'f': 'F'}, sides={'f': 'bottom'}, keywords=['load cell'])
B('relPositionSensor', 'Relative position sensor', f'{TRANS}.Sensors.RelPositionSensor', 'Δs', 'translational',
  'Distance between flanges a and b.', names={'s_rel': 'Δs'}, sides={'s_rel': 'bottom'})

# -------------------------------------------------------------------- thermal
B('heatCapacitor', 'Heat capacitor', f'{HEAT}.Components.HeatCapacitor', 'C', 'thermal',
  'Stores heat: C·dT/dt = Q_flow.', [P('C', 'Heat capacity', 1000, 'J/K', 0)], sides={'port': 'bottom'},
  names={'port': 'T'}, keywords=['thermal mass', 'lumped'])
B('thermalConductor', 'Thermal conductor', f'{HEAT}.Components.ThermalConductor', 'G', 'thermal',
  'Linear heat conduction: Q = G·ΔT.', [P('G', 'Conductance', 1, 'W/K', 0)], keywords=['conduction'])
B('thermalResistor', 'Thermal resistor', f'{HEAT}.Components.ThermalResistor', 'Rθ', 'thermal',
  'Linear thermal resistance: ΔT = R·Q.', [P('R', 'Resistance', 1, 'K/W', 0)], keywords=['heatsink', 'junction'])
B('convection', 'Convection', f'{HEAT}.Components.Convection', 'hA', 'thermal',
  'Convective heat transfer with the input conductance Gc.', names={'solid': 'solid', 'fluid': 'fluid', 'Gc': 'Gc'},
  sides={'solid': 'left', 'fluid': 'right', 'Gc': 'top'}, keywords=['cooling', 'air', 'fluid'])
B('radiation', 'Radiation', f'{HEAT}.Components.BodyRadiation', 'σT⁴', 'thermal',
  'Radiative exchange: Q = Gr·σ·(T_a⁴ − T_b⁴).', [P('Gr', 'Net radiation conductance', 0.01, 'm²', 0)], keywords=['emissivity'])
B('fixedTemperature', 'Fixed temperature', f'{HEAT}.Sources.FixedTemperature', 'T₀', 'thermal',
  'Holds its port at a constant temperature.', [P('T', 'Temperature', 293.15, 'K', 0)], sides={'port': 'right'},
  names={'port': 'T'}, keywords=['ambient', 'reference', 'boundary'])
B('prescribedTemperature', 'Temperature source', f'{HEAT}.Sources.PrescribedTemperature', 'T', 'thermal',
  'Holds its port at the input temperature (K).', names={'port': 'T', 'T': 'T'}, sides={'T': 'left', 'port': 'right'})
B('fixedHeatFlow', 'Fixed heat flow', f'{HEAT}.Sources.FixedHeatFlow', 'Q₀', 'thermal',
  'Injects a constant heat flow into its port.', [P('Q_flow', 'Heat flow', 10, 'W')], sides={'port': 'right'},
  names={'port': 'Q'}, keywords=['losses', 'heater', 'dissipation'])
B('prescribedHeatFlow', 'Heat flow source', f'{HEAT}.Sources.PrescribedHeatFlow', 'Q', 'thermal',
  'Injects the input heat flow (W) into its port.', names={'port': 'Q', 'Q_flow': 'Q'}, sides={'Q_flow': 'left', 'port': 'right'},
  keywords=['losses', 'heater'])
B('temperatureSensor', 'Temperature sensor', f'{HEAT}.Sensors.TemperatureSensor', 'T', 'thermal',
  'Absolute temperature of its port (K).', names={'port': 'T'}, sides={'port': 'left', 'T': 'right'}, keywords=['thermometer', 'ntc'])
B('heatFlowSensor', 'Heat flow sensor', f'{HEAT}.Sensors.HeatFlowSensor', 'Q', 'thermal',
  'Heat flow from port a to port b.', names={'Q_flow': 'Q'}, sides={'Q_flow': 'bottom'})
B('relTemperatureSensor', 'Temperature difference sensor', f'{HEAT}.Sensors.RelTemperatureSensor', 'ΔT', 'thermal',
  'Temperature difference between ports a and b.', names={'T_rel': 'ΔT'}, sides={'T_rel': 'bottom'})

# ------------------------------------------------------------------- magnetic
B('reluctance', 'Reluctance', f'{MAG}.Basic.ConstantReluctance', 'Rm', 'magnetic',
  'Constant magnetic reluctance: V_m = R_m·Φ.', [P('R_m', 'Reluctance', 1e6, 'A/Wb', 0)], keywords=['air gap', 'core'])
B('permeance', 'Permeance', f'{MAG}.Basic.ConstantPermeance', 'Gm', 'magnetic',
  'Constant magnetic permeance: Φ = G_m·V_m.', [P('G_m', 'Permeance', 1e-6, 'Wb/A', 0)])
B('variableReluctance', 'Variable reluctance', f'{MAG}.Basic.VariableReluctance', 'Rm(u)', 'magnetic',
  'Reluctance set by the input signal.', names={'R_m': 'Rm'}, sides={'R_m': 'top'})
B('winding', 'Winding', f'{MAG}.Basic.ElectroMagneticConverter', 'N', 'magnetic',
  'Couples an electrical winding of N turns to a magnetic circuit.', [P('N', 'Turns', 100, '', 1)],
  names={'p': '+', 'n': '−', 'port_p': 'm+', 'port_n': 'm−'},
  sides={'p': 'left', 'n': 'left', 'port_p': 'right', 'port_n': 'right'}, domain='magnetic',
  keywords=['coil', 'solenoid', 'electromagnet'])
B('magneticGround', 'Magnetic ground', f'{MAG}.Basic.Ground', '⏚', 'magnetic',
  'Zero magnetic potential reference.', sides={'port': 'top'}, names={'port': '0'})
B('mmfSource', 'MMF source', f'{MAG}.Sources.ConstantMagneticPotentialDifference', 'Vm', 'magnetic',
  'A constant magnetomotive force (for example a permanent magnet model).', [P('V_m', 'Magnetomotive force', 100, 'A')],
  keywords=['permanent magnet', 'mmf'])
B('signalMmfSource', 'Controlled MMF source', f'{MAG}.Sources.SignalMagneticPotentialDifference', 'Vm(u)', 'magnetic',
  'Magnetomotive force set by the input signal.', names={'V_m': 'Vm'}, sides={'V_m': 'top'})
B('fluxSource', 'Flux source', f'{MAG}.Sources.ConstantMagneticFlux', 'Φ', 'magnetic',
  'A constant magnetic flux.', [P('Phi', 'Flux', 1e-3, 'Wb')])
B('fluxSensor', 'Flux sensor', f'{MAG}.Sensors.MagneticFluxSensor', 'Φ', 'magnetic',
  'Magnetic flux through the sensor.', sides={'Phi': 'bottom'})
B('mmfSensor', 'MMF sensor', f'{MAG}.Sensors.MagneticPotentialDifferenceSensor', 'Vm', 'magnetic',
  'Magnetic potential difference between its ports.', sides={'V_m': 'bottom'})

# --------------------------------------------------------- electrical passive
B('conductor', 'Conductor', f'{ANALOG}.Basic.Conductor', 'G', 'electrical',
  'Linear conductance: i = G·v.', [P('G', 'Conductance', 1, 'S', 0)], keywords=['admittance'])
B('heatingResistor', 'Resistor (thermal)', f'{ANALOG}.Basic.Resistor', 'R(T)', 'electrical',
  'Resistor whose losses heat its thermal port and whose resistance changes with its temperature.',
  [P('R', 'Resistance at T_ref', 1, 'Ω', 0), P('T_ref', 'Reference temperature', 300.15, 'K', 0), P('alpha', 'Temperature coefficient', 0.0039, '1/K')],
  modifiers={'useHeatPort': 'true'}, sides={'heatPort': 'bottom'}, keywords=['losses', 'self-heating', 'copper'])
B('variableResistor', 'Variable resistor', f'{ANALOG}.Basic.VariableResistor', 'R(u)', 'electrical',
  'Resistance set by the input signal.', sides={'R': 'top'}, keywords=['rheostat'])
B('variableCapacitor', 'Variable capacitor', f'{ANALOG}.Basic.VariableCapacitor', 'C(u)', 'electrical',
  'Capacitance set by the input signal.', [P('Cmin', 'Minimum capacitance', 1e-12, 'F', 0)], sides={'C': 'top'})
B('variableInductor', 'Variable inductor', f'{ANALOG}.Basic.VariableInductor', 'L(u)', 'electrical',
  'Inductance set by the input signal.', [P('Lmin', 'Minimum inductance', 1e-12, 'H', 0)], sides={'L': 'top'})
B('potentiometer', 'Potentiometer', f'{ANALOG}.Basic.Potentiometer', 'pot', 'electrical',
  'Resistor with a wiper at the input position (0…1).', [P('R', 'Total resistance', 1000, 'Ω', 0)],
  modifiers={'useRinput': 'true'}, include={'r'}, names={'pin_p': '+', 'pin_n': '−', 'contact': 'w', 'r': 'pos'},
  sides={'pin_p': 'left', 'pin_n': 'right', 'contact': 'bottom', 'r': 'top'}, keywords=['wiper', 'divider'])
B('saturatingInductor', 'Saturating inductor', f'{ANALOG}.Basic.SaturatingInductor', 'L(i)', 'electrical',
  'Inductance falls from Lzer toward Linf as the core saturates.',
  [P('Inom', 'Nominal current', 1, 'A', 0), P('Lnom', 'Nominal inductance', 1, 'H', 0), P('Lzer', 'Initial inductance', 2, 'H', 0), P('Linf', 'Saturated inductance', 0.5, 'H', 0)],
  keywords=['core', 'nonlinear'])
B('mutualInductor', 'Transformer (coupled)', f'{ANALOG}.Basic.Transformer', 'L1:L2', 'electrical',
  'Two coupled inductors with mutual inductance M.',
  [P('L1', 'Primary inductance', 1, 'H', 0), P('L2', 'Secondary inductance', 1, 'H', 0), P('M', 'Mutual inductance', 0.9, 'H', 0)],
  names={'p1': '1+', 'n1': '1−', 'p2': '2+', 'n2': '2−'}, sides={'p1': 'left', 'n1': 'left', 'p2': 'right', 'n2': 'right'},
  keywords=['coupling', 'mutual'])
B('idealTransformer', 'Ideal transformer', f'{ANALOG}.Ideal.IdealTransformer', 'n:1', 'electrical',
  'Ideal transformer with turns ratio n (optionally with magnetizing inductance).', [P('n', 'Turns ratio', 2, '', 0)],
  modifiers={'considerMagnetization': 'false'},
  names={'p1': '1+', 'n1': '1−', 'p2': '2+', 'n2': '2−'}, sides={'p1': 'left', 'n1': 'left', 'p2': 'right', 'n2': 'right'},
  keywords=['isolation', 'ratio'])
B('gyrator', 'Gyrator', f'{ANALOG}.Basic.Gyrator', 'gyr', 'electrical',
  'Ideal gyrator: i1 = G2·v2, i2 = −G1·v1.', [P('G1', 'Gyration conductance 1', 1, 'S'), P('G2', 'Gyration conductance 2', 1, 'S')],
  names={'p1': '1+', 'n1': '1−', 'p2': '2+', 'n2': '2−'}, sides={'p1': 'left', 'n1': 'left', 'p2': 'right', 'n2': 'right'})
for kind, name, cls, symbol, desc, param in [
    ('vcvs', 'Voltage-controlled voltage source', 'VCV', 'VCVS', 'v2 = gain·v1', P('gain', 'Gain', 1, '')),
    ('vccs', 'Voltage-controlled current source', 'VCC', 'VCCS', 'i2 = G·v1', P('transConductance', 'Transconductance', 1, 'S')),
    ('ccvs', 'Current-controlled voltage source', 'CCV', 'CCVS', 'v2 = R·i1', P('transResistance', 'Transresistance', 1, 'Ω')),
    ('cccs', 'Current-controlled current source', 'CCC', 'CCCS', 'i2 = gain·i1', P('gain', 'Gain', 1, ''))]:
    B(kind, name, f'{ANALOG}.Basic.{cls}', symbol, 'electrical', f'Linear controlled source: {desc}.', [param],
      names={'p1': '1+', 'n1': '1−', 'p2': '2+', 'n2': '2−'}, sides={'p1': 'left', 'n1': 'left', 'p2': 'right', 'n2': 'right'},
      keywords=['dependent source', 'amplifier'])
B('opAmp', 'Op-amp (ideal)', f'{ANALOG}.Ideal.IdealOpAmp3Pin', 'op', 'electrical',
  'Ideal operational amplifier: the inputs are at equal voltage and draw no current.',
  names={'in_p': '+', 'in_n': '−', 'out': 'out'}, sides={'in_p': 'left', 'in_n': 'left', 'out': 'right'},
  keywords=['amplifier', 'opamp'])
B('opAmpLimited', 'Op-amp (limited)', f'{ANALOG}.Ideal.IdealizedOpAmpLimited', 'op±', 'electrical',
  'Op-amp with finite gain and output limited to the supply rails.',
  [P('V0', 'Open-loop gain', 15000, '', 0), P('Vps', 'Positive supply', 15, 'V'), P('Vns', 'Negative supply', -15, 'V')],
  modifiers={'useSupply': 'false'}, names={'in_p': '+', 'in_n': '−', 'out': 'out'},
  sides={'in_p': 'left', 'in_n': 'left', 'out': 'right'}, keywords=['amplifier', 'saturation'])

# ---------------------------------------------------------- electrical sources
B('sineVoltage', 'AC voltage', f'{ANALOG}.Sources.SineVoltage', 'AC', 'electrical',
  'Sinusoidal voltage: offset + V·sin(2πf·t + phase).',
  [P('V', 'Amplitude', 325, 'V'), P('f', 'Frequency', 50, 'Hz', 0), P('phase', 'Phase', 0, 'rad'), P('offset', 'Offset', 0, 'V')],
  sides={'p': 'top', 'n': 'bottom'}, keywords=['mains', 'grid', 'sine'])
B('sineCurrent', 'AC current', f'{ANALOG}.Sources.SineCurrent', 'AC i', 'electrical',
  'Sinusoidal current source.', [P('I', 'Amplitude', 1, 'A'), P('f', 'Frequency', 50, 'Hz', 0), P('phase', 'Phase', 0, 'rad'), P('offset', 'Offset', 0, 'A')],
  sides={'p': 'top', 'n': 'bottom'})
B('dcCurrent', 'DC current', f'{ANALOG}.Sources.ConstantCurrent', 'I', 'electrical',
  'An ideal constant current source.', [P('I', 'Current', 1, 'A')], sides={'p': 'top', 'n': 'bottom'})
B('stepVoltage', 'Step voltage', f'{ANALOG}.Sources.StepVoltage', 'V step', 'electrical',
  'Voltage step at a given time.', [P('V', 'Step', 12, 'V'), P('offset', 'Offset', 0, 'V'), P('startTime', 'Step time', 0.01, 's', 0)],
  sides={'p': 'top', 'n': 'bottom'})
B('rampVoltage', 'Ramp voltage', f'{ANALOG}.Sources.RampVoltage', 'V ramp', 'electrical',
  'Voltage ramp from offset to offset + V.', [P('V', 'Height', 12, 'V'), P('duration', 'Duration', 1, 's', 0), P('offset', 'Offset', 0, 'V'), P('startTime', 'Start time', 0, 's', 0)],
  sides={'p': 'top', 'n': 'bottom'})
B('pulseVoltage', 'Pulse voltage', f'{ANALOG}.Sources.PulseVoltage', 'V pulse', 'electrical',
  'Periodic voltage pulses.', [P('V', 'Amplitude', 5, 'V'), P('width', 'Width', 50, '%', 0, max=100), P('period', 'Period', 0.001, 's', 0), P('offset', 'Offset', 0, 'V')],
  sides={'p': 'top', 'n': 'bottom'}, keywords=['square', 'clock'])
B('signalVoltage', 'Controlled voltage', f'{ANALOG}.Sources.SignalVoltage', 'v(u)', 'electrical',
  'Voltage equal to the input signal.', sides={'p': 'top', 'n': 'bottom', 'v': 'left'}, keywords=['amplifier', 'programmable'])
B('signalCurrent', 'Controlled current', f'{ANALOG}.Sources.SignalCurrent', 'i(u)', 'electrical',
  'Current equal to the input signal.', sides={'p': 'top', 'n': 'bottom', 'i': 'left'}, keywords=['load', 'programmable'])
B('batteryStack', 'Battery', 'Modelica.Electrical.Batteries.BatteryStacks.CellStack', 'bat', 'electrical',
  'Battery stack: open-circuit voltage rising linearly with state of charge, internal resistance, starting full.',
  [P('Ns', 'Cells in series', 96, '', 1), P('Np', 'Cells in parallel', 1, '', 1), P('Q', 'Cell capacity', 5, 'A·h', 0, modifier=''),
   P('OCVmax', 'Cell voltage when full', 4.2, 'V', 0, modifier=''), P('OCVmin', 'Cell voltage when empty', 2.5, 'V', 0, modifier=''),
   P('Ri', 'Cell resistance', 0.005, 'Ω', 0, modifier='')],
  modifiers={'cellData.Qnom': 'Q*3600', 'cellData.OCVmax': 'OCVmax', 'cellData.OCVmin': 'OCVmin', 'cellData.Ri': 'Ri'},
  sides={'p': 'top', 'n': 'bottom'}, keywords=['cell', 'lithium', 'ev', 'soc', 'pack'])
B('supercap', 'Supercapacitor', 'Modelica.Electrical.Batteries.BatteryStacks.SuperCap', 'SC', 'electrical',
  'Double-layer capacitor with series resistance.',
  [P('C', 'Capacitance', 100, 'F', 0), P('Rs', 'Series resistance', 0.01, 'Ω', 0), P('Vnom', 'Nominal voltage', 2.7, 'V', 0),
   P('V0', 'Initial voltage', 0, 'V', 0)],
  sides={'p': 'top', 'n': 'bottom'}, keywords=['ultracapacitor', 'storage'])
B('powerSensor', 'Power sensor', f'{ANALOG}.Sensors.PowerSensor', 'P', 'electrical',
  'Instantaneous power: current path pc→nc, voltage across pv–nv.',
  names={'pc': 'i+', 'nc': 'i−', 'pv': 'v+', 'nv': 'v−', 'power': 'P'},
  sides={'pc': 'left', 'nc': 'right', 'pv': 'top', 'nv': 'bottom', 'power': 'right'}, keywords=['watt meter'])

# ------------------------------------------------------- semiconductors, switches
B('idealDiode', 'Ideal diode', f'{ANALOG}.Ideal.IdealDiode', '▷|', 'semiconductors',
  'Piecewise-linear diode: Ron when conducting, Goff when blocking.',
  [P('Ron', 'On resistance', 1e-5, 'Ω', 0), P('Goff', 'Off conductance', 1e-5, 'S', 0), P('Vknee', 'Knee voltage', 0, 'V', 0)],
  keywords=['rectifier', 'freewheeling'])
B('diodeShockley', 'Diode (exponential)', f'{ANALOG}.Semiconductors.Diode', 'D', 'semiconductors',
  'Shockley diode with saturation current and thermal voltage.',
  [P('Ids', 'Saturation current', 1e-6, 'A', 0), P('Vt', 'Thermal voltage', 0.04, 'V', 0), P('R', 'Parallel resistance', 1e8, 'Ω', 0)])
B('zenerDiode', 'Zener diode', f'{ANALOG}.Semiconductors.ZDiode', 'Z', 'semiconductors',
  'Diode with reverse breakdown at Bv.', [P('Bv', 'Breakdown voltage', 5.1, 'V', 0)], keywords=['reference', 'clamp'])
B('idealThyristor', 'Thyristor', f'{ANALOG}.Ideal.IdealThyristor', 'SCR', 'semiconductors',
  'Ideal thyristor: turns on at a fire pulse when forward biased, off when current reverses.',
  [P('Ron', 'On resistance', 1e-5, 'Ω', 0), P('Goff', 'Off conductance', 1e-5, 'S', 0)],
  names={'p': 'A', 'n': 'K', 'fire': 'g'}, sides={'fire': 'bottom'}, keywords=['scr', 'phase control'])
B('idealGTO', 'GTO thyristor', f'{ANALOG}.Ideal.IdealGTOThyristor', 'GTO', 'semiconductors',
  'Gate turn-off thyristor: conducts while fire is true and forward biased.',
  [P('Ron', 'On resistance', 1e-5, 'Ω', 0), P('Goff', 'Off conductance', 1e-5, 'S', 0)],
  names={'p': 'A', 'n': 'K', 'fire': 'g'}, sides={'fire': 'bottom'}, keywords=['igbt', 'switch'])
B('nmos', 'NMOS transistor', f'{ANALOG}.Semiconductors.NMOS', 'Nch', 'semiconductors',
  'Shichman–Hodges N-channel MOSFET.', [P('W', 'Width', 20e-6, 'm', 0), P('L', 'Length', 6e-6, 'm', 0)],
  sides={'D': 'top', 'G': 'left', 'S': 'bottom', 'B': 'right'}, keywords=['mosfet', 'fet'])
B('pmos', 'PMOS transistor', f'{ANALOG}.Semiconductors.PMOS', 'Pch', 'semiconductors',
  'Shichman–Hodges P-channel MOSFET.', [P('W', 'Width', 20e-6, 'm', 0), P('L', 'Length', 6e-6, 'm', 0)],
  sides={'D': 'bottom', 'G': 'left', 'S': 'top', 'B': 'right'}, keywords=['mosfet', 'fet'])
B('npn', 'NPN transistor', f'{ANALOG}.Semiconductors.NPN', 'NPN', 'semiconductors',
  'Ebers–Moll NPN bipolar transistor.', [P('Bf', 'Forward beta', 50, '', 0)], sides={'C': 'top', 'B': 'left', 'E': 'bottom'},
  keywords=['bjt'])
B('pnp', 'PNP transistor', f'{ANALOG}.Semiconductors.PNP', 'PNP', 'semiconductors',
  'Ebers–Moll PNP bipolar transistor.', [P('Bf', 'Forward beta', 50, '', 0)], sides={'C': 'bottom', 'B': 'left', 'E': 'top'},
  keywords=['bjt'])
B('closingSwitch', 'Switch (Boolean)', f'{ANALOG}.Ideal.IdealClosingSwitch', 'S', 'semiconductors',
  'Ideal switch that closes while its control input is true.',
  [P('Ron', 'On resistance', 1e-5, 'Ω', 0), P('Goff', 'Off conductance', 1e-5, 'S', 0)], sides={'control': 'top'},
  names={'control': 'on'}, keywords=['relay', 'contactor', 'breaker'])
B('openingSwitch', 'Opening switch', f'{ANALOG}.Ideal.IdealOpeningSwitch', 'S̄', 'semiconductors',
  'Ideal switch that opens while its control input is true.',
  [P('Ron', 'On resistance', 1e-5, 'Ω', 0), P('Goff', 'Off conductance', 1e-5, 'S', 0)], sides={'control': 'top'},
  names={'control': 'off'}, keywords=['fault', 'disconnect'])
B('twoWaySwitch', 'Changeover switch', f'{ANALOG}.Ideal.IdealTwoWaySwitch', 'SPDT', 'semiconductors',
  'Connects p to n2 while control is true, otherwise to n1.',
  [P('Ron', 'On resistance', 1e-5, 'Ω', 0), P('Goff', 'Off conductance', 1e-5, 'S', 0)],
  sides={'p': 'left', 'n1': 'right', 'n2': 'right', 'control': 'top'}, names={'control': 'sel'}, keywords=['spdt', 'selector'])
B('breaker', 'Breaker (with arc)', f'{ANALOG}.Ideal.OpenerWithArc', 'CB', 'semiconductors',
  'Opens while control is true; an arc sustains current until it quenches.',
  [P('Ron', 'On resistance', 1e-5, 'Ω', 0), P('Goff', 'Off conductance', 1e-5, 'S', 0), P('V0', 'Arc voltage', 30, 'V', 0),
   P('dVdt', 'Arc voltage slope', 10e3, 'V/s', 0), P('Vmax', 'Quench voltage', 60, 'V', 0)],
  sides={'control': 'top'}, names={'control': 'trip'}, keywords=['circuit breaker', 'fuse', 'arc'])

# ------------------------------------------------------------------ converters
B('buckConverter', 'Buck converter', f'{PC}.DCDC.ChopperStepDown', 'buck', 'converters',
  'Switched step-down chopper (transistor and freewheeling diode); fire drives the transistor.',
  [P('RonTransistor', 'Transistor on resistance', 1e-5, 'Ω', 0), P('RonDiode', 'Diode on resistance', 1e-5, 'Ω', 0)],
  names={'dc_p1': 'in+', 'dc_n1': 'in−', 'dc_p2': 'out+', 'dc_n2': 'out−', 'fire_p': 'fire'},
  sides={'dc_p1': 'left', 'dc_n1': 'left', 'dc_p2': 'right', 'dc_n2': 'right', 'fire_p': 'bottom'},
  keywords=['chopper', 'step-down', 'dc-dc', 'smps'])
B('boostConverter', 'Boost converter', f'{PC}.DCDC.ChopperStepUp', 'boost', 'converters',
  'Switched step-up chopper; fire drives the transistor.',
  [P('RonTransistor', 'Transistor on resistance', 1e-5, 'Ω', 0), P('RonDiode', 'Diode on resistance', 1e-5, 'Ω', 0)],
  names={'dc_p1': 'in+', 'dc_n1': 'in−', 'dc_p2': 'out+', 'dc_n2': 'out−', 'fire_p': 'fire'},
  sides={'dc_p1': 'left', 'dc_n1': 'left', 'dc_p2': 'right', 'dc_n2': 'right', 'fire_p': 'bottom'},
  keywords=['chopper', 'step-up', 'dc-dc'])
B('buckBoostConverter', 'Buck-boost converter', f'{PC}.DCDC.ChopperBuckBoost', 'b-b', 'converters',
  'Non-inverting buck-boost chopper: fire_p drives the input (buck) switch, fire_n the output (boost) switch.',
  [P('RonTransistor', 'Transistor on resistance', 1e-5, 'Ω', 0), P('RonDiode', 'Diode on resistance', 1e-5, 'Ω', 0)],
  names={'dc_p1': 'in+', 'dc_n1': 'in−', 'dc_p2': 'out+', 'dc_n2': 'out−', 'fire_p': 'buck', 'fire_n': 'boost'},
  sides={'dc_p1': 'left', 'dc_n1': 'left', 'dc_p2': 'right', 'dc_n2': 'right', 'fire_p': 'bottom', 'fire_n': 'bottom'},
  keywords=['dc-dc', 'four-switch'])
B('hBridge', 'H-bridge', f'{PC}.DCDC.HBridge', 'H', 'converters',
  'Four-quadrant DC chopper; fire_p and fire_n drive the two diagonals.',
  [P('RonTransistor', 'Transistor on resistance', 1e-5, 'Ω', 0), P('RonDiode', 'Diode on resistance', 1e-5, 'Ω', 0)],
  names={'dc_p1': 'in+', 'dc_n1': 'in−', 'dc_p2': 'out+', 'dc_n2': 'out−', 'fire_p': 'f+', 'fire_n': 'f−'},
  sides={'dc_p1': 'left', 'dc_n1': 'left', 'dc_p2': 'right', 'dc_n2': 'right', 'fire_p': 'bottom', 'fire_n': 'bottom'},
  keywords=['motor drive', 'full bridge'])
B('pwmSignal', 'PWM generator', f'{PC}.DCDC.Control.SignalPWM', 'PWM', 'converters',
  'Compares the duty-cycle input (0…1) with a sawtooth to produce fire and its complement.',
  [P('f', 'Switching frequency', 10e3, 'Hz', 0)], modifiers={'useConstantDutyCycle': 'false'}, include={'dutyCycle'},
  names={'dutyCycle': 'd', 'fire': 'fire', 'notFire': 'fire̅'}, keywords=['modulator', 'duty cycle', 'switching'])
B('diodeBridge', 'Diode bridge', f'{PC}.ACDC.DiodeBridge2Pulse', '◇', 'converters',
  'Single-phase full-wave diode rectifier.',
  [P('RonDiode', 'Diode on resistance', 1e-5, 'Ω', 0), P('GoffDiode', 'Diode off conductance', 1e-5, 'S', 0)],
  names={'ac_p': 'ac+', 'ac_n': 'ac−', 'dc_p': 'dc+', 'dc_n': 'dc−'},
  sides={'ac_p': 'left', 'ac_n': 'left', 'dc_p': 'right', 'dc_n': 'right'}, keywords=['rectifier', 'ac-dc'])
B('thyristorBridge', 'Thyristor bridge', f'{PC}.ACDC.ThyristorBridge2Pulse', '◇SCR', 'converters',
  'Single-phase full-wave thyristor rectifier with two fire inputs.',
  [P('RonThyristor', 'Thyristor on resistance', 1e-5, 'Ω', 0), P('GoffThyristor', 'Thyristor off conductance', 1e-5, 'S', 0)],
  names={'ac_p': 'ac+', 'ac_n': 'ac−', 'dc_p': 'dc+', 'dc_n': 'dc−', 'fire_p': 'f+', 'fire_n': 'f−'},
  sides={'ac_p': 'left', 'ac_n': 'left', 'dc_p': 'right', 'dc_n': 'right', 'fire_p': 'bottom', 'fire_n': 'bottom'},
  keywords=['rectifier', 'phase control'])
B('singlePhaseInverter', 'Inverter (1-phase)', f'{PC}.DCAC.SinglePhase2Level', 'DC→AC', 'converters',
  'Single-phase two-level half-bridge inverter.',
  [P('RonTransistor', 'Transistor on resistance', 1e-5, 'Ω', 0), P('RonDiode', 'Diode on resistance', 1e-5, 'Ω', 0)],
  names={'dc_p': 'dc+', 'dc_n': 'dc−', 'ac': 'ac', 'fire_p': 'f+', 'fire_n': 'f−'},
  sides={'dc_p': 'left', 'dc_n': 'left', 'ac': 'right', 'fire_p': 'bottom', 'fire_n': 'bottom'}, keywords=['half bridge', 'dc-ac'])
B('threePhaseInverter', 'Inverter (3-phase)', f'{PC}.DCAC.Polyphase2Level', '3~', 'converters',
  'Three-phase two-level inverter with a fire input per switch.',
  [P('RonTransistor', 'Transistor on resistance', 1e-5, 'Ω', 0), P('RonDiode', 'Diode on resistance', 1e-5, 'Ω', 0)],
  ports={'dc_p': 'dc_p', 'dc_n': 'dc_n', 'ac': 'ac', 'fa_p': 'fire_p[1]', 'fb_p': 'fire_p[2]', 'fc_p': 'fire_p[3]',
         'fa_n': 'fire_n[1]', 'fb_n': 'fire_n[2]', 'fc_n': 'fire_n[3]'},
  names={'dc_p': 'dc+', 'dc_n': 'dc−', 'ac': 'abc', 'fa_p': 'a+', 'fb_p': 'b+', 'fc_p': 'c+', 'fa_n': 'a−', 'fb_n': 'b−', 'fc_n': 'c−'},
  sides={'dc_p': 'left', 'dc_n': 'left', 'ac': 'right', 'fa_p': 'bottom', 'fb_p': 'bottom', 'fc_p': 'bottom',
         'fa_n': 'bottom', 'fb_n': 'bottom', 'fc_n': 'bottom'}, keywords=['vsi', 'motor drive', 'dc-ac'])

# --------------------------------------------------------------------- machines
DCPM = f'{MACH}.BasicMachines.DCMachines.DC_PermanentMagnet'
B('dcPmMachine', 'DC machine (PM)', DCPM, 'DC', 'machines',
  'Permanent-magnet DC machine with armature resistance and inductance.',
  [P('VaNominal', 'Nominal voltage', 100, 'V', 0), P('IaNominal', 'Nominal current', 100, 'A', 0),
   P('wNominal', 'Nominal speed', 149.2, 'rad/s', 0), P('Ra', 'Armature resistance', 0.05, 'Ω', 0),
   P('La', 'Armature inductance', 0.0015, 'H', 0), P('Jr', 'Rotor inertia', 0.15, 'kg·m²', 0)],
  modifiers={'TaOperational': '293.15', 'TaNominal': '293.15', 'TaRef': '293.15'},
  names={'pin_ap': 'a+', 'pin_an': 'a−', 'flange': 'shaft'}, sides={'pin_ap': 'left', 'pin_an': 'left', 'flange': 'right'},
  domain='electrical', keywords=['motor', 'generator', 'dc motor'])
B('dcShuntMachine', 'DC machine (excited)', f'{MACH}.BasicMachines.DCMachines.DC_ElectricalExcited', 'DC ex', 'machines',
  'Separately excited DC machine; wire the field in parallel for shunt operation.',
  [P('VaNominal', 'Nominal voltage', 100, 'V', 0), P('IaNominal', 'Nominal current', 100, 'A', 0),
   P('wNominal', 'Nominal speed', 149.2, 'rad/s', 0), P('IeNominal', 'Nominal field current', 1, 'A', 0),
   P('Ra', 'Armature resistance', 0.05, 'Ω', 0), P('La', 'Armature inductance', 0.0015, 'H', 0), P('Jr', 'Rotor inertia', 0.15, 'kg·m²', 0)],
  modifiers={'TaOperational': '293.15', 'TaNominal': '293.15', 'TaRef': '293.15', 'TeOperational': '293.15', 'TeRef': '293.15'},
  names={'pin_ap': 'a+', 'pin_an': 'a−', 'pin_ep': 'e+', 'pin_en': 'e−', 'flange': 'shaft'},
  sides={'pin_ap': 'left', 'pin_an': 'left', 'pin_ep': 'top', 'pin_en': 'top', 'flange': 'right'}, domain='electrical',
  keywords=['shunt', 'field', 'dc motor'])
B('dcSeriesMachine', 'DC machine (series)', f'{MACH}.BasicMachines.DCMachines.DC_SeriesExcited', 'DC s', 'machines',
  'Series-excited DC machine (traction motor).',
  [P('VaNominal', 'Nominal voltage', 100, 'V', 0), P('IaNominal', 'Nominal current', 100, 'A', 0),
   P('wNominal', 'Nominal speed', 149.2, 'rad/s', 0), P('Ra', 'Armature resistance', 0.05, 'Ω', 0),
   P('La', 'Armature inductance', 0.0015, 'H', 0), P('Jr', 'Rotor inertia', 0.15, 'kg·m²', 0)],
  modifiers={'TaOperational': '293.15', 'TaNominal': '293.15', 'TaRef': '293.15', 'TeOperational': '293.15', 'TeRef': '293.15'},
  names={'pin_ap': 'a+', 'pin_an': 'a−', 'pin_ep': 'e+', 'pin_en': 'e−', 'flange': 'shaft'},
  sides={'pin_ap': 'left', 'pin_an': 'left', 'pin_ep': 'top', 'pin_en': 'top', 'flange': 'right'}, domain='electrical',
  keywords=['traction', 'series', 'dc motor'])
B('inductionMachine', 'Induction machine', f'{MACH}.BasicMachines.InductionMachines.IM_SquirrelCage', 'IM', 'machines',
  'Three-phase squirrel-cage induction machine (star-connected stator terminals).',
  [P('p', 'Pole pairs', 2, '', 1), P('fsNominal', 'Nominal frequency', 50, 'Hz', 0), P('Rs', 'Stator resistance', 0.03, 'Ω', 0),
   P('Rr', 'Rotor resistance', 0.04, 'Ω', 0), P('Jr', 'Rotor inertia', 0.29, 'kg·m²', 0)],
  modifiers={'TsOperational': '293.15', 'TrOperational': '293.15', 'TsRef': '293.15', 'TrRef': '293.15'},
  names={'plug_sp': 'abc', 'plug_sn': 'n', 'flange': 'shaft'}, sides={'plug_sp': 'left', 'plug_sn': 'bottom', 'flange': 'right'},
  domain='threePhase', keywords=['asynchronous', 'motor', 'squirrel cage'])
B('pmSyncMachine', 'PMSM (MSL)', f'{MACH}.BasicMachines.SynchronousMachines.SM_PermanentMagnet', 'PMSM', 'machines',
  'Three-phase permanent-magnet synchronous machine with damper cage.',
  [P('p', 'Pole pairs', 2, '', 1), P('fsNominal', 'Nominal frequency', 50, 'Hz', 0), P('Rs', 'Stator resistance', 0.03, 'Ω', 0),
   P('Jr', 'Rotor inertia', 0.29, 'kg·m²', 0)],
  modifiers={'TsOperational': '293.15', 'TsRef': '293.15', 'TrOperational': '293.15', 'TrRef': '293.15'},
  names={'plug_sp': 'abc', 'plug_sn': 'n', 'flange': 'shaft'}, sides={'plug_sp': 'left', 'plug_sn': 'bottom', 'flange': 'right'},
  exclude={'damperCageLossPower'}, domain='threePhase', keywords=['synchronous', 'bldc', 'motor'])
B('reluctanceMachine', 'Reluctance machine', f'{MACH}.BasicMachines.SynchronousMachines.SM_ReluctanceRotor', 'SynRM', 'machines',
  'Three-phase synchronous reluctance machine.',
  [P('p', 'Pole pairs', 2, '', 1), P('fsNominal', 'Nominal frequency', 50, 'Hz', 0), P('Rs', 'Stator resistance', 0.03, 'Ω', 0),
   P('Jr', 'Rotor inertia', 0.29, 'kg·m²', 0)],
  modifiers={'TsOperational': '293.15', 'TsRef': '293.15', 'TrOperational': '293.15', 'TrRef': '293.15'},
  names={'plug_sp': 'abc', 'plug_sn': 'n', 'flange': 'shaft'}, sides={'plug_sp': 'left', 'plug_sn': 'bottom', 'flange': 'right'},
  exclude={'damperCageLossPower'}, domain='threePhase', keywords=['synrm', 'motor'])
B('hallSensor', 'Electrical angle sensor', f'{MACH}.Sensors.HallSensor', 'Hall', 'machines',
  'Electrical rotor angle for p pole pairs, as a Hall or encoder sensor reports it (0…2π).', [P('p', 'Pole pairs', 2, '', 1)],
  names={'y': 'θe'}, sides={'flange': 'left', 'y': 'right'}, domain='mechanical', keywords=['hall', 'commutation', 'bldc', 'encoder'])
B('resolver', 'Resolver', f'{MACH}.Sensors.SinCosResolver', 'R', 'machines',
  'Sine–cosine resolver: outputs the sine and cosine of the electrical angle.', [P('p', 'Pole pairs', 1, '', 1)],
  ports={'flange': 'flange', 'sin': 'y[1]', 'cos': 'y[2]', 'nsin': 'y[3]', 'ncos': 'y[4]'},
  names={'sin': 'sin', 'cos': 'cos', 'nsin': '−sin', 'ncos': '−cos'},
  sides={'flange': 'left', 'sin': 'right', 'cos': 'right', 'nsin': 'right', 'ncos': 'right'}, domain='mechanical',
  keywords=['encoder', 'angle'])

# ---------------------------------------------------------------------- 3-phase
B('threePhaseSource', '3-phase AC source', f'{POLY}.Sources.SineVoltage', '3~ AC', 'threePhase',
  'Balanced three-phase sinusoidal voltages (star, neutral at plug −).',
  [P('V', 'Phase amplitude', 325, 'V'), P('f', 'Frequency', 50, 'Hz', 0)], modifiers={'V': 'fill(V, 3)', 'f': 'fill(f, 3)'},
  sides={'plug_p': 'right', 'plug_n': 'bottom'}, names={'plug_p': 'abc', 'plug_n': 'N'}, keywords=['grid', 'mains', 'three phase'])
B('threePhaseResistor', '3-phase resistor', f'{POLY}.Basic.Resistor', '3R', 'threePhase',
  'Resistor in each phase.', [P('R', 'Resistance per phase', 10, 'Ω', 0)], modifiers={'R': 'fill(R, 3)'})
B('threePhaseInductor', '3-phase inductor', f'{POLY}.Basic.Inductor', '3L', 'threePhase',
  'Inductor in each phase.', [P('L', 'Inductance per phase', 0.01, 'H', 0)], modifiers={'L': 'fill(L, 3)'}, keywords=['choke', 'filter'])
B('threePhaseCapacitor', '3-phase capacitor', f'{POLY}.Basic.Capacitor', '3C', 'threePhase',
  'Capacitor in each phase.', [P('C', 'Capacitance per phase', 1e-5, 'F', 0)], modifiers={'C': 'fill(C, 3)'})
B('star', 'Star point', f'{POLY}.Basic.Star', 'Y', 'threePhase',
  'Joins the three phases at a neutral pin.', names={'plug_p': 'abc', 'pin_n': 'N'},
  sides={'plug_p': 'left', 'pin_n': 'right'}, domain='threePhase', keywords=['neutral', 'wye'])
B('delta', 'Delta connection', f'{POLY}.Basic.Delta', 'Δ', 'threePhase',
  'Connects the phases in delta (a–b, b–c, c–a).', names={'plug_p': 'abc', 'plug_n': 'bca'}, keywords=['mesh'])
for k, label in [(1, 'a'), (2, 'b'), (3, 'c')]:
    B(f'phase{label.upper()}', f'Phase {label} tap', f'{POLY}.Basic.PlugToPin_p', label, 'threePhase',
      f'Connects phase {label} of a 3-phase plug to a single-phase pin.', modifiers={'k': str(k)},
      names={'plug_p': 'abc', 'pin_p': label}, sides={'plug_p': 'left', 'pin_p': 'right'}, domain='threePhase',
      keywords=['splitter', 'pin'])
B('threePhaseTransformer', '3-phase transformer (Dy)', f'{MACH}.BasicMachines.Transformers.Dy.Dy01', 'Dy', 'threePhase',
  'Three-phase delta–star transformer with a nominal ratio.',
  [P('n', 'Ratio', 1, '', 0)], modifiers={'n': 'n', 'R1': '0.01', 'L1sigma': '0.001', 'R2': '0.01', 'L2sigma': '0.001', 'T1Ref': '293.15',
                                           'T2Ref': '293.15', 'T1Operational': '293.15', 'T2Operational': '293.15'},
  names={'plug1': 'HV', 'plug2': 'LV', 'starpoint2': 'N'}, sides={'plug1': 'left', 'plug2': 'right', 'starpoint2': 'bottom'},
  exclude={'starpoint1'}, domain='threePhase', keywords=['delta-wye', 'distribution'])
B('threePhaseCurrentSensor', '3-phase current sensor', f'{POLY}.Sensors.CurrentSensor', 'iabc', 'threePhase',
  'Phase currents from plug + to plug −.', ports={'plug_p': 'plug_p', 'plug_n': 'plug_n', 'ia': 'i[1]', 'ib': 'i[2]', 'ic': 'i[3]'},
  names={'ia': 'ia', 'ib': 'ib', 'ic': 'ic'}, sides={'ia': 'bottom', 'ib': 'bottom', 'ic': 'bottom'})
B('threePhaseVoltageSensor', '3-phase voltage sensor', f'{POLY}.Sensors.VoltageSensor', 'vabc', 'threePhase',
  'Phase voltages between plug + and plug −.', ports={'plug_p': 'plug_p', 'plug_n': 'plug_n', 'va': 'v[1]', 'vb': 'v[2]', 'vc': 'v[3]'},
  names={'va': 'va', 'vb': 'vb', 'vc': 'vc'}, sides={'va': 'bottom', 'vb': 'bottom', 'vc': 'bottom'})
B('threePhasePowerSensor', '3-phase power sensor', f'{POLY}.Sensors.PowerSensor', 'P3~', 'threePhase',
  'Total instantaneous power of the three phases.',
  names={'pc': 'i+', 'nc': 'i−', 'pv': 'v+', 'nv': 'v−', 'power': 'P'},
  sides={'pc': 'left', 'nc': 'right', 'pv': 'top', 'nv': 'bottom', 'power': 'right'})

# ----------------------------------------------------------------------- logic
for kind, name, cls, symbol in [('and', 'AND', 'And', '&'), ('or', 'OR', 'Or', '≥1'), ('xor', 'XOR', 'Xor', '=1'),
                                ('nand', 'NAND', 'Nand', '&̄'), ('nor', 'NOR', 'Nor', '≥1̄')]:
    B(f'logic{cls}', name, f'{BLK}.Logical.{cls}', symbol, 'logic', f'Boolean {name} of two inputs.', domain='boolean',
      keywords=['gate', 'logic', 'boolean'])
B('logicNot', 'NOT', f'{BLK}.Logical.Not', '¬', 'logic', 'Boolean negation.', domain='boolean', keywords=['invert'])
B('greaterThreshold', 'Greater than threshold', f'{BLK}.Logical.GreaterThreshold', 'u>k', 'logic',
  'True while the input exceeds the threshold.', [P('threshold', 'Threshold', 0.5, '')], domain='boolean', keywords=['compare', 'comparator'])
B('lessThreshold', 'Less than threshold', f'{BLK}.Logical.LessThreshold', 'u<k', 'logic',
  'True while the input is below the threshold.', [P('threshold', 'Threshold', 0.5, '')], domain='boolean', keywords=['compare'])
B('greater', 'Greater than', f'{BLK}.Logical.Greater', 'u1>u2', 'logic', 'True while u1 > u2.', domain='boolean',
  keywords=['compare', 'comparator'])
B('less', 'Less than', f'{BLK}.Logical.Less', 'u1<u2', 'logic', 'True while u1 < u2.', domain='boolean', keywords=['compare'])
B('boolHysteresis', 'Hysteresis', f'{BLK}.Logical.Hysteresis', '⊏⊐', 'logic',
  'True above uHigh, false below uLow, unchanged in between.', [P('uLow', 'Lower threshold', 0, ''), P('uHigh', 'Upper threshold', 1, '')],
  modifiers={'pre_y_start': 'false'}, domain='boolean', keywords=['schmitt', 'bang-bang', 'thermostat'])
B('onOffController', 'On-off controller', f'{BLK}.Logical.OnOffController', 'on/off', 'logic',
  'True while the measurement is below the reference minus half the bandwidth; false above plus half.',
  [P('bandwidth', 'Bandwidth', 0.1, '', 0)], modifiers={'pre_y_start': 'false'}, names={'reference': 'ref', 'u': 'meas'},
  domain='boolean', keywords=['thermostat', 'bang-bang'])
B('logicSwitch', 'Switch (logic)', f'{BLK}.Logical.Switch', 'sw', 'logic',
  'Outputs u1 while u2 is true, otherwise u3.', names={'u1': 'true', 'u2': 'sel', 'u3': 'false'},
  sides={'u2': 'left'}, keywords=['select', 'mux'])
B('rsFlipFlop', 'RS flip-flop', f'{BLK}.Logical.RSFlipFlop', 'RS', 'logic', 'Set/reset latch.',
  modifiers={'Qini': 'false'}, sides={'S': 'left', 'R': 'left', 'Q': 'right', 'QI': 'right'}, names={'QI': 'Q̄'}, domain='boolean', keywords=['latch', 'memory'])
B('timer', 'Timer', f'{BLK}.Logical.Timer', 't', 'logic', 'Time since the input became true (0 while false).',
  keywords=['elapsed', 'stopwatch'])
B('booleanToReal', 'Boolean to real', f'{BLK}.Math.BooleanToReal', 'B→R', 'logic',
  'Converts true/false to two values.', [P('realTrue', 'Value when true', 1, ''), P('realFalse', 'Value when false', 0, '')],
  keywords=['convert', 'cast'])
B('booleanConstant', 'Boolean constant', f'{BLK}.Sources.BooleanConstant', 'true', 'logic', 'Constant true output.',
  modifiers={'k': 'true'}, domain='boolean', keywords=['enable'])
B('booleanStep', 'Boolean step', f'{BLK}.Sources.BooleanStep', '⎍', 'logic', 'False before the step time, true after.',
  [P('startTime', 'Step time', 0.5, 's', 0)], modifiers={'startValue': 'false'}, domain='boolean', keywords=['enable', 'trigger'])
B('booleanPulse', 'Boolean pulse', f'{BLK}.Sources.BooleanPulse', '⎍⎍', 'logic', 'Periodic true pulses.',
  [P('width', 'Width', 50, '%', 0, max=100), P('period', 'Period', 0.01, 's', 0), P('startTime', 'Start time', 0, 's')],
  domain='boolean', keywords=['clock', 'square', 'pwm'])
B('triggeredSampler', 'Triggered sampler', f'{BLK}.Discrete.TriggeredSampler', 'S/H', 'logic',
  'Samples the input at each rising edge of trigger and holds it.', [P('y_start', 'Initial output', 0, '')],
  sides={'trigger': 'bottom'}, keywords=['sample and hold', 'latch'])
B('edge', 'Rising edge', f'{BLK}.Logical.Edge', '↑', 'logic', 'True for one instant when the input becomes true.',
  domain='boolean', keywords=['trigger', 'event'])


def ts_string(value: str) -> str:
    return json.dumps(value, ensure_ascii=False)


def build(spec: dict) -> dict:
    cls = spec['cls']
    if cls not in INDEX:
        raise SystemExit(f'{spec["kind"]}: {cls} is not in the MSL index')
    info = INDEX[cls]
    modifiers = dict(spec['modifiers'])
    for param in spec['params']:
        if param['modifier'] == '':
            continue  # used only inside other modifiers
        key = param['modifier'] or param['id']
        if key not in modifiers:
            modifiers[key] = param['id']
    for key in modifiers:
        if key.split('.')[0] not in info['parameters']:
            raise SystemExit(f'{spec["kind"]}: {cls} has no parameter {key}')
    enabled = {k for k, v in modifiers.items() if v == 'true'}
    if spec['ports']:
        mapping = spec['ports']
    else:
        mapping = {}
        for name, (domain, direction, *flags) in info['connectors'].items():
            if name in spec['exclude'] or 'array' in flags:
                continue
            if 'conditional' in flags and name not in spec['include'] and not (
                    (name == 'heatPort' and 'useHeatPort' in enabled) or (name == 'support' and 'useSupport' in enabled)):
                continue
            if name == 'internalSupport':
                continue
            mapping[name] = name
    if not spec['ports']:
        # Positive terminals before negative ones on a shared side (p1 above n1).
        def order(item):
            name = item[0]
            stem = re.sub(r'(^|_)(p|n)(?=\d*$)|^(p|n)(?=\d)', r'\1', name)
            return (stem, 0 if re.search(r'(^|_)p\d*$', name) else 1, name)
        mapping = dict(sorted(mapping.items(), key=order))
        # The order the sides are listed in is the order terminals take on a shared side.
        listed = list(spec['sides'])
        mapping = dict(sorted(mapping.items(), key=lambda item: listed.index(item[0]) if item[0] in listed else len(listed)))
    ports = []
    physical_seen = 0
    for port_id, target in mapping.items():
        base = re.match(r'\w+', target).group(0)
        if base not in info['connectors']:
            raise SystemExit(f'{spec["kind"]}: {cls} has no connector {base}')
        domain, direction, *flags = info['connectors'][base]
        if ('array' in flags) != ('[' in target):
            raise SystemExit(f'{spec["kind"]}: connector {target} vector mismatch')
        side = spec['sides'].get(port_id)
        if side is None:
            if direction == 'input':
                side = 'left'
            elif direction == 'output':
                side = 'right'
            else:
                side = 'left' if physical_seen % 2 == 0 else 'right'
                physical_seen += 1
        name = spec['names'].get(port_id) or CAPTIONS.get(port_id) or port_id
        port = {'id': port_id, 'name': name, 'direction': direction, 'domain': domain, 'side': side}
        ports.append(port)
    domains = [p['domain'] for p in ports if p['direction'] == 'physical']
    domain = spec['domain'] or (domains[0] if domains else ('boolean' if any(p['domain'] == 'boolean' and p['direction'] == 'output' for p in ports) else 'signal'))
    if domain == 'boolean' and not any(p['domain'] == 'boolean' for p in ports):
        domain = 'signal'
    params = []
    for p in spec['params']:
        entry = {'id': p['id'], 'name': p['name'], 'value': p['value'], 'unit': p['unit']}
        if p['min'] is not None:
            entry['min'] = p['min']
        if p['max'] is not None:
            entry['max'] = p['max']
        params.append(entry)
    wrapper = {'class': cls}
    if modifiers:
        wrapper['modifiers'] = modifiers
    renamed = {k: v for k, v in mapping.items() if k != v}
    if renamed:
        wrapper['ports'] = renamed
    return {'kind': spec['kind'], 'name': spec['name'], 'description': spec['description'], 'domain': domain,
            'category': spec['category'], 'symbol': spec['symbol'], 'ports': ports, 'parameters': params,
            'equations': spec['equations'] or f'// {cls.replace("Modelica.", "")} from the Modelica Standard Library 4.1.0',
            'keywords': spec['keywords'], 'modelica': wrapper}


def main():
    kinds = set()
    out = []
    errors = []
    for spec in BLOCKS:
        if spec['kind'] in kinds:
            errors.append(f'duplicate kind {spec["kind"]}')
        kinds.add(spec['kind'])
        try:
            out.append(build(spec))
        except SystemExit as exc:
            errors.append(str(exc))
    if errors:
        raise SystemExit('\n'.join(errors))
    body = json.dumps(out, indent=2, ensure_ascii=False)
    # The library has names like µF: write UTF-8 with LF endings on every platform.
    sys.stdout.reconfigure(encoding='utf-8', newline='\n')
    sys.stdout.write('// Generated by scripts/msl-blocks.py from server/msl_index.json. Do not edit by hand.\n'
                     "import type { Definition } from './model';\n\n"
                     '/** Library blocks that instantiate Modelica Standard Library 4.1.0 classes. */\n'
                     f'export const mslBlocks: Definition[] = {body};\n')
    print(f'{len(out)} blocks', file=sys.stderr)


if __name__ == '__main__':
    main()
