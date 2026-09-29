"""Signal buses on the server (server/buses.py): array connectors, bus block
equations generated from ports, the checks that refuse inconsistent widths, and
results expanded to one series per signal."""
import asyncio
import json
from pathlib import Path
import uuid
import pytest
from server.buses import bus_equations, bus_problems
from server.diagnostics import SimulationFailure, validate_simulation
from server.engine import simulate
from server.modelica import emit_project
from server.models import Definition, Port, Project

EXAMPLES = Path(__file__).parents[1]/'models/examples/blocks'


def example(name: str) -> dict:
    return json.loads((EXAMPLES/f'{name}.json').read_text(encoding='utf-8'))


def port(id, direction, width=None, elements=None, name=None):
    return Port(id=id, name=name or id, direction=direction, domain='signal', width=width, elements=elements)


def definition(kind, ports):
    return Definition(kind=kind, name=kind, description='', domain='signal', symbol='', ports=ports,
                      parameters=[], equations='')


def test_bus_equations_match_the_editor():
    mux = definition('mux', [port('u1', 'input'), port('u2', 'input', 2), port('y', 'output', 3)])
    assert bus_equations(mux) == 'y = cat(1, {u1}, u2);'
    demux = definition('demux', [port('u', 'input', 4), port('y1', 'output', 2), port('y2', 'output', 2)])
    assert bus_equations(demux) == 'y1 = u[1:2];\ny2 = u[3:4];'
    bus = port('u', 'input', 3, ['motor.speed', 'motor.current', 'load'])
    selector = definition('busSelector', [bus, port('y1', 'output', name='load'), port('y2', 'output', 2, name='motor')])
    assert bus_equations(selector) == 'y1 = u[3];\ny2 = u[{1, 2}];'


def test_a_bus_port_is_an_array_connector():
    source = emit_project(Project.model_validate(example('buses')))
    assert 'Modelica.Blocks.Interfaces.RealOutput y[3];' in source
    assert 'y = {u1, u2, u3};' in source
    assert 'y1 = u[1];' in source and 'y2 = u[3];' in source


def test_stored_equations_are_not_trusted_for_bus_blocks():
    doc = example('buses')
    sensors = next(b for b in doc['blocks'] if b['id'] == 'sensors')
    sensors['definition']['equations'] = 'y = {0, 0, 0};'
    assert 'y = {u1, u2, u3};' in emit_project(Project.model_validate(doc))


def test_a_bus_into_a_one_signal_input_is_refused():
    doc = example('buses')
    doc['wires'] = [w for w in doc['wires'] if w['target'] != 'scale']
    doc['wires'].append({'id': 'bad', 'source': 'sensors', 'sourceHandle': 'y', 'target': 'scale', 'targetHandle': 'u'})
    doc['nets'] = None
    project = Project.model_validate(doc)
    [problem] = [p for p in bus_problems(project) if p['blockId'] == 'scale']
    assert 'takes one signal, but Sensors sends a bus of 3' in problem['message']
    with pytest.raises(SimulationFailure, match='Fix these signal buses'):
        validate_simulation(project)


def test_stale_widths_are_refused():
    doc = example('buses')
    sensors = next(b for b in doc['blocks'] if b['id'] == 'sensors')
    sensors['definition']['ports'][0]['name'] = 'velocity'  # renamed without the editor
    messages = [p['message'] for p in bus_problems(Project.model_validate(doc))]
    assert any('do not match its inputs' in m for m in messages), messages


def test_elements_must_match_the_width():
    with pytest.raises(ValueError, match='names 2 bus elements but carries 3'):
        port('y', 'output', 3, ['a', 'b'])
    with pytest.raises(ValueError, match='only signal ports'):
        Port(id='y', name='y', direction='output', domain='boolean', width=2)


def through_subsystem() -> Project:
    """The Signal buses example with its Bus Selector moved into a subsystem."""
    doc = example('buses')
    pick = next(b for b in doc['blocks'] if b['id'] == 'pick')
    bus = next(p for p in pick['definition']['ports'] if p['id'] == 'u')
    signal = {k: bus[k] for k in ('width', 'elements')}

    def boundary(id, kind, order, inner):
        return {'id': id, 'position': {'x': 0, 'y': 0}, 'definition': {
            'kind': kind, 'name': id, 'description': '', 'domain': 'signal', 'symbol': str(order + 1),
            'ports': [inner], 'parameters': [], 'equations': '', 'category': 'routing', 'boundary': {'order': order}}}
    inside = {
        'id': 'sub_unpack', 'name': 'Unpack',
        'blocks': [boundary('bin', 'inport', 0, {'id': 'y', 'name': 'bin', 'direction': 'output', 'domain': 'signal', **signal}),
                   pick,
                   boundary('speed_out', 'outport', 1, {'id': 'u', 'name': 'speed_out', 'direction': 'input', 'domain': 'signal'}),
                   boundary('current_out', 'outport', 2, {'id': 'u', 'name': 'current_out', 'direction': 'input', 'domain': 'signal'})],
        'wires': [{'id': 'w1', 'source': 'bin', 'sourceHandle': 'y', 'target': 'pick', 'targetHandle': 'u'},
                  {'id': 'w2', 'source': 'pick', 'sourceHandle': 'y1', 'target': 'speed_out', 'targetHandle': 'u'},
                  {'id': 'w3', 'source': 'pick', 'sourceHandle': 'y2', 'target': 'current_out', 'targetHandle': 'u'}],
    }
    instance = {'id': 'unpack', 'position': {'x': 0, 'y': 0}, 'definition': {
        'kind': 'subsystem', 'name': 'Unpack', 'description': '', 'domain': 'signal', 'symbol': 'Unpack',
        'parameters': [], 'equations': '', 'category': 'routing', 'subsystem': {'ref': 'sub_unpack'},
        'ports': [{'id': 'bin', 'name': 'bin', 'direction': 'input', 'domain': 'signal', **signal},
                  {'id': 'speed_out', 'name': 'speed_out', 'direction': 'output', 'domain': 'signal'},
                  {'id': 'current_out', 'name': 'current_out', 'direction': 'output', 'domain': 'signal'}]}}
    doc['blocks'] = [b for b in doc['blocks'] if b['id'] != 'pick'] + [instance]
    doc['wires'] = [w for w in doc['wires'] if 'pick' not in (w['source'], w['target'])] + [
        {'id': 'wa', 'source': 'sensors', 'sourceHandle': 'y', 'target': 'unpack', 'targetHandle': 'bin'},
        {'id': 'wb', 'source': 'unpack', 'sourceHandle': 'speed_out', 'target': 'scale', 'targetHandle': 'u'}]
    doc['nets'], doc['junctions'], doc['plots'] = None, [], []
    doc['subsystems'], doc['version'] = [inside], 2
    return Project.model_validate(doc)


def test_a_bus_passes_through_a_subsystem_port():
    project = through_subsystem()
    assert bus_problems(project) == [] and bus_problems(project.subsystems[0]) == []
    source = emit_project(project)
    assert 'Modelica.Blocks.Interfaces.RealInput bin[3];' in source


@pytest.mark.integration
def test_bus_results_through_a_subsystem():
    project = through_subsystem()
    result = asyncio.run(simulate(project, f'test-bus-{uuid.uuid4().hex[:8]}'))
    series = {s['key']: s for s in result['series']}
    # The bus output is expanded into one named series per signal.
    assert series['sensors.y[1]']['name'] == 'Sensors.bus.speed'
    assert series['sensors.y[3]']['name'] == 'Sensors.bus.current'
    assert abs(series['scale.y']['values'][-1] - 2) < 1e-6  # 0.5 × speed 4
    assert abs(series['unpack.speed_out']['values'][-1] - 4) < 1e-6
