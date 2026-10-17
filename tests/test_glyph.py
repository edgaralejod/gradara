# SPDX-License-Identifier: Apache-2.0
"""A block's drawn symbol (Definition.glyph): kept through the service, bounded, and never simulated."""
import json
from pathlib import Path
import pytest
from pydantic import ValidationError
from server.modelica import emit_project, project_key
from server.models import Definition, Project

ROOT = Path(__file__).parents[1]
FET = {'width': 36, 'height': 44, 'outline': False,
       'shapes': [{'type': 'line', 'points': [[0, 22], [5, 22]]},
                  {'type': 'polygon', 'points': [[11, 22], [17, 18.5], [17, 25.5]], 'fill': True},
                  {'type': 'path', 'd': 'M10 8V16M10 28V36'},
                  {'type': 'arc', 'cx': 18, 'cy': 22, 'r': 4, 'start': 0, 'end': 90},
                  {'type': 'text', 'x': 26, 'y': 4, 'text': 'D', 'size': 'small'}],
       'anchors': {'reference': {'x': 0, 'y': 22}}, 'body': {'width': 64, 'height': 80}}


def servo() -> dict:
    return json.loads((ROOT/'models/examples/servo.json').read_text(encoding='utf-8'))


def with_glyph(doc: dict, glyph: dict) -> dict:
    block = next(b for b in doc['blocks'] if b['id'] == 'controller')
    block['definition']['glyph'] = glyph
    return doc


def test_a_drawing_round_trips_and_its_anchors_follow_the_ports():
    doc = Project.model_validate(with_glyph(servo(), FET | {'anchors': {'reference': {'x': 0, 'y': 22}, 'gone': {'x': 1, 'y': 1}}}))
    glyph = next(b.definition.glyph for b in doc.blocks if b.definition.glyph)
    assert set(glyph.anchors) == {'reference'}
    dumped = glyph.model_dump(exclude_none=True)
    assert dumped['shapes'][1]['fill'] is True and dumped['body'] == {'width': 64, 'height': 80}


@pytest.mark.parametrize('bad', [
    {'width': 400},
    {'shapes': [{'type': 'path', 'd': 'M0 0 url(javascript:x)'}]},
    {'shapes': [{'type': 'line', 'points': [[0, 0], [999, 0]]}]},
    {'shapes': [{'type': 'script', 'src': 'x'}]},
    {'shapes': [{'type': 'text', 'x': 0, 'y': 0, 'text': 'x' * 25}]},
    {'body': {'width': 50, 'height': 64}},
    {'anchors': {'reference': {'x': 500, 'y': 0}}},
])
def test_a_drawing_outside_its_limits_is_refused(bad):
    with pytest.raises(ValidationError):
        Project.model_validate(with_glyph(servo(), FET | bad))


def test_a_drawing_never_changes_the_model_or_its_identity():
    plain = Project.model_validate(servo())
    drawn = Project.model_validate(with_glyph(servo(), FET))
    assert emit_project(plain) == emit_project(drawn)
    assert project_key(plain) == project_key(drawn)


def test_a_generated_definition_keeps_its_drawing():
    definition = Definition(kind='myFet', name='My FET', description='', domain='signal', symbol='F',
                            ports=[{'id': 'u', 'name': 'u', 'direction': 'input', 'domain': 'signal'}],
                            parameters=[], equations='', generated=True, glyph=FET)
    assert definition.model_dump(exclude_none=True)['glyph']['shapes'][2]['d'] == 'M10 8V16M10 28V36'
