# SPDX-License-Identifier: Apache-2.0
"""Units of result signals: declared by the block, or inferred along the wiring (server/units.py)."""
import json
from pathlib import Path

from server.models import Project
from server.units import port_units, signal_units

ROOT = Path(__file__).resolve().parent.parent


def load(name: str) -> Project:
    return Project.model_validate_json((ROOT/'models'/'examples'/name).read_text(encoding='utf-8'))


def test_dc_example_signals_carry_engineering_units():
    units = signal_units(load('dc.json'))
    # The sensor reads rad/s; the setpoint shares the measurement's unit; the
    # controller drives a voltage source, so its output is in volts (B03).
    assert units['sensor.y'] == 'rad/s'
    assert units['reference.y'] == 'rad/s'
    assert units['controller.reference'] == units['controller.measured'] == 'rad/s'
    assert units['controller.y'] == 'V'


def test_units_come_from_the_shared_table_for_older_documents():
    project = load('dc.json')
    sensor = next(b for b in project.blocks if b.id == 'sensor')
    assert all(not p.unit for p in sensor.definition.ports), 'the example predates port units'
    assert port_units()['sensor']['y'] == 'rad/s'
    assert port_units()['temperatureSensor']['T'] == 'K'
    assert port_units()['powerSensor']['power'] == 'W'


def test_conflicting_quantities_get_no_unit():
    # A sum of a current and a voltage sensor (nonsense, but possible): the sum's
    # ports could be either quantity, so they stay without a unit rather than wrong.
    doc = json.loads((ROOT/'models'/'examples'/'dc.json').read_text(encoding='utf-8'))
    project = Project.model_validate(doc)
    from server.models import Block, Definition, Port, Wire, Position
    def signal(kind, ports):
        return Block(id=kind, position=Position(x=0, y=0), definition=Definition(
            kind=kind, name=kind, description='', symbol='', domain='signal', ports=[Port(id=i, name=i, direction=d, domain='signal') for i, d in ports],
            parameters=[], equations=''))
    project.blocks += [signal('voltageSensor', [('y', 'output')]), signal('currentSensor', [('y', 'output')]),
                       signal('sum', [('a', 'input'), ('b', 'input'), ('y', 'output')])]
    project.wires += [Wire(id='w1', source='voltageSensor', sourceHandle='y', target='sum', targetHandle='a'),
                      Wire(id='w2', source='currentSensor', sourceHandle='y', target='sum', targetHandle='b')]
    units = signal_units(project)
    assert 'sum.y' not in units and 'sum.a' not in units
    assert units['controller.y'] == 'V'


def test_units_follow_a_signal_into_and_out_of_a_subsystem():
    units = signal_units(load('ev.json'))
    # Whatever the EV example groups, no inferred unit contradicts a declared one.
    project = load('ev.json')
    from server.hierarchy import instances
    for prefix, _, block, _ in instances(project):
        for p in block.definition.ports:
            if p.unit:
                assert units.get(f'{prefix}{block.id}.{p.id}', p.unit) == p.unit
