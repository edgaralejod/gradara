# SPDX-License-Identifier: Apache-2.0
"""Provider request shapes, response parsing, and provider routing (no network)."""
import asyncio
import json

import httpx
import pytest

from server import credentials, settings
from server.llm import dispatch
from server.llm.providers import AnthropicProvider, OpenAIProvider, ProviderError
from server.llm.schema import strict_schema

SCHEMA = {'type': 'object', 'properties': {'name': {'type': 'string', 'maxLength': 20},
                                           'items': {'type': 'array', 'minItems': 1,
                                                     'items': {'type': 'object', 'properties': {'v': {'type': 'number', 'minimum': 0}}}}},
          'required': ['name']}


def test_strict_schema_closes_objects_and_drops_constraints():
    strict = strict_schema(SCHEMA)
    assert strict['required'] == ['name', 'items'] and strict['additionalProperties'] is False
    assert 'maxLength' not in strict['properties']['name']
    inner = strict['properties']['items']['items']
    assert inner['additionalProperties'] is False and inner['required'] == ['v']
    assert 'minimum' not in inner['properties']['v']
    assert SCHEMA['properties']['name']['maxLength'] == 20  # input untouched


def mock_client(handler):
    return httpx.AsyncClient(transport=httpx.MockTransport(handler))


def test_openai_request_disables_storage_and_parses_output():
    seen = {}

    def handler(request):
        seen['body'] = json.loads(request.content)
        seen['auth'] = request.headers['authorization']
        return httpx.Response(200, json={'model': 'gpt-x', 'status': 'completed',
                                         'output': [{'type': 'message', 'content': [{'type': 'output_text', 'text': '{"name": "A"}'}]}],
                                         'usage': {'input_tokens': 10, 'output_tokens': 5}})
    result = asyncio.run(OpenAIProvider('sk-1', 'gpt-x', client=mock_client(handler)).generate('hi', SCHEMA))
    assert result.data == {'name': 'A'} and result.usage.total == 15
    assert seen['body']['store'] is False
    assert seen['body']['text']['format']['strict'] is True
    assert seen['auth'] == 'Bearer sk-1'


def test_anthropic_uses_output_config_json_schema():
    seen = {}

    def handler(request):
        seen['body'] = json.loads(request.content)
        seen['key'] = request.headers['x-api-key']
        return httpx.Response(200, json={'model': 'claude-x', 'stop_reason': 'end_turn',
                                         'content': [{'type': 'text', 'text': '{"name": "B"}'}],
                                         'usage': {'input_tokens': 7, 'output_tokens': 3}})
    result = asyncio.run(AnthropicProvider('ak', 'claude-x', client=mock_client(handler)).generate('hi', SCHEMA))
    assert result.data == {'name': 'B'}
    assert seen['body']['output_config']['format']['type'] == 'json_schema'
    assert seen['key'] == 'ak'


def test_auth_failure_is_actionable():
    client = mock_client(lambda request: httpx.Response(401, json={'error': {'message': 'bad key'}}))
    with pytest.raises(ProviderError, match='rejected the API key') as error:
        asyncio.run(OpenAIProvider('sk-1', client=client).generate('hi', SCHEMA))
    assert error.value.status == 401


def test_rate_limits_are_retried(monkeypatch):
    calls = []

    async def no_sleep(_):
        return None
    monkeypatch.setattr(asyncio, 'sleep', no_sleep)

    def handler(request):
        calls.append(1)
        if len(calls) < 2:
            return httpx.Response(429, json={'error': {'message': 'slow down'}}, headers={'retry-after': '0'})
        return httpx.Response(200, json={'content': [{'type': 'text', 'text': '{"name":"C"}'}], 'usage': {}})
    result = asyncio.run(AnthropicProvider('ak', client=mock_client(handler)).generate('hi', SCHEMA))
    assert result.data == {'name': 'C'} and len(calls) == 2


@pytest.fixture
def isolated(tmp_path, monkeypatch):
    monkeypatch.setattr(settings, 'SETTINGS_FILE', tmp_path/'settings.json')
    monkeypatch.setattr(credentials, 'FALLBACK', tmp_path/'.credentials.json')
    monkeypatch.setenv('GRADARA_CREDENTIAL_STORE', 'file')
    monkeypatch.delenv('GRADARA_AI_PROVIDER', raising=False)
    monkeypatch.delenv('GRADARA_KEEP_AI_TRANSCRIPTS', raising=False)


def test_dispatch_requires_key_for_byok(isolated):
    settings.update({'ai': {'provider': 'openai'}})
    with pytest.raises(ProviderError, match='Add your OpenAI API key'):
        asyncio.run(dispatch.generate('p', SCHEMA, 'a1', task='component'))


def test_dispatch_sends_job_scope_to_gradara(isolated, monkeypatch):
    settings.update({'ai': {'provider': 'gradara'}})
    seen = {}

    async def fake(prompt, schema, *, task, job):
        from server.llm.providers import Generation
        seen.update(task=task, job=job)
        return Generation({'ok': True}, 'gradara', 'm')
    from server.llm import gradara
    monkeypatch.setattr(gradara, 'generate', fake)

    async def run():
        dispatch.current_job.set({'id': 'job1', 'kind': 'model'})
        return await dispatch.generate('p', SCHEMA, 'job1-plan', task='model-plan')
    assert asyncio.run(run()) == {'ok': True}
    assert seen == {'task': 'model-plan', 'job': {'id': 'job1', 'kind': 'model'}}


def test_gradara_requires_sign_in(isolated):
    settings.update({'ai': {'provider': 'gradara'}})
    with pytest.raises(ProviderError, match='Sign in'):
        asyncio.run(dispatch.generate('p', SCHEMA, 'a1', task='component'))


def test_off_blocks_generation(isolated):
    settings.update({'ai': {'provider': 'off'}})
    with pytest.raises(ProviderError, match='turned off'):
        asyncio.run(dispatch.generate('p', SCHEMA, 'a1', task='component'))
    assert dispatch.status()['ready'] is False
