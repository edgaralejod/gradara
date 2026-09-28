# SPDX-License-Identifier: Apache-2.0
"""Subsystems in document version 2: structure checks and nested emission."""
import copy

import pytest
from pydantic import ValidationError

from server.diagnostics import SimulationFailure, validate_simulation
from server.hierarchy import instances
from server.modelica import emit_project
from server.models import Project


def msl(kind, cls, ports, params=(), modifiers=None, domain='signal'):
    return {'kind': kind, 'name': kind.title(), 'description': '', 'domain': domain, 'symbol': '', 'equations': '',
            'parameters': list(params), 'ports': [{'id': i, 'name': i, 'direction': d, 'domain': dom} for i, d, dom in ports],
            'modelica': {'class': cls, 'modifiers': modifiers or {}}}


def boundary(kind, name, domain='signal', order=0):
    port = {'inport': ('y', 'output'), 'outport': ('u', 'input'), 'connport': ('p', 'physical')}[kind]
    return {'kind': kind, 'name': name, 'description': '', 'domain': domain, 'symbol': '', 'equations': '', 'parameters': [],
            'ports': [{'id': port[0], 'name': name, 'direction': port[1], 'domain': domain}], 'boundary': {'order': order}}


def at(ident, definition, x=0, y=0):
    return {'id': ident, 'definition': definition, 'position': {'x': x, 'y': y}}


def wire(ident, a, ah, b, bh):
    return {'id': ident, 'source': a, 'sourceHandle': ah, 'target': b, 'targetHandle': bh}


GAIN = msl('gain', 'Modelica.Blocks.Math.Gain', [('u', 'input', 'signal'), ('y', 'output', 'signal')],
           [{'id': 'k', 'name': 'Gain', 'value': 3, 'unit': ''}], {'k': 'k'})
STEP = msl('step', 'Modelica.Blocks.Sources.Step', [('y', 'output', 'signal')])


def document():
    inner = {'id': 'amp', 'name': 'Amplifier', 'parameters': [
                {'id': 'gain', 'name': 'Gain', 'value': 5, 'unit': '', 'targets': [{'blockId': 'g', 'parameterId': 'k'}]}],
             'blocks': [at('in1', boundary('inport', 'x')), at('g', GAIN, 100), at('out1', boundary('outport', 'y'), 200)],
             'wires': [wire('a', 'in1', 'y', 'g', 'u'), wire('b', 'g', 'y', 'out1', 'u')]}
    instance = {'kind': 'subsystem', 'name': 'Amplifier', 'description': '', 'domain': 'signal', 'symbol': '', 'equations': '',
                'parameters': [{'id': 'gain', 'name': 'Gain', 'value': 7, 'unit': ''}],
                'ports': [{'id': 'in1', 'name': 'x', 'direction': 'input', 'domain': 'signal'},
                          {'id': 'out1', 'name': 'y', 'direction': 'output', 'domain': 'signal'}],
                'subsystem': {'ref': 'amp'}}
    return {'version': 2, 'name': 'Nested', 'duration': 1, 'revision': 0, 'subsystems': [inner],
            'blocks': [at('src', STEP), at('a1', instance, 100), at('sink', GAIN, 200)],
            'wires': [wire('w1', 'src', 'y', 'a1', 'in1'), wire('w2', 'a1', 'out1', 'sink', 'u')]}


def test_nested_emission():
    source = emit_project(Project.model_validate(document()))
    assert 'model Sub_amp\n  parameter Real par_gain = 5;\n  Modelica.Blocks.Interfaces.RealInput in1;' in source
    assert '  Modelica.Blocks.Math.Gain g(k=(par_gain));' in source
    assert '  Modelica.Blocks.Interfaces.RealOutput out1;' in source
    assert 'connect(in1, g.u);' in source and 'connect(g.y, out1);' in source
    assert '  Sub_amp a1(par_gain=7);' in source
    assert 'connect(a1.out1, sink.u);' in source and 'connect(src.y, a1.in1);' in source


def test_instances_walk_into_subsystems():
    walked = [(prefix, block.id, top) for prefix, _, block, top in instances(Project.model_validate(document()))]
    assert ('a1.', 'g', 'a1') in walked and ('', 'sink', 'sink') in walked


@pytest.mark.parametrize('change, message', [
    (lambda d: d.update(version=1), 'version 2'),
    (lambda d: d['blocks'][1]['definition']['subsystem'].update(ref='nope'), 'missing subsystem'),
    (lambda d: d['subsystems'][0]['blocks'].pop(2) and d['subsystems'][0]['wires'].pop(1), 'out of date'),
    (lambda d: d['subsystems'][0]['parameters'][0]['targets'][0].update(parameterId='zzz'), 'does not exist'),
    (lambda d: d['blocks'].append(at('stray', boundary('inport', 'stray'))), 'inside a subsystem'),
])
def test_structure_errors(change, message):
    data = document()
    change(data)
    with pytest.raises(ValidationError, match=message):
        Project.model_validate(data)


def test_a_subsystem_cannot_contain_itself():
    data = document()
    inner_instance = copy.deepcopy(data['blocks'][1])
    inner_instance['id'] = 'self'
    data['subsystems'][0]['blocks'].append(inner_instance)
    data['subsystems'][0]['wires'] += [wire('c', 'in1', 'y', 'self', 'in1')]
    with pytest.raises(ValidationError, match='contain itself'):
        Project.model_validate(data)


def test_unconnected_inputs_inside_a_subsystem_are_reported():
    data = document()
    data['subsystems'][0]['wires'].pop(0)
    with pytest.raises(SimulationFailure, match='Connect these signal inputs'):
        validate_simulation(Project.model_validate(data))


def test_version_1_documents_serialize_without_subsystems():
    data = document()
    data.update(version=1, subsystems=None, blocks=[at('src', STEP)], wires=[])
    assert 'subsystems' not in Project.model_validate(data).model_dump(exclude_none=True)


FIXTURE = __import__('pathlib').Path(__file__).with_name('fixtures')/'grouped-dc.json'


def test_document_grouped_by_the_workbench_is_accepted_and_nests():
    project = Project.model_validate_json(FIXTURE.read_text(encoding='utf-8'))
    source = emit_project(project)
    assert source.count('\nmodel Sub_') == 2
    top = [b for b in project.blocks if b.definition.subsystem]
    assert len(top) == 1 and f'  Sub_{top[0].definition.subsystem.ref} {top[0].id}' in source


@pytest.mark.integration
def test_grouped_model_simulates_like_the_flat_one():
    import asyncio
    import uuid
    from pathlib import Path
    from server.engine import simulate
    flat = Project.model_validate_json((Path(__file__).parent.parent/'models'/'examples'/'dc.json').read_text(encoding='utf-8'))
    nested = Project.model_validate_json(FIXTURE.read_text(encoding='utf-8'))

    async def both():
        return await asyncio.gather(simulate(flat, 'flat' + uuid.uuid4().hex[:10]),
                                    simulate(nested, 'nest' + uuid.uuid4().hex[:10]))
    a, b = asyncio.run(both())
    speed = lambda r: next(o for o in r['series'] if o['key'] == 'sensor.y')['values'][-1]
    assert speed(b) == pytest.approx(speed(a), rel=1e-6)
