# SPDX-License-Identifier: Apache-2.0
"""Library blocks that wrap Modelica Standard Library classes (server/msl.py)."""
import json
import subprocess
import sys
from pathlib import Path

import pytest

from server import msl
from server.modelica import emit_project
from server.models import Definition, Project

ROOT = Path(__file__).resolve().parent.parent


def library() -> list[dict]:
    src = (ROOT/'lib'/'gradara'/'msl-blocks.ts').read_text(encoding='utf-8')
    return json.loads(src[src.index('= [') + 2:src.rindex(';')])


def test_generated_library_is_up_to_date():
    out = subprocess.run([sys.executable, 'scripts/msl-blocks.py'], cwd=ROOT, capture_output=True, text=True, check=True, encoding='utf-8', errors='replace')
    assert out.stdout == (ROOT/'lib'/'gradara'/'msl-blocks.ts').read_text(encoding='utf-8'), 'run: python3 scripts/msl-blocks.py > lib/gradara/msl-blocks.ts'


@pytest.mark.parametrize('data', library(), ids=lambda d: d['kind'])
def test_every_block_matches_its_msl_class(data):
    definition = Definition.model_validate(data)
    msl.check(definition)
    line = msl.instance(definition, 'b1')
    assert line.startswith(f'  {definition.modelica.class_} b1')


def block(kind, ident, x=0):
    data = next(d for d in library() if d['kind'] == kind)
    return {'id': ident, 'definition': data, 'position': {'x': x, 'y': 0}}


def test_emission_uses_msl_components_and_mapped_connectors():
    project = Project.model_validate({
        'version': 1, 'name': 'spring mass', 'duration': 1, 'revision': 0,
        'blocks': [block('transFixed', 'wall'), block('transSpring', 'spring', 100), block('mass', 'body', 200),
                   block('threePhaseCurrentSensor', 'meter', 300)],
        'wires': [{'id': 'w1', 'source': 'wall', 'sourceHandle': 'flange', 'target': 'spring', 'targetHandle': 'flange_a'},
                  {'id': 'w2', 'source': 'spring', 'sourceHandle': 'flange_b', 'target': 'body', 'targetHandle': 'flange_a'}],
    })
    source = emit_project(project)
    assert '  Modelica.Mechanics.Translational.Components.Spring spring(c=(1000), s_rel0=(0));' in source
    assert 'connect(body.flange_a, spring.flange_b);' in source
    assert 'Component_spring' not in source, 'wrapper blocks are instantiated directly'
    ports = {p['id']: p for p in block('threePhaseCurrentSensor', 'x')['definition']['ports']}
    assert msl.connector(Definition.model_validate(block('threePhaseCurrentSensor', 'x')['definition']), 'ib') == 'i[2]'
    assert ports['ib']['direction'] == 'output'


def resistor(**wrapper):
    data = next(d for d in library() if d['kind'] == 'heatingResistor')
    return Definition.model_validate({**data, 'modelica': {**data['modelica'], **wrapper}})


@pytest.mark.parametrize('wrapper, message', [
    ({'class': 'Modelica.Utilities.System.command'}, 'not an available library class'),
    ({'modifiers': {'R': 'R', 'Rogue': '1'}}, 'has no parameter Rogue'),
    ({'modifiers': {'R': 'secret', 'useHeatPort': 'true'}}, 'unknown value secret'),
    ({'modifiers': {'R': 'R'}}, 'conditional'),
])
def test_wrappers_that_do_not_match_their_class_are_refused(wrapper, message):
    with pytest.raises(ValueError, match=message):
        msl.check(resistor(**wrapper))


def test_modifier_text_cannot_carry_code():
    with pytest.raises(ValueError):
        resistor(modifiers={'R': 'Modelica.Utilities.System.command("x")'})
    data = next(d for d in library() if d['kind'] == 'heatingResistor')
    with pytest.raises(ValueError):
        Definition.model_validate({**data, 'generated': True})


def test_record_modifiers_nest():
    assert msl.modification({'Ns': '2', 'cellData.Qnom': '18000', 'cellData.Ri': '0.01'}) == \
        '(Ns=2, cellData(Qnom=18000, Ri=0.01))'
