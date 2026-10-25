# SPDX-License-Identifier: Apache-2.0
"""Planner and executor roles: which model answers each task, settings, and migration."""
from __future__ import annotations

import ast
import asyncio
import json
import re
from pathlib import Path

import pytest

from server import credentials, settings
from server.llm import dispatch, providers
from server.llm.providers import DEFAULT_MODELS, Generation
from server.llm.roles import ROLES, TASK_ROLES, role_for

SCHEMA = {'type': 'object', 'properties': {'name': {'type': 'string'}}, 'required': ['name']}


@pytest.fixture
def isolated(tmp_path, monkeypatch):
    monkeypatch.setattr(settings, 'SETTINGS_FILE', tmp_path/'settings.json')
    monkeypatch.setattr(credentials, 'FALLBACK', tmp_path/'.credentials.json')
    monkeypatch.setenv('GRADARA_CREDENTIAL_STORE', 'file')
    monkeypatch.delenv('GRADARA_AI_PROVIDER', raising=False)
    monkeypatch.delenv('GRADARA_KEEP_AI_TRANSCRIPTS', raising=False)
    return tmp_path


def test_every_task_has_a_role():
    assert set(TASK_ROLES.values()) <= set(ROLES)
    assert role_for('edit-plan') == role_for('model-plan') == role_for('diagnose') == role_for('results') == 'planner'
    assert role_for('component') == role_for('model-assembly') == role_for('export') == 'executor'
    assert role_for('something-new') == 'planner', 'an unknown task goes to the stronger model'


def test_every_gateway_task_has_a_role():
    # Read from the source: the gateway's own dependencies are not installed with the app's.
    gateway = (Path(__file__).parents[1]/'cloud'/'gateway'/'app.py').read_text(encoding='utf-8')
    task_kinds = ast.literal_eval(re.search(r'TASK_KINDS = (\{.*?\}\})', gateway, re.S).group(1))
    assert set(task_kinds) == set(TASK_ROLES), 'the gateway and the local service route the same tasks'


def test_defaults_name_a_model_for_each_role():
    for name in ('openai', 'anthropic'):
        assert set(DEFAULT_MODELS[name]) == set(ROLES)
        assert all(DEFAULT_MODELS[name][role] for role in ROLES)


def record_models(monkeypatch):
    used = []

    class Recorder:
        def __init__(self, model):
            self.model = model

        async def generate(self, prompt, schema):
            used.append(self.model)
            return Generation({'name': 'x'}, 'anthropic', self.model)
    monkeypatch.setattr(dispatch, 'make_provider', lambda name, key, model: Recorder(model))
    return used


def test_each_task_uses_its_role_model(isolated, monkeypatch):
    credentials.put('anthropic_api_key', 'sk-ant-test-key')
    settings.update({'ai': {'provider': 'anthropic', 'anthropicPlannerModel': 'big', 'anthropicExecutorModel': 'small'}})
    used = record_models(monkeypatch)
    for task in ('edit-plan', 'component', 'model-plan', 'model-assembly', 'export', 'results', 'diagnose'):
        asyncio.run(dispatch.generate('p', SCHEMA, 'a1', task=task))
    assert used == ['big', 'small', 'big', 'small', 'small', 'big', 'big']


def test_a_call_can_name_its_role(isolated, monkeypatch):
    credentials.put('anthropic_api_key', 'sk-ant-test-key')
    settings.update({'ai': {'provider': 'anthropic', 'anthropicPlannerModel': 'big', 'anthropicExecutorModel': 'small'}})
    used = record_models(monkeypatch)
    asyncio.run(dispatch.generate('p', SCHEMA, 'a1', task='component', role='planner'))
    assert used == ['big']
    with pytest.raises(ValueError, match='Unknown AI role'):
        asyncio.run(dispatch.generate('p', SCHEMA, 'a1', task='component', role='reviewer'))


def test_an_empty_role_uses_that_role_default(isolated, monkeypatch):
    credentials.put('openai_api_key', 'sk-test-key-123')
    settings.update({'ai': {'provider': 'openai', 'openaiPlannerModel': 'mine'}})
    used = record_models(monkeypatch)
    asyncio.run(dispatch.generate('p', SCHEMA, 'a1', task='edit-plan'))
    asyncio.run(dispatch.generate('p', SCHEMA, 'a1', task='component'))
    assert used == ['mine', DEFAULT_MODELS['openai']['executor']]


def test_one_model_setting_becomes_the_planner_model(isolated):
    settings.SETTINGS_FILE.write_text(json.dumps({'ai': {'provider': 'anthropic', 'anthropicModel': 'claude-x',
                                                         'openaiModel': ''}}), encoding='utf-8')
    ai = settings.load()['ai']
    assert ai['anthropicPlannerModel'] == 'claude-x' and ai['anthropicExecutorModel'] == ''
    assert 'anthropicModel' not in ai and 'openaiModel' not in ai
    settings.update({'ai': {'anthropicExecutorModel': 'claude-y'}})
    stored = json.loads(settings.SETTINGS_FILE.read_text(encoding='utf-8'))['ai']
    assert stored['anthropicPlannerModel'] == 'claude-x' and 'anthropicModel' not in stored


def test_status_reports_models_per_role(isolated):
    settings.update({'ai': {'provider': 'anthropic', 'anthropicExecutorModel': 'small'}})
    status = dispatch.status()
    assert status['models']['anthropic'] == {'planner': '', 'executor': 'small'}
    assert status['defaultModels'] == DEFAULT_MODELS


def test_transcript_records_role_and_model(isolated, monkeypatch):
    monkeypatch.setenv('GRADARA_KEEP_AI_TRANSCRIPTS', '1')
    monkeypatch.setattr(dispatch, 'AGENT_DIR', isolated/'agent')
    credentials.put('anthropic_api_key', 'sk-ant-test-key')
    settings.update({'ai': {'provider': 'anthropic', 'anthropicExecutorModel': 'small'}})
    record_models(monkeypatch)
    asyncio.run(dispatch.generate('p', SCHEMA, 'job7', task='component'))
    meta = json.loads((isolated/'agent'/'job7'/'meta.json').read_text(encoding='utf-8'))
    assert meta == {'task': 'component', 'role': 'executor', 'provider': 'anthropic', 'model': 'small'}


def test_providers_default_to_the_planner_model():
    assert providers.AnthropicProvider('k').model == DEFAULT_MODELS['anthropic']['planner']
    assert providers.OpenAIProvider('k').model == DEFAULT_MODELS['openai']['planner']
