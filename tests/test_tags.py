# SPDX-License-Identifier: Apache-2.0
"""Goto/From tags and connection labels (server/tags.py): resolution down a hierarchy,
the problems a run refuses, and engine runs that prove the joins are real."""
import asyncio
import uuid

import pytest

from server.diagnostics import SimulationFailure, validate_simulation
from server.engine import simulate
from server.modelica import emit_project
from server.models import Project
from server.tags import lower_tags, tag_problems
from tests.recording import log_outputs


def msl(kind, cls, ports, params=(), modifiers=None, domain='signal'):
    return {'kind': kind, 'name': kind.title(), 'description': '', 'domain': domain, 'symbol': '', 'equations': '',
            'parameters': list(params), 'ports': [{'id': i, 'name': i, 'direction': d, 'domain': dom} for i, d, dom in ports],
            'modelica': {'class': cls, 'modifiers': modifiers or {}, 'ports': {}}}


def tag(kind, value, domain='signal'):
    port = {'goto': ('u', 'input'), 'from': ('y', 'output'), 'connectionLabel': ('p', 'physical')}[kind]
    return {'kind': kind, 'name': kind.title(), 'description': '', 'domain': domain, 'symbol': value or '',
            'equations': '', 'parameters': [], 'tag': value,
            'ports': [{'id': port[0], 'name': port[0], 'direction': port[1], 'domain': domain}]}


def at(ident, definition, x=0, y=0):
    return {'id': ident, 'definition': definition, 'position': {'x': x, 'y': y}}


def wire(ident, a, ah, b, bh):
    return {'id': ident, 'source': a, 'sourceHandle': ah, 'target': b, 'targetHandle': bh}


def instance(ref, name='Inside'):
    return {'kind': 'subsystem', 'name': name, 'description': '', 'domain': 'signal', 'symbol': '', 'equations': '',
            'parameters': [], 'ports': [], 'subsystem': {'ref': ref}}


CONST = msl('constant', 'Modelica.Blocks.Sources.Constant', [('y', 'output', 'signal')],
            [{'id': 'k', 'name': 'Value', 'value': 2, 'unit': ''}], {'k': 'k'})


def gain(k):
    return msl('gain', 'Modelica.Blocks.Math.Gain', [('u', 'input', 'signal'), ('y', 'output', 'signal')],
               [{'id': 'k', 'name': 'Gain', 'value': k, 'unit': ''}], {'k': 'k'})


E = 'electrical'
GROUND = msl('ground', 'Modelica.Electrical.Analog.Basic.Ground', [('p', 'physical', E)], domain=E)
SOURCE = msl('dcSource', 'Modelica.Electrical.Analog.Sources.ConstantVoltage', [('p', 'physical', E), ('n', 'physical', E)],
             [{'id': 'V', 'name': 'Voltage', 'value': 10, 'unit': 'V'}], {'V': 'V'}, E)
RESISTOR = msl('resistor', 'Modelica.Electrical.Analog.Basic.Resistor', [('p', 'physical', E), ('n', 'physical', E)],
               [{'id': 'R', 'name': 'R', 'value': 1, 'unit': 'Ω'}], {'R': 'R'}, E)
SENSOR = msl('voltageSensor', 'Modelica.Electrical.Analog.Sensors.VoltageSensor',
             [('p', 'physical', E), ('n', 'physical', E), ('v', 'output', 'signal')], domain=E)


def signals_document():
    """A constant goes to [A] at the top; a From [A] at the top and one inside a subsystem
    (two levels down, through a subsystem that has no From of its own) read it."""
    deep = {'id': 'deep', 'name': 'Deep', 'blocks': [at('f', tag('from', 'A')), at('g', gain(3), 100)],
            'wires': [wire('w', 'f', 'y', 'g', 'u')]}
    middle = {'id': 'middle', 'name': 'Middle', 'blocks': [at('d', instance('deep', 'Deep'))], 'wires': []}
    return {'version': 2, 'name': 'Tags', 'duration': 0.1, 'revision': 0, 'subsystems': [deep, middle],
            'blocks': [at('c', CONST), at('to', tag('goto', 'A'), 100), at('back', tag('from', 'A'), 0, 100),
                       at('g', gain(5), 100, 100), at('m', instance('middle', 'Middle'), 200, 100)],
            'wires': [wire('w1', 'c', 'y', 'to', 'u'), wire('w2', 'back', 'y', 'g', 'u')]}


def physical_document():
    """A 10 V source between the label [P] and ground at the top; inside a subsystem, a
    label [P] feeds a 1 Ω resistor to ground and a voltage sensor."""
    inside = {'id': 'load', 'name': 'Load',
              'blocks': [at('lp', tag('connectionLabel', 'P', E)), at('r', RESISTOR, 100), at('gnd', GROUND, 200),
                         at('vs', SENSOR, 100, 100)],
              'wires': [wire('a', 'lp', 'p', 'r', 'p'), wire('b', 'r', 'n', 'gnd', 'p'), wire('c', 'lp', 'p', 'vs', 'p'),
                        wire('d', 'vs', 'n', 'gnd', 'p')]}
    return {'version': 2, 'name': 'Labels', 'duration': 0.1, 'revision': 0, 'subsystems': [inside],
            'blocks': [at('src', SOURCE), at('top', tag('connectionLabel', 'P', E), 100), at('gnd', GROUND, 0, 100),
                       at('load', instance('load', 'Load'), 200)],
            'wires': [wire('w1', 'src', 'p', 'top', 'p'), wire('w2', 'src', 'n', 'gnd', 'p')]}


def test_a_from_reads_the_goto_on_its_sheet_and_from_sheets_above():
    project = Project.model_validate(signals_document())
    assert tag_problems(project) == []
    source = emit_project(project)
    # No tag block reaches the Modelica source; the deep sheet and the one between get a hidden input.
    assert 'Goto' not in source and ' to;' not in source
    deep = source[source.index('model Sub_deep'):source.index('end Sub_deep;')]
    middle = source[source.index('model Sub_middle'):source.index('end Sub_middle;')]
    assert '  Modelica.Blocks.Interfaces.RealInput tag_in_A;' in deep and 'connect(tag_in_A, g.u);' in deep
    assert '  Modelica.Blocks.Interfaces.RealInput tag_in_A;' in middle
    assert 'connect(tag_in_A, d.tag_in_A);' in middle
    assert 'connect(c.y, m.tag_in_A);' in source and 'connect(c.y, g.u);' in source


def test_lowering_leaves_the_document_unchanged_and_a_plain_one_alone():
    project = Project.model_validate(signals_document())
    before = project.model_dump()
    lower_tags(project)
    assert project.model_dump() == before
    plain = Project.model_validate({'version': 1, 'name': 'Plain', 'duration': 1, 'revision': 0,
                                    'blocks': [at('c', CONST)], 'wires': []})
    assert lower_tags(plain) is plain


def test_a_goto_inside_a_subsystem_is_not_seen_outside_it():
    inside = {'id': 'sub', 'name': 'Sub', 'blocks': [at('c', CONST), at('to', tag('goto', 'B'), 100)],
              'wires': [wire('w', 'c', 'y', 'to', 'u')]}
    project = Project.model_validate({
        'version': 2, 'name': 'Up', 'duration': 1, 'revision': 0, 'subsystems': [inside],
        'blocks': [at('s', instance('sub')), at('f', tag('from', 'B'), 100), at('g', gain(1), 200)],
        'wires': [wire('w', 'f', 'y', 'g', 'u')]})
    problems = tag_problems(project)
    assert [p['message'] for p in problems] == ['No Goto [B] on this sheet or above it for the From [B].']
    assert problems[0]['blockIds'] == ['f']
    with pytest.raises(SimulationFailure, match='Fix these tags'):
        validate_simulation(project)


def test_tag_problems_name_the_blocks():
    project = Project.model_validate({
        'version': 1, 'name': 'Twice', 'duration': 1, 'revision': 0,
        'blocks': [at('c', CONST), at('t1', tag('goto', 'A')), at('t2', tag('goto', 'A')), at('t3', tag('from', None))],
        'wires': [wire('w1', 'c', 'y', 't1', 'u'), wire('w2', 'c', 'y', 't2', 'u')]})
    messages = {p['message']: p['blockIds'] for p in tag_problems(project)}
    assert messages['Two Goto blocks on one sheet use the tag [A].'] == ['t1', 't2']
    assert messages['From has no tag.'] == ['t3']


def test_a_tag_must_be_an_identifier():
    with pytest.raises(Exception):
        Project.model_validate({'version': 1, 'name': 'Bad', 'duration': 1, 'revision': 0,
                                'blocks': [at('t', tag('goto', 'A B'))], 'wires': []})


def test_labels_join_a_node_down_into_a_subsystem():
    project = Project.model_validate(physical_document())
    source = emit_project(project)
    inside = source[source.index('model Sub_load'):source.index('end Sub_load;')]
    assert '  Modelica.Electrical.Analog.Interfaces.Pin tag_io_P;' in inside
    assert 'connect(r.p, tag_io_P);' in inside
    assert 'connect(load.tag_io_P, src.p);' in source


def test_sibling_subsystems_do_not_share_a_label_without_one_above():
    # Two instances of the load, no [P] at the top: each inside keeps its own node.
    doc = physical_document()
    doc['blocks'] = [b for b in doc['blocks'] if b['id'] != 'top'] + [at('load2', instance('load', 'Load 2'), 300)]
    doc['wires'] = [w for w in doc['wires'] if w['id'] != 'w1']
    source = emit_project(Project.model_validate(doc))
    assert 'tag_io_P' not in source


def _series(result, key):
    return next(s['values'] for s in result['series'] if s['key'] == key)


@pytest.mark.integration
def test_engine_runs_signals_through_tags_down_a_hierarchy():
    project = Project.model_validate(signals_document())
    result = asyncio.run(simulate(log_outputs(project), 'tags' + uuid.uuid4().hex[:12]))
    assert _series(result, 'g.y')[-1] == pytest.approx(10)
    assert _series(result, 'm.d.g.y')[-1] == pytest.approx(6)


@pytest.mark.integration
def test_engine_runs_a_physical_node_through_labels_into_a_subsystem():
    project = Project.model_validate(physical_document())
    result = asyncio.run(simulate(log_outputs(project), 'labels' + uuid.uuid4().hex[:12]))
    assert _series(result, 'load.vs.v')[-1] == pytest.approx(10)
