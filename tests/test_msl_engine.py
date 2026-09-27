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
    src = (ROOT/'lib'/'gradara'/'msl-blocks.ts').read_text()
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


def test_harness_is_valid_for_every_block():
    for data in library():
        harness(data)


@pytest.mark.integration
@pytest.mark.parametrize('data', library(), ids=lambda d: d['kind'])
def test_block_compiles_and_runs(data):
    result = asyncio.run(simulate(harness(data), 'msl' + uuid.uuid4().hex[:12]))
    assert result['samples'] > 1
