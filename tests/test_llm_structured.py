# SPDX-License-Identifier: Apache-2.0
"""Structured answers that overrun limits, corrective retries, and network failures (no network)."""
import asyncio

import httpx
import pytest

from server import agent, credentials, settings
from server.diagnose_agent import Diagnosis
from server.llm import gradara, structured
from server.llm.providers import AnthropicProvider, ProviderError, network_reason
from server.llm.schema import describe_limits, strict_schema

LONG = 'The solver could not initialize the model. ' * 60  # about 2600 characters


def answer(**overrides):
    data = {'summary': 'Short.', 'causes': [], 'fixable': False, 'manualSteps': [], 'editPrompt': None}
    return data | overrides


def test_limits_are_stated_in_words_once():
    schema = Diagnosis.model_json_schema()
    described = describe_limits(describe_limits(schema))
    summary = described['properties']['summary']['description']
    assert summary.count('Limits:') == 1 and 'at most 800 characters' in summary
    assert 'description' not in schema['properties']['summary'] or 'Limits:' not in schema['properties']['summary']['description']
    # The strict schema loses the constraint but keeps the sentence.
    strict = strict_schema(schema)
    assert 'maxLength' not in strict['properties']['summary']
    assert 'at most 800 characters' in strict['properties']['summary']['description']


def test_prose_is_trimmed_at_a_boundary_and_identifiers_are_not():
    data = answer(summary=LONG, manualSteps=[f'Step {i}' for i in range(12)],
                  causes=[{'diagnosticIds': ['d1'], 'blockIds': ['b1'], 'explanation': LONG}] * 14)
    diagnosis = structured.parse(Diagnosis, data)
    assert len(diagnosis.summary) <= 800 and diagnosis.summary.endswith('.…')
    assert len(diagnosis.causes) == 10 and len(diagnosis.causes[0].explanation) <= 1200
    assert len(diagnosis.manualSteps) == 8
    assert data['summary'] == LONG  # input untouched


def test_non_prose_overruns_still_fail():
    with pytest.raises(Exception):
        structured.parse(Diagnosis, answer(causes=[{'diagnosticIds': ['d'] * 60, 'blockIds': [],
                                                    'explanation': 'x'}]))


def test_a_bad_answer_gets_one_corrective_retry(monkeypatch):
    prompts = []

    async def fake(prompt, schema, attempt_id, *, task):
        prompts.append((prompt, attempt_id))
        return {'summary': 'missing the rest'} if len(prompts) == 1 else answer(summary='Fixed.')

    monkeypatch.setattr(agent, 'structured_generation', fake)
    diagnosis = asyncio.run(structured.generate('Diagnose.', Diagnosis, 'job-1', task='diagnose'))
    assert diagnosis.summary == 'Fixed.'
    assert [a for _, a in prompts] == ['job-1', 'job-1-fix']
    assert 'fixable: Field required' in prompts[1][0]


def test_a_second_bad_answer_is_a_readable_error(monkeypatch):
    async def fake(prompt, schema, attempt_id, *, task):
        return {'summary': 3}

    monkeypatch.setattr(agent, 'structured_generation', fake)
    with pytest.raises(ProviderError) as caught:
        asyncio.run(structured.generate('Diagnose.', Diagnosis, 'job-1', task='diagnose'))
    assert 'even after a retry' in str(caught.value) and 'pydantic' not in str(caught.value)


@pytest.mark.parametrize('exc, words', [
    (httpx.ConnectError('[SSL: CERTIFICATE_VERIFY_FAILED] certificate verify failed'), 'certificate'),
    (httpx.ConnectError('[Errno -2] Name or service not known'), 'DNS'),
    (httpx.ProxyError('407 Proxy Authentication Required'), 'proxy'),
    (httpx.ConnectTimeout('timed out'), 'timed out'),
    (httpx.ConnectError('[Errno 111] Connection refused'), 'refused'),
    (httpx.RemoteProtocolError('Server disconnected'), 'closed'),
])
def test_network_failures_name_their_cause(exc, words):
    assert words in network_reason(exc)


def no_sleep(monkeypatch):
    async def instant(_):
        return None
    monkeypatch.setattr(asyncio, 'sleep', instant)


def test_provider_repeats_a_request_that_never_left(monkeypatch):
    no_sleep(monkeypatch)
    calls = []

    def handler(request):
        calls.append(1)
        if len(calls) == 1:
            raise httpx.ConnectError('[Errno 111] Connection refused')
        return httpx.Response(200, json={'model': 'claude-x', 'stop_reason': 'end_turn',
                                         'content': [{'type': 'text', 'text': '{"name": "ok"}'}],
                                         'usage': {'input_tokens': 1, 'output_tokens': 1}})

    client = httpx.AsyncClient(transport=httpx.MockTransport(handler))
    result = asyncio.run(AnthropicProvider('ak', 'claude-x', client=client).generate('hi', {'type': 'object'}))
    assert result.data == {'name': 'ok'} and len(calls) == 2


def test_provider_never_repeats_a_request_that_was_sent(monkeypatch):
    no_sleep(monkeypatch)
    calls = []

    def handler(request):
        calls.append(1)
        raise httpx.ReadTimeout('read timed out')

    client = httpx.AsyncClient(transport=httpx.MockTransport(handler))
    with pytest.raises(ProviderError) as caught:
        asyncio.run(AnthropicProvider('ak', client=client).generate('hi', {'type': 'object'}))
    assert len(calls) == 1 and 'did not answer within' in str(caught.value)


@pytest.fixture
def signed_in(tmp_path, monkeypatch):
    monkeypatch.setattr(settings, 'SETTINGS_FILE', tmp_path/'settings.json')
    monkeypatch.setattr(credentials, 'FALLBACK', tmp_path/'.credentials.json')
    monkeypatch.setenv('GRADARA_CREDENTIAL_STORE', 'file')
    credentials.put('gradara_token', 'tok')
    no_sleep(monkeypatch)


def gateway(monkeypatch, handler):
    real = httpx.AsyncClient

    def client(**kwargs):
        return real(transport=httpx.MockTransport(handler), **kwargs)

    monkeypatch.setattr(gradara.httpx, 'AsyncClient', client)


def test_gateway_waits_out_a_restart(signed_in, monkeypatch):
    calls = []

    def handler(request):
        calls.append(1)
        return httpx.Response(503) if len(calls) < 3 else httpx.Response(200, json={'ok': True})

    gateway(monkeypatch, handler)
    assert asyncio.run(gradara.request('GET', '/v1/account')) == {'ok': True}
    assert len(calls) == 3


def test_gateway_unreachable_says_why(signed_in, monkeypatch):
    def handler(request):
        raise httpx.ConnectError('[SSL: CERTIFICATE_VERIFY_FAILED] certificate verify failed')

    gateway(monkeypatch, handler)
    with pytest.raises(ProviderError) as caught:
        asyncio.run(gradara.request('GET', '/v1/account'))
    assert 'Could not reach Gradara AI' in str(caught.value) and 'certificate' in str(caught.value)
