# SPDX-License-Identifier: Apache-2.0
"""Drawing a block's symbol with the AI, saving an edited look to the AI blocks library,
and keeping a drawing when the AI refines a block."""
import asyncio
import json
from unittest.mock import AsyncMock
import pytest
from server import symbol_agent as drawer
from server.block_style import house_style
from server.component_library import list_components, replace_component, save_component
from server.models import Definition, SymbolGlyph


def fet() -> Definition:
    return Definition(kind='myFet', name='My FET', description='A switching transistor.', domain='electrical',
                      symbol='FET', generated=True, parameters=[], equations='d.i + s.i = 0;\nd.v - s.v = 0;',
                      ports=[{'id': 'g', 'name': 'g', 'direction': 'input', 'domain': 'signal', 'side': 'left'},
                             {'id': 'd', 'name': 'd', 'direction': 'physical', 'domain': 'electrical', 'side': 'top'},
                             {'id': 's', 'name': 's', 'direction': 'physical', 'domain': 'electrical', 'side': 'bottom'}])


DRAWING = {'width': 36, 'height': 44, 'outline': False,
           'shapes': [{'type': 'path', 'd': 'M0 22H5M5 12V32M10 12H18V0M10 32H18V44', 'points': None, 'x': None, 'y': None,
                       'width': None, 'height': None, 'rx': None, 'ry': None, 'cx': None, 'cy': None, 'r': None,
                       'start': None, 'end': None, 'text': None, 'fill': None},
                      {'type': 'polygon', 'points': [[11, 22], [17, 18.5], [17, 25.5]], 'fill': True, 'x': None,
                       'y': None, 'width': None, 'height': None, 'rx': None, 'ry': None, 'cx': None, 'cy': None,
                       'r': None, 'start': None, 'end': None, 'd': None, 'text': None}],
           'anchors': [{'port': 'g', 'x': 0, 'y': 22}, {'port': 'd', 'x': 18, 'y': 0}, {'port': 's', 'x': 18, 'y': 44}]}


def run(monkeypatch, *answers):
    provider = AsyncMock(side_effect=list(answers))
    monkeypatch.setattr(drawer.agent, 'structured_generation', provider)
    monkeypatch.setattr(drawer.agent, 'provider_label', lambda: 'Test AI')
    request = drawer.SymbolRequest(definition=fet(), description='a schematic N-channel MOSFET')
    return provider, asyncio.run(drawer.draw_symbol(request, 'job1'))


def test_the_ai_draws_a_checked_symbol_as_a_component_task(monkeypatch):
    provider, result = run(monkeypatch, DRAWING)
    glyph = SymbolGlyph.model_validate(result['glyph'])
    assert set(glyph.anchors) == {'g', 'd', 's'} and glyph.outline is False
    assert glyph.shapes[0].type == 'path' and glyph.shapes[1].fill is True
    # Priced and limited as creating a block: no new gateway task.
    assert provider.call_args.kwargs['task'] == 'component'
    prompt = provider.call_args.args[0]
    assert 'a schematic N-channel MOSFET' in prompt and '"side": "top"' in prompt and 'y DOWN' in prompt


def test_a_drawing_without_every_anchor_is_sent_back_once(monkeypatch):
    partial = DRAWING | {'anchors': DRAWING['anchors'][:2]}
    provider, result = run(monkeypatch, partial, DRAWING)
    assert provider.await_count == 2
    assert 'missing: s' in provider.call_args.args[0]
    assert set(result['glyph']['anchors']) == {'g', 'd', 's'}
    with pytest.raises(ValueError, match='missing'):
        run(monkeypatch, partial, partial)


def test_an_out_of_bounds_drawing_is_refused(monkeypatch):
    huge = DRAWING | {'width': 999}
    with pytest.raises(ValueError, match='out of bounds'):
        run(monkeypatch, huge, huge)


def test_the_symbol_api_is_a_component_job(monkeypatch):
    from fastapi.testclient import TestClient
    from server import app as service
    monkeypatch.setattr(service, 'JOBS', {})
    monkeypatch.setattr(service, 'TASKS', {})
    async def fake(req, job_id, progress):
        progress('Drawing the symbol')
        return {'glyph': {'width': 10, 'height': 10, 'shapes': [], 'anchors': {}}}
    monkeypatch.setattr(service, 'draw_symbol', fake)
    body = {'definition': fet().model_dump(exclude_none=True), 'description': 'a MOSFET'}
    with TestClient(service.app, headers={'X-Gradara-Client': 'test'}) as client:
        ident = client.post('/api/components/symbol', json=body).json()['id']
        job = client.get('/api/jobs/' + ident).json()
        assert job['kind'] == 'component' and job['status'] == 'complete'
        assert client.post('/api/components/symbol', json={**body, 'description': 'x'}).status_code == 422


def test_saving_a_new_look_replaces_the_library_entry_and_keeps_its_check(tmp_path):
    (tmp_path/'components').mkdir()
    (tmp_path/'components'/'.imported-models').write_text('1')
    old = save_component(tmp_path, fet(), checked=True)
    drawn = fet().model_copy(update={'glyph': SymbolGlyph.model_validate(drawer.to_glyph(
        drawer.Drawing.model_validate(DRAWING), fet()).model_dump())})
    drawn.ports[0].side = 'bottom'
    entry = replace_component(tmp_path, drawn, old['id'])
    assert entry['id'] != old['id'] and entry['checked'] is True
    assert [e['id'] for e in list_components(tmp_path)] == [entry['id']]
    # New behavior is not vouched for by the old check.
    changed = drawn.model_copy(update={'equations': 'd.i + s.i = 0;\nd.v = s.v;'})
    assert replace_component(tmp_path, changed, entry['id'])['checked'] is False


def test_saving_needs_an_ai_block(monkeypatch, tmp_path):
    from fastapi.testclient import TestClient
    from server import app as service
    monkeypatch.setattr(service, 'PROJECT_DIR', tmp_path)
    builtin = fet().model_copy(update={'generated': False}).model_dump(exclude_none=True)
    with TestClient(service.app, headers={'X-Gradara-Client': 'test'}) as client:
        assert client.post('/api/components/library', json={'definition': builtin}).status_code == 422
        assert client.post('/api/components/library', json={'definition': builtin, 'replaces': '../x'}).status_code == 422


def test_a_refined_block_keeps_its_drawing():
    existing = fet().model_copy(update={'glyph': drawer.to_glyph(drawer.Drawing.model_validate(DRAWING), fet())})
    revised, problems = house_style(fet().model_copy(update={'description': 'Faster.'}), existing)
    assert not problems and revised.glyph is not None and set(revised.glyph.anchors) == {'g', 'd', 's'}
