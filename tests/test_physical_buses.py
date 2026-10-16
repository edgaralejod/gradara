# SPDX-License-Identifier: Apache-2.0
"""Physical buses (server/physical_buses.py): elements with one name on one bus line join,
on a sheet and through subsystem ports; the problems a run refuses; engine runs."""
import asyncio
import uuid

import pytest

from server.diagnostics import SimulationFailure, validate_simulation
from server.engine import simulate
from server.modelica import emit_project
from server.models import Project
from server.physical_buses import lower_physical_buses, physical_bus_problems

E = 'electrical'


def msl(kind, cls, ports, params=(), modifiers=None, domain='signal'):
    return {'kind': kind, 'name': kind.title(), 'description': '', 'domain': domain, 'symbol': '', 'equations': '',
            'parameters': list(params), 'ports': [{'id': i, 'name': i, 'direction': d, 'domain': dom} for i, d, dom in ports],
            'modelica': {'class': cls, 'modifiers': modifiers or {}, 'ports': {}}}


GROUND = msl('ground', 'Modelica.Electrical.Analog.Basic.Ground', [('p', 'physical', E)], domain=E)
SOURCE = msl('dcSource', 'Modelica.Electrical.Analog.Sources.ConstantVoltage', [('p', 'physical', E), ('n', 'physical', E)],
             [{'id': 'V', 'name': 'Voltage', 'value': 10, 'unit': 'V'}], {'V': 'V'}, E)
RESISTOR = msl('resistor', 'Modelica.Electrical.Analog.Basic.Resistor', [('p', 'physical', E), ('n', 'physical', E)],
               [{'id': 'R', 'name': 'R', 'value': 2, 'unit': 'Ω'}], {'R': 'R'}, E)
SENSOR = msl('voltageSensor', 'Modelica.Electrical.Analog.Sensors.VoltageSensor',
             [('p', 'physical', E), ('n', 'physical', E), ('v', 'output', 'signal')], domain=E)
FIXED_T = msl('fixedTemperature', 'Modelica.Thermal.HeatTransfer.Sources.FixedTemperature', [('port', 'physical', 'thermal')],
              [{'id': 'T', 'name': 'T', 'value': 350, 'unit': 'K'}], {'T': 'T'}, 'thermal')
T_SENSOR = msl('temperatureSensor', 'Modelica.Thermal.HeatTransfer.Sensors.TemperatureSensor',
               [('port', 'physical', 'thermal'), ('T', 'output', 'signal')], domain='thermal')


def bus(*elements):
    """A Physical bus block definition with (name, domain) elements, IDs e1, e2, …"""
    ports = [{'id': f'e{i + 1}', 'name': n, 'direction': 'physical', 'domain': d, 'side': 'left'}
             for i, (n, d) in enumerate(elements)]
    ports.append({'id': 'bus', 'name': 'bus', 'direction': 'physical', 'domain': 'physicalBus', 'side': 'right'})
    return {'kind': 'physicalBus', 'name': 'Physical bus', 'description': '', 'domain': 'physicalBus', 'symbol': 'bus',
            'equations': '', 'parameters': [], 'ports': ports, 'category': 'routing'}


def at(ident, definition, x=0, y=0):
    return {'id': ident, 'definition': definition, 'position': {'x': x, 'y': y}}


def wire(ident, a, ah, b, bh):
    return {'id': ident, 'source': a, 'sourceHandle': ah, 'target': b, 'targetHandle': bh}


def flat_document():
    """A 10 V source's + and − and a fixed temperature ride one bus to a 2 Ω load, a
    voltage sensor, and a temperature sensor; the elements are listed in another order
    on the far end."""
    return {'version': 1, 'name': 'Flat bus', 'duration': 0.1, 'revision': 0,
            'blocks': [at('src', SOURCE), at('hot', FIXED_T, 0, 100), at('b1', bus(('pos', E), ('neg', E), ('heat', 'thermal')), 100),
                       at('b2', bus(('heat', 'thermal'), ('pos', E), ('neg', E)), 300), at('r', RESISTOR, 400),
                       at('vs', SENSOR, 400, 100), at('ts', T_SENSOR, 400, 200), at('gnd', GROUND, 0, 200)],
            'junctions': [{'id': 'j', 'position': {'x': 200, 'y': 0}, 'domain': 'physicalBus'}],
            'wires': [wire('a', 'src', 'p', 'b1', 'e1'), wire('b', 'src', 'n', 'b1', 'e2'), wire('c', 'hot', 'port', 'b1', 'e3'),
                      wire('d', 'src', 'n', 'gnd', 'p'),
                      wire('bus1', 'b1', 'bus', 'j', 'node'), wire('bus2', 'j', 'node', 'b2', 'bus'),
                      wire('e', 'b2', 'e2', 'r', 'p'), wire('f', 'b2', 'e3', 'r', 'n'),
                      wire('g', 'b2', 'e2', 'vs', 'p'), wire('h', 'b2', 'e3', 'vs', 'n'),
                      wire('i', 'b2', 'e1', 'ts', 'port')]}


def nested_document():
    """The same load inside a subsystem, reached through a physical bus port."""
    inside = {'id': 'load', 'name': 'Load',
              'blocks': [at('port', {'kind': 'connport', 'name': 'supply', 'description': '', 'domain': 'physicalBus',
                                     'symbol': '⊙', 'equations': '', 'parameters': [], 'category': 'routing',
                                     'boundary': {'order': 0},
                                     'ports': [{'id': 'p', 'name': 'supply', 'direction': 'physical',
                                                'domain': 'physicalBus', 'side': 'right'}]}),
                         at('split', bus(('pos', E), ('neg', E)), 100), at('r', RESISTOR, 200), at('vs', SENSOR, 200, 100)],
              'wires': [wire('w0', 'port', 'p', 'split', 'bus'), wire('w1', 'split', 'e1', 'r', 'p'),
                        wire('w2', 'split', 'e2', 'r', 'n'), wire('w3', 'split', 'e1', 'vs', 'p'),
                        wire('w4', 'split', 'e2', 'vs', 'n')]}
    instance = {'kind': 'subsystem', 'name': 'Load', 'description': '', 'domain': 'electrical', 'symbol': '',
                'equations': '', 'parameters': [], 'subsystem': {'ref': 'load'},
                'ports': [{'id': 'port', 'name': 'supply', 'direction': 'physical', 'domain': 'physicalBus', 'side': 'left'}]}
    return {'version': 2, 'name': 'Nested bus', 'duration': 0.1, 'revision': 0, 'subsystems': [inside],
            'blocks': [at('src', SOURCE), at('gnd', GROUND, 0, 200), at('b1', bus(('pos', E), ('neg', E), ('spare', 'thermal')), 100),
                       at('load', instance, 300)],
            'wires': [wire('a', 'src', 'p', 'b1', 'e1'), wire('b', 'src', 'n', 'b1', 'e2'), wire('d', 'src', 'n', 'gnd', 'p'),
                      wire('bus', 'b1', 'bus', 'load', 'port')]}


def test_elements_with_one_name_join_across_a_bus_line():
    project = Project.model_validate(flat_document())
    assert physical_bus_problems(project) == []
    lowered = lower_physical_buses(project)
    assert not any(b.definition.kind == 'physicalBus' for b in lowered.blocks)
    assert not any(j.domain == 'physicalBus' for j in lowered.junctions)
    source = emit_project(project)
    assert 'physicalBus' not in source and 'b1' not in source and 'b2' not in source
    # src.p reaches r.p and vs.p; src.n reaches r.n; the heat reaches the sensor.
    assert 'connect(src.p, r.p);' in source or 'connect(r.p, src.p);' in source
    assert 'ts.port' in source and 'hot.port' in source


def test_lowering_leaves_the_document_unchanged_and_a_plain_one_alone():
    project = Project.model_validate(flat_document())
    before = project.model_dump()
    lower_physical_buses(project)
    assert project.model_dump() == before
    plain = Project.model_validate({'version': 1, 'name': 'Plain', 'duration': 1, 'revision': 0,
                                    'blocks': [at('g', GROUND)], 'wires': []})
    assert lower_physical_buses(plain) is plain


def test_a_bus_port_carries_the_elements_its_inside_uses():
    project = Project.model_validate(nested_document())
    assert physical_bus_problems(project) == []
    source = emit_project(project)
    inside = source[source.index('model Sub_load'):source.index('end Sub_load;')]
    assert 'Modelica.Electrical.Analog.Interfaces.Pin port__pos;' in inside
    assert 'Modelica.Electrical.Analog.Interfaces.Pin port__neg;' in inside
    # The spare element is not used inside, so the subsystem gets no terminal for it.
    assert 'spare' not in inside
    assert 'load.port__pos' in source and 'load.port__neg' in source


def test_one_name_two_domains_and_duplicate_names_are_problems():
    doc = flat_document()
    doc['blocks'][3]['definition'] = bus(('heat', E), ('pos', E), ('neg', E))
    doc['wires'] = [w for w in doc['wires'] if w['id'] != 'i']
    problems = physical_bus_problems(Project.model_validate(doc))
    assert [p['message'] for p in problems] == [
        'The physical bus carries heat as thermal on one end and electrical on the other.']
    assert problems[0]['blockIds'] == ['b1', 'b2']
    with pytest.raises(SimulationFailure, match='Fix these physical buses'):
        validate_simulation(Project.model_validate(doc))
    doc = flat_document()
    doc['blocks'][2]['definition'] = bus(('pos', E), ('pos', E), ('heat', 'thermal'))
    assert physical_bus_problems(Project.model_validate(doc))[0]['message'] == 'Physical bus: Two elements are named pos.'


def _series(result, key):
    return next(s['values'] for s in result['series'] if s['key'] == key)


@pytest.mark.integration
def test_engine_runs_a_circuit_and_a_heat_port_through_a_bus():
    result = asyncio.run(simulate(Project.model_validate(flat_document()), 'pbus' + uuid.uuid4().hex[:12]))
    assert _series(result, 'vs.v')[-1] == pytest.approx(10)
    assert _series(result, 'ts.T')[-1] == pytest.approx(350)


@pytest.mark.integration
def test_engine_runs_a_load_through_a_subsystem_bus_port():
    result = asyncio.run(simulate(Project.model_validate(nested_document()), 'pbusnest' + uuid.uuid4().hex[:12]))
    assert _series(result, 'load.vs.v')[-1] == pytest.approx(10)


def _harness(boundary_a='hin', boundary_b='hout'):
    """A subsystem whose two bus ports are wired straight to each other."""
    def port(ident, name, order):
        return at(ident, {'kind': 'connport', 'name': name, 'description': '', 'domain': 'physicalBus', 'symbol': '⊙',
                          'equations': '', 'parameters': [], 'category': 'routing', 'boundary': {'order': order},
                          'ports': [{'id': 'p', 'name': name, 'direction': 'physical', 'domain': 'physicalBus',
                                     'side': 'right'}]})
    inside = {'id': 'harness', 'name': 'Harness', 'blocks': [port(boundary_a, 'in', 0), port(boundary_b, 'out', 1)],
              'wires': [wire('w', boundary_a, 'p', boundary_b, 'p')]}
    instance = {'kind': 'subsystem', 'name': 'Harness', 'description': '', 'domain': 'electrical', 'symbol': '',
                'equations': '', 'parameters': [], 'subsystem': {'ref': 'harness'},
                'ports': [{'id': boundary_a, 'name': 'in', 'direction': 'physical', 'domain': 'physicalBus', 'side': 'left'},
                          {'id': boundary_b, 'name': 'out', 'direction': 'physical', 'domain': 'physicalBus',
                           'side': 'right'}]}
    return {'version': 2, 'name': 'Harness', 'duration': 0.1, 'revision': 0, 'subsystems': [inside],
            'blocks': [at('src', SOURCE), at('gnd', GROUND), at('b1', bus(('pos', E), ('neg', E))), at('h', instance),
                       at('b2', bus(('pos', E), ('neg', E))), at('r', RESISTOR)],
            'wires': [wire('a', 'src', 'p', 'b1', 'e1'), wire('b', 'src', 'n', 'b1', 'e2'), wire('c', 'src', 'n', 'gnd', 'p'),
                      wire('d', 'b1', 'bus', 'h', boundary_a), wire('e', 'h', boundary_b, 'b2', 'bus'),
                      wire('f', 'b2', 'e1', 'r', 'p'), wire('g', 'b2', 'e2', 'r', 'n')]}


def test_bus_ports_joined_straight_through_are_a_problem_not_an_open_circuit():
    problems = physical_bus_problems(Project.model_validate(_harness()))
    assert [p['message'] for p in problems] == ['The bus ports in and out are joined straight through, so they carry nothing.']
    assert problems[0]['blockIds'] == ['hin', 'hout'] and problems[0]['sheet'] == 'harness'


def test_hidden_terminals_never_collide_with_each_other_or_existing_ids():
    # A bus port whose readable hidden IDs would be cut to the same 60 characters.
    long_id = 'p' + 'x' * 58
    doc = nested_document()
    inside = doc['subsystems'][0]
    inside['blocks'][0]['id'] = long_id
    inside['wires'][0]['source'] = long_id
    inside['blocks'][1]['definition'] = bus(('alpha_one', E), ('alpha_two', E))
    doc['blocks'][2]['definition'] = bus(('alpha_one', E), ('alpha_two', E), ('spare', 'thermal'))
    doc['blocks'][3]['definition']['ports'][0]['id'] = long_id
    doc['wires'][-1]['targetHandle'] = long_id
    source = emit_project(Project.model_validate(doc))
    inside_src = source[source.index('model Sub_load'):source.index('end Sub_load;')]
    pins = [line for line in inside_src.splitlines() if 'Interfaces.Pin' in line]
    assert len(pins) == 2 and len(set(pins)) == 2
    # A readable hidden ID already in use inside gets another.
    doc = nested_document()
    doc['subsystems'][0]['blocks'].append(at('port__pos', GROUND, 300))
    source = emit_project(Project.model_validate(doc))
    assert source.count('Interfaces.Pin port__pos;') == 0
    assert 'connect(load.port__pos' not in source


def test_a_name_with_a_trailing_newline_is_invalid():
    doc = flat_document()
    doc['blocks'][2]['definition'] = bus(('pos\n', E), ('neg', E), ('heat', 'thermal'))
    messages = [p['message'] for p in physical_bus_problems(Project.model_validate(doc))]
    assert messages and 'is not a valid name' in messages[0]
