# SPDX-License-Identifier: Apache-2.0
"""Every Modelica Standard Library block compiles and runs in OpenModelica.

Each block is placed in a small harness: Real inputs get a constant, Boolean
inputs a constant true, and every physical terminal is tied to its domain's
reference through a lossy element, so the model is well posed whatever the block
does. Outputs stay open. Physics checks for representative blocks follow.
Run with: npm run engine:test -- -m integration tests/test_msl_engine.py
"""
import asyncio
import json
import uuid
from pathlib import Path

import pytest

from server.engine import simulate
from server.models import Project

ROOT = Path(__file__).resolve().parent.parent


def library() -> list[dict]:
    src = (ROOT/'lib'/'gradara'/'msl-blocks.ts').read_text(encoding='utf-8')
    return json.loads(src[src.index('= [') + 2:src.rindex(';')])


def wrap(cls, ports, modifiers=None, domain='signal', params=()):
    return {'kind': cls.rsplit('.', 1)[-1].lower(), 'name': cls.rsplit('.', 1)[-1], 'description': '', 'domain': domain,
            'symbol': '', 'equations': '', 'parameters': list(params),
            'ports': [{'id': i, 'name': i, 'direction': d, 'domain': dom} for i, d, dom in ports],
            'modelica': {'class': cls, 'modifiers': modifiers or {}}}


# Lossy element to the domain reference: (element class, its two ports, reference class, reference port, modifiers).
TIES = {
    'electrical': ('Modelica.Electrical.Analog.Basic.Resistor', ('p', 'n'), 'Modelica.Electrical.Analog.Basic.Ground', 'p', {'R': '1'}),
    'mechanical': ('Modelica.Mechanics.Rotational.Components.Damper', ('flange_a', 'flange_b'), 'Modelica.Mechanics.Rotational.Components.Fixed', 'flange', {'d': '1'}),
    'translational': ('Modelica.Mechanics.Translational.Components.Damper', ('flange_a', 'flange_b'), 'Modelica.Mechanics.Translational.Components.Fixed', 'flange', {'d': '1'}),
    'thermal': ('Modelica.Thermal.HeatTransfer.Components.ThermalConductor', ('port_a', 'port_b'), 'Modelica.Thermal.HeatTransfer.Sources.FixedTemperature', 'port', {'G': '1', 'T': '293.15'}),
    'magnetic': ('Modelica.Magnetic.FluxTubes.Basic.ConstantReluctance', ('port_p', 'port_n'), 'Modelica.Magnetic.FluxTubes.Basic.Ground', 'port', {'R_m': '1e6'}),
}


def harness(data: dict) -> Project:
    blocks = [{'id': 'dut', 'definition': data, 'position': {'x': 0, 'y': 0}}]
    wires = []
    n = 0
    for port in data['ports']:
        n += 1
        if port['direction'] == 'output':
            continue
        if port['direction'] == 'input':
            cls = 'Modelica.Blocks.Sources.' + ('BooleanConstant' if port['domain'] == 'boolean' else 'Constant')
            mods = {'k': 'true'} if port['domain'] == 'boolean' else {'k': '0.5'}
            blocks.append({'id': f's{n}', 'definition': wrap(cls, [('y', 'output', port['domain'])], mods), 'position': {'x': 0, 'y': 0}})
            wires.append({'id': f'w{n}', 'source': f's{n}', 'sourceHandle': 'y', 'target': 'dut', 'targetHandle': port['id']})
            continue
        if port['domain'] == 'threePhase':
            r = wrap('Modelica.Electrical.Polyphase.Basic.Resistor', [('plug_p', 'physical', 'threePhase'), ('plug_n', 'physical', 'threePhase')],
                     {'R': 'fill(1, 3)'}, 'threePhase')
            star = wrap('Modelica.Electrical.Polyphase.Basic.Star', [('plug_p', 'physical', 'threePhase'), ('pin_n', 'physical', 'electrical')], {}, 'threePhase')
            gnd = wrap('Modelica.Electrical.Analog.Basic.Ground', [('p', 'physical', 'electrical')], {}, 'electrical')
            blocks += [{'id': f'r{n}', 'definition': r, 'position': {'x': 0, 'y': 0}}, {'id': f'y{n}', 'definition': star, 'position': {'x': 0, 'y': 0}},
                       {'id': f'g{n}', 'definition': gnd, 'position': {'x': 0, 'y': 0}}]
            wires += [{'id': f'w{n}a', 'source': 'dut', 'sourceHandle': port['id'], 'target': f'r{n}', 'targetHandle': 'plug_p'},
                      {'id': f'w{n}b', 'source': f'r{n}', 'sourceHandle': 'plug_n', 'target': f'y{n}', 'targetHandle': 'plug_p'},
                      {'id': f'w{n}c', 'source': f'y{n}', 'sourceHandle': 'pin_n', 'target': f'g{n}', 'targetHandle': 'p'}]
            continue
        element, (a, b), reference, ref_port, mods = TIES[port['domain']]
        el_mods = {k: v for k, v in mods.items() if k != 'T'}
        ref_mods = {'T': mods['T']} if 'T' in mods else {}
        blocks += [{'id': f'e{n}', 'definition': wrap(element, [(a, 'physical', port['domain']), (b, 'physical', port['domain'])], el_mods, port['domain']), 'position': {'x': 0, 'y': 0}},
                   {'id': f'f{n}', 'definition': wrap(reference, [(ref_port, 'physical', port['domain'])], ref_mods, port['domain']), 'position': {'x': 0, 'y': 0}}]
        wires += [{'id': f'w{n}a', 'source': 'dut', 'sourceHandle': port['id'], 'target': f'e{n}', 'targetHandle': a},
                  {'id': f'w{n}b', 'source': f'e{n}', 'sourceHandle': b, 'target': f'f{n}', 'targetHandle': ref_port}]
    return Project.model_validate({'version': 1, 'name': data['kind'], 'duration': 0.01, 'revision': 0,
                                   'blocks': blocks, 'wires': wires})


def _block(ident, data):
    return {'id': ident, 'definition': data, 'position': {'x': 0, 'y': 0}}


def _w(n, a, ah, b, bh):
    return {'id': f'c{n}', 'source': a, 'sourceHandle': ah, 'target': b, 'targetHandle': bh}


E = 'electrical'
GROUND = wrap('Modelica.Electrical.Analog.Basic.Ground', [('p', 'physical', E)], {}, E)
SINE = wrap('Modelica.Electrical.Analog.Sources.SineVoltage', [('p', 'physical', E), ('n', 'physical', E)], {'V': '1', 'f': '50'}, E)


def R(value):
    return wrap('Modelica.Electrical.Analog.Basic.Resistor', [('p', 'physical', E), ('n', 'physical', E)], {'R': str(value)}, E)


T3 = 'threePhase'
SINE3 = wrap('Modelica.Electrical.Polyphase.Sources.SineVoltage', [('plug_p', 'physical', T3), ('plug_n', 'physical', T3)],
             {'V': 'fill(1, 3)', 'f': 'fill(50, 3)'}, T3)
R3 = wrap('Modelica.Electrical.Polyphase.Basic.Resistor', [('plug_p', 'physical', T3), ('plug_n', 'physical', T3)], {'R': 'fill(10, 3)'}, T3)
STAR = wrap('Modelica.Electrical.Polyphase.Basic.Star', [('plug_p', 'physical', T3), ('pin_n', 'physical', E)], {}, T3)


def _two_port(data):
    """Controlled sources: a sine source drives the input port through a resistor; a resistor loads the output."""
    blocks = [_block('dut', data), _block('src', SINE), _block('r1', R(10)), _block('r2', R(10)), _block('g', GROUND)]
    wires = [_w(1, 'src', 'p', 'dut', 'p1'), _w(2, 'dut', 'n1', 'r1', 'p'), _w(3, 'r1', 'n', 'g', 'p'),
             _w(4, 'src', 'n', 'g', 'p'), _w(5, 'dut', 'p2', 'r2', 'p'), _w(6, 'r2', 'n', 'g', 'p'), _w(7, 'dut', 'n2', 'g', 'p')]
    return blocks, wires


def _op_amp(data):
    """Inverting amplifier with a gain of −10."""
    blocks = [_block('dut', data), _block('src', SINE), _block('rin', R(1000)), _block('rf', R(10000)),
              _block('load', R(1000)), _block('g', GROUND)]
    wires = [_w(1, 'src', 'p', 'rin', 'p'), _w(2, 'rin', 'n', 'dut', 'in_n'), _w(3, 'dut', 'out', 'rf', 'p'),
             _w(4, 'rf', 'n', 'dut', 'in_n'), _w(5, 'dut', 'in_p', 'g', 'p'), _w(6, 'src', 'n', 'g', 'p'),
             _w(7, 'dut', 'out', 'load', 'p'), _w(8, 'load', 'n', 'g', 'p')]
    return blocks, wires


def _power_sensor(data):
    """The current path feeds a load; the voltage path measures across it."""
    blocks = [_block('dut', data), _block('src', SINE), _block('load', R(10)), _block('g', GROUND)]
    wires = [_w(1, 'src', 'p', 'dut', 'pc'), _w(2, 'dut', 'nc', 'load', 'p'), _w(3, 'load', 'n', 'g', 'p'),
             _w(4, 'src', 'n', 'g', 'p'), _w(5, 'dut', 'pv', 'dut', 'nc'), _w(6, 'dut', 'nv', 'g', 'p')]
    return blocks, wires


def _three_phase_supply(extra_blocks, extra_wires):
    blocks = [_block('src', SINE3), _block('star', STAR), _block('g', GROUND)] + extra_blocks
    wires = [_w(1, 'src', 'plug_n', 'star', 'plug_p'), _w(2, 'star', 'pin_n', 'g', 'p')] + extra_wires
    return blocks, wires


def _three_phase_through(data):
    """Sensors in series with a star-connected load; power sensors also measure the phase voltages."""
    blocks, wires = _three_phase_supply([_block('dut', data), _block('load', R3), _block('ls', STAR)], [
        _w(10, 'src', 'plug_p', 'dut', 'plug_p' if data['kind'] != 'threePhasePowerSensor' else 'pc'),
        _w(11, 'dut', 'plug_n' if data['kind'] != 'threePhasePowerSensor' else 'nc', 'load', 'plug_p'),
        _w(12, 'load', 'plug_n', 'ls', 'plug_p'), _w(13, 'ls', 'pin_n', 'g', 'p')])
    if data['kind'] == 'threePhasePowerSensor':
        wires += [_w(14, 'dut', 'pv', 'dut', 'nc'), _w(15, 'dut', 'nv', 'src', 'plug_n')]
    return blocks, wires


def _delta(data):
    """A resistor bank connected in delta across the supply."""
    return _three_phase_supply([_block('dut', data), _block('load', R3)], [
        _w(10, 'src', 'plug_p', 'load', 'plug_p'), _w(11, 'load', 'plug_n', 'dut', 'plug_p'),
        _w(12, 'dut', 'plug_n', 'load', 'plug_p')])


def _phase_tap(data):
    """One phase of the supply drives a single-phase load."""
    return _three_phase_supply([_block('dut', data), _block('load', R(10))], [
        _w(10, 'src', 'plug_p', 'dut', 'plug_p'), _w(11, 'dut', 'pin_p', 'load', 'p'), _w(12, 'load', 'n', 'g', 'p')])


# Blocks that only make sense inside a working circuit get one; the rest use the generic harness.
CIRCUITS = {'vcvs': _two_port, 'vccs': _two_port, 'ccvs': _two_port, 'cccs': _two_port, 'opAmp': _op_amp,
            'powerSensor': _power_sensor, 'delta': _delta, 'phaseA': _phase_tap, 'phaseB': _phase_tap,
            'phaseC': _phase_tap, 'threePhaseCurrentSensor': _three_phase_through,
            'threePhaseVoltageSensor': _three_phase_through, 'threePhasePowerSensor': _three_phase_through}


def circuit(data: dict) -> Project:
    if data['kind'] not in CIRCUITS:
        return harness(data)
    blocks, wires = CIRCUITS[data['kind']](data)
    covered = {(w['source'], w['sourceHandle']) for w in wires if w['source'] == 'dut'} | \
              {(w['target'], w['targetHandle']) for w in wires if w['target'] == 'dut'}
    # Sensor outputs stay open; every input is driven.
    for port in data['ports']:
        if port['direction'] == 'input' and ('dut', port['id']) not in covered:
            raise AssertionError(f'{data["kind"]}.{port["id"]} is not driven')
    return Project.model_validate({'version': 1, 'name': data['kind'], 'duration': 0.02, 'revision': 0,
                                   'blocks': blocks, 'wires': wires})


def test_harness_is_valid_for_every_block():
    for data in library():
        circuit(data)


@pytest.mark.integration
@pytest.mark.parametrize('data', library(), ids=lambda d: d['kind'])
def test_block_compiles_and_runs(data):
    result = asyncio.run(simulate(circuit(data), 'msl' + uuid.uuid4().hex[:12]))
    assert result['samples'] > 1


def _run(blocks, wires, duration):
    project = Project.model_validate({'version': 1, 'name': 'physics', 'duration': duration, 'revision': 0,
                                      'blocks': blocks, 'wires': wires})
    result = asyncio.run(simulate(project, 'phys' + uuid.uuid4().hex[:10]))
    return {s['key']: s['values'] for s in result['series']}


def _lib(kind):
    return next(d for d in library() if d['kind'] == kind)


@pytest.mark.integration
def test_spring_mass_settles_at_force_over_stiffness():
    blocks = [_block('wall', _lib('transFixed')), _block('k', _lib('transSpringDamper')), _block('m', _lib('mass')),
              _block('f', _lib('constantForce')), _block('s', _lib('positionSensor'))]
    wires = [_w(1, 'wall', 'flange', 'k', 'flange_a'), _w(2, 'k', 'flange_b', 'm', 'flange_a'),
             _w(3, 'f', 'flange', 'm', 'flange_b'), _w(4, 's', 'flange', 'm', 'flange_b')]
    # 1 N on 1000 N/m settles at 1 mm; damping 10 N·s/m on 1 kg settles well within 5 s.
    assert _run(blocks, wires, 5)['s.s'][-1] == pytest.approx(1e-3, rel=1e-3)


@pytest.mark.integration
def test_heat_capacitor_integrates_heat_flow():
    blocks = [_block('c', _lib('heatCapacitor')), _block('q', _lib('fixedHeatFlow')), _block('t', _lib('temperatureSensor'))]
    wires = [_w(1, 'q', 'port', 'c', 'port'), _w(2, 't', 'port', 'c', 'port')]
    values = _run(blocks, wires, 10)['t.T']
    # 10 W into 1000 J/K for 10 s raises the temperature by 0.1 K.
    assert values[-1] - values[0] == pytest.approx(0.1, rel=1e-3)


@pytest.mark.integration
def test_inverting_amplifier_has_gain_minus_ten():
    blocks, wires = _op_amp(_lib('opAmp'))
    sense = wrap('Modelica.Electrical.Analog.Sensors.VoltageSensor', [('p', 'physical', E), ('n', 'physical', E), ('v', 'output', 'signal')], {}, E)
    vin = wrap('Modelica.Electrical.Analog.Sensors.VoltageSensor', [('p', 'physical', E), ('n', 'physical', E), ('v', 'output', 'signal')], {}, E)
    blocks += [_block('vout', sense), _block('vin', vin)]
    wires += [_w(20, 'vout', 'p', 'dut', 'out'), _w(21, 'vout', 'n', 'g', 'p'), _w(22, 'vin', 'p', 'src', 'p'), _w(23, 'vin', 'n', 'g', 'p')]
    values = _run(blocks, wires, 0.02)
    for a, b in zip(values['vout.v'], values['vin.v']):
        assert a == pytest.approx(-10 * b, abs=1e-6)
