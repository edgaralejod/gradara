# SPDX-License-Identifier: Apache-2.0
"""Variant subsystems: alternative insides behind one set of ports, and configurations."""
import copy

import pytest
from pydantic import ValidationError

from server.diagnostics import SimulationFailure, validate_simulation
from server.modelica import emit_project
from server.models import Project
from test_hierarchy import at, boundary, document, wire


def doubler():
    """A second inside for the amplifier: its own gain and an extra output `z`."""
    sub = copy.deepcopy(document()['subsystems'][0])
    sub.update(id='amp2', name='Doubler')
    sub['parameters'][0]['value'] = 2
    sub['blocks'].append(at('out2', boundary('outport', 'z', order=1), 200, 80))
    sub['wires'].append(wire('c', 'g', 'y', 'out2', 'u'))
    return sub


def variants(active='v1', unused=('out2',)):
    doc = document()
    doc['subsystems'].append(doubler())
    instance = doc['blocks'][1]['definition']
    instance['ports'].append({'id': 'out2', 'name': 'z', 'direction': 'output', 'domain': 'signal'})
    choices = [{'id': 'v1', 'name': 'Five', 'ref': 'amp', 'values': {'gain': 7}, 'unused': list(unused)},
               {'id': 'v2', 'name': 'Doubler', 'ref': 'amp2', 'values': {'gain': 2}},
               {'id': 'v3', 'name': 'Nine', 'ref': 'amp', 'values': {'gain': 9}, 'unused': ['out2']}]
    ref = next(c['ref'] for c in choices if c['id'] == active)
    instance['subsystem'] = {'ref': ref, 'variants': choices, 'active': active}
    instance['parameters'][0]['value'] = next(c['values']['gain'] for c in choices if c['id'] == active)
    doc['configurations'] = [{'id': 'proto', 'name': 'Prototype', 'choices': {'/a1': 'v1'}},
                             {'id': 'prod', 'name': 'Production', 'choices': {'/a1': 'v2'}}]
    return doc


def test_active_variant_is_emitted_and_idle_ports_are_terminated():
    source = emit_project(Project.model_validate(variants()))
    assert 'model Sub_amp__out2\n  extends Sub_amp;\n  Modelica.Blocks.Interfaces.RealOutput out2;\nequation\n  out2 = 0;' in source
    assert '  Sub_amp__out2 a1(par_gain=7);' in source
    assert 'model Sub_amp2' not in source  # inactive insides are not emitted
    other = emit_project(Project.model_validate(variants('v2')))
    assert '  Sub_amp2 a1(par_gain=2);' in other and 'Sub_amp__' not in other


def test_parameter_variant_shares_the_inside():
    source = emit_project(Project.model_validate(variants('v3')))
    assert '  Sub_amp__out2 a1(par_gain=9);' in source


def test_a_port_the_active_variant_lacks_is_a_problem_unless_marked_unused():
    project = Project.model_validate(variants(unused=()))
    with pytest.raises(SimulationFailure) as info:
        validate_simulation(project)
    assert info.value.diagnostics[0].blockIds == ['a1']
    assert 'Five' in info.value.diagnostics[0].message and 'z' in info.value.diagnostics[0].message
    validate_simulation(Project.model_validate(variants()))


@pytest.mark.parametrize('change, message', [
    (lambda d: d['blocks'][1]['definition']['subsystem'].update(active='nope'), 'active variant'),
    (lambda d: d['blocks'][1]['definition']['subsystem'].update(ref='amp2'), 'active variant'),
    (lambda d: d['blocks'][1]['definition']['subsystem']['variants'][1].update(ref='gone'), 'missing subsystem'),
    (lambda d: d['blocks'][1]['definition']['ports'].pop(), 'out of date'),
    (lambda d: d['blocks'][1]['definition']['subsystem']['variants'].__setitem__(slice(1, 3), []), 'at least 2'),
])
def test_variant_structure_errors(change, message):
    doc = variants()
    change(doc)
    with pytest.raises(ValidationError, match=message):
        Project.model_validate(doc)


def test_a_variant_cannot_contain_its_own_subsystem():
    doc = variants()
    inner = doc['subsystems'][1]
    nested = copy.deepcopy(doc['blocks'][1])
    nested['id'] = 'inner'
    inner['blocks'].append(nested)
    with pytest.raises(ValidationError, match='contain itself'):
        Project.model_validate(doc)


def test_configurations_round_trip():
    project = Project.model_validate(variants())
    assert [c.name for c in project.configurations] == ['Prototype', 'Production']
    dumped = project.model_dump(exclude_none=True)
    assert dumped['configurations'][1]['choices'] == {'/a1': 'v2'}
    assert 'configurations' not in Project.model_validate(document()).model_dump(exclude_none=True)


@pytest.mark.integration
def test_switching_variants_changes_the_simulation():
    import asyncio
    import uuid

    from server.engine import simulate

    def final(doc):
        result = asyncio.run(simulate(Project.model_validate(doc), 'var' + uuid.uuid4().hex[:10]))
        return next(o for o in result['series'] if o['key'] == 'sink.y')['values'][-1]
    five, two, nine = final(variants('v1')), final(variants('v2')), final(variants('v3'))
    assert two == pytest.approx(five * 2 / 7) and nine == pytest.approx(five * 9 / 7)


@pytest.mark.integration
@pytest.mark.parametrize('source', ['models/examples/ev.json', 'tests/fixtures/ev-performance.json'])
def test_ev_drivetrain_reaches_cruise_speed_in_each_configuration(source):
    """The reference example: three levels of subsystems, battery and motor variants, both configurations."""
    import asyncio
    import uuid
    from pathlib import Path

    from server.engine import simulate
    project = Project.model_validate_json((Path(__file__).parent.parent/source).read_text())
    result = asyncio.run(simulate(project, 'ev' + uuid.uuid4().hex[:10]))
    speed = next(o for o in result['series'] if o['key'] == 'speed.v')['values']
    assert speed[-1] == pytest.approx(5, rel=0.05)
    assert max(speed) < 6
