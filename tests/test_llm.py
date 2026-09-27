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


def test_priced_parts_reach_gradara_and_job_credits_are_recorded(isolated, monkeypatch):
    settings.update({'ai': {'provider': 'gradara'}})
    jobs = []

    async def fake(prompt, schema, *, task, job):
        from server.llm.providers import Generation
        jobs.append(dict(job))
        return Generation({'ok': True}, 'gradara', 'm', job_charged=4 + 2 * (len(jobs) - 1))
    from server.llm import gradara
    monkeypatch.setattr(gradara, 'generate', fake)

    async def run():
        dispatch.current_job.set({'id': 'edit1', 'kind': 'edit'})
        await dispatch.generate('p', SCHEMA, 'edit1-edit0', task='edit-plan')
        with dispatch.job_part('block:1'):
            await dispatch.generate('p', SCHEMA, 'edit1-block0', task='component')
        return dispatch.credits_for_current_job(), dispatch.current_job.get()
    credits, job = asyncio.run(run())
    assert jobs == [{'id': 'edit1', 'kind': 'edit'}, {'id': 'edit1', 'kind': 'edit', 'part': 'block:1'}]
    assert credits == 6 and job == {'id': 'edit1', 'kind': 'edit'}


def test_gradara_requires_sign_in(isolated):
    settings.update({'ai': {'provider': 'gradara'}})
    with pytest.raises(ProviderError, match='Sign in'):
        asyncio.run(dispatch.generate('p', SCHEMA, 'a1', task='component'))


def test_off_blocks_generation(isolated):
    settings.update({'ai': {'provider': 'off'}})
    with pytest.raises(ProviderError, match='turned off'):
        asyncio.run(dispatch.generate('p', SCHEMA, 'a1', task='component'))
    assert dispatch.status()['ready'] is False


def test_gateway_accepts_every_task_and_job_kind_the_app_sends():
    """A release must not use a Gradara AI task the gateway would reject with a 422."""
    import re
    from pathlib import Path
    root = Path(__file__).resolve().parent.parent
    gateway = (root/'cloud'/'gateway'/'app.py').read_text()
    task_pattern = re.search(r"task: str = Field\(pattern='([^']+)'", gateway).group(1)
    kind_pattern = re.search(r"kind: str = Field\(pattern='([^']+)'", gateway).group(1)
    source = '\n'.join(p.read_text() for p in (root/'server').rglob('*.py'))
    tasks = set(re.findall(r"task='([a-z-]+)'", source)) | {'component'}
    # Jobs started through the local job runner, plus the fallback kind from the task name.
    kinds = {k for k in re.findall(r"start_job\('([a-z]+)'", (root/'server'/'app.py').read_text()) if k not in ('engine', 'simulation')}
    kinds |= {task.split('-')[0] for task in tasks}
    task_kinds = eval(re.search(r'TASK_KINDS = (\{.*?\}\})', gateway, re.S).group(1))  # literal dict
    assert tasks, 'no Gradara AI tasks found in server/'
    for task in tasks:
        assert re.fullmatch(task_pattern, task), f'gateway rejects task {task!r}'
        assert task in task_kinds, f'gateway has no TASK_KINDS entry for {task!r}'
    for kind in kinds:
        assert re.fullmatch(kind_pattern, kind), f'gateway rejects job kind {kind!r}'


def test_outdated_gateway_validation_error_is_explained():
    from server.llm import gradara
    response = httpx.Response(422, json={'detail': [{'loc': ['body', 'task'], 'msg': "String should match pattern"}]})
    assert gradara._detail(response, '/v1/generate') == gradara.OUTDATED_SERVICE
    other = httpx.Response(422, json={'detail': [{'loc': ['body', 'prompt'], 'msg': 'too long'}]})
    assert gradara._detail(other, '/v1/generate') == 'Gradara AI rejected the request: too long'
    assert gradara._detail(httpx.Response(402, json={'detail': 'Not enough credits.'})) == 'Not enough credits.'
