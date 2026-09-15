"""Library persistence does not couple existing model instances to templates."""
import json
from pathlib import Path
from server.component_library import save_component, list_components
from server.models import Definition


def definition():
    return Definition(kind='gain', name='My gain', description='Generated gain', domain='signal', symbol='k',
        ports=[dict(id='u',name='u',direction='input',domain='signal'),dict(id='y',name='y',direction='output',domain='signal')],
        parameters=[dict(id='k',name='Gain',value=2)], equations='y=k*u;', generated=True)


def test_deduplicates_and_keeps_changed_versions(tmp_path):
    d = definition()
    first = save_component(tmp_path, d)
    assert save_component(tmp_path, d) == first
    d.parameters[0].value = 4
    second = save_component(tmp_path, d)
    assert second['id'] != first['id']
    loaded = list_components(tmp_path)
    assert len(loaded) == 2
    assert next(x for x in loaded if x['id'] == first['id'])['definition']['parameters'][0]['value'] == 2
    assert len(list_components(tmp_path)) == 2


def test_imports_existing_generated_blocks_once_without_changing_models(tmp_path):
    model = json.loads((Path(__file__).with_name('motor-project.json')).read_text())
    model['modelId'] = 'test-model'
    model['blocks'][0]['definition'] = definition().model_dump()
    # This test needs a valid self-contained saved document, not motor wiring.
    model['blocks'] = model['blocks'][:1]
    model['wires'] = []
    model.pop('nets', None)
    path = tmp_path/'models'/'test-model.json'
    path.parent.mkdir()
    path.write_text(json.dumps(model))
    before = path.read_bytes()
    entries = list_components(tmp_path)
    assert len(entries) == 1
    assert not entries[0]['checked']
    assert path.read_bytes() == before
    promoted = save_component(tmp_path, definition())
    assert promoted['id'] == entries[0]['id']
    assert promoted['checked']
    assert len(list_components(tmp_path)) == 1


def test_only_successful_generation_is_archived(tmp_path, monkeypatch):
    import asyncio
    from unittest.mock import AsyncMock
    from server import agent
    candidate = definition().model_dump()
    monkeypatch.setattr(agent, 'ROOT', tmp_path)
    monkeypatch.setattr(agent, 'structured_generation', AsyncMock(return_value=candidate))
    monkeypatch.setattr(agent, 'check_component', AsyncMock(side_effect=ValueError('Invalid equations')))
    import pytest
    with pytest.raises(RuntimeError, match='Invalid equations'):
        asyncio.run(agent.generate_component('a gain', None, 'failed'))
    assert not list((tmp_path/'projects'/'components').glob('ai_*.json'))
    monkeypatch.setattr(agent, 'check_component', AsyncMock())
    result = asyncio.run(agent.generate_component('a gain', None, 'success'))
    entries = list_components(tmp_path/'projects')
    assert len(entries) == 1
    assert entries[0]['id'] == result['libraryId']
    assert entries[0]['checked']
