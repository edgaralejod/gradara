# SPDX-License-Identifier: Apache-2.0
"""AI diagnosis: explanation, optional fix through the edit pipeline, and run-context guards."""
import asyncio
import json
from unittest.mock import AsyncMock
import pytest
from server import diagnose_agent as doctor
from server.diagnostics import Diagnostic
from tests.test_model_edit import catalog
from tests.test_diagnostics import positive_loop


def problem():
    return Diagnostic(id='d1', source='runtime', message='The model has an algebraic loop.', detail='Solving linear system 12 failed',
                      blockIds=['gain', 'error'], hint='Check feedback signs and gains.')


def request(**fields):
    model, _, _ = positive_loop()
    model.modelId = 'doc1'
    return doctor.DiagnoseRequest(project=model, diagnostics=[problem()], catalog=list(catalog().values()), **fields)


DIAGNOSIS = {'summary': 'Subtract and Gain form a loop with total gain 1.',
             'causes': [{'diagnosticIds': ['d1', 'd99'], 'blockIds': ['gain', 'ghost'], 'explanation': 'Unity positive feedback.'}],
             'fixable': True, 'manualSteps': ['Lower the gain below 1.'], 'editPrompt': 'Set gain.k to 0.5.'}


def setup(monkeypatch, tmp_path, response=DIAGNOSIS):
    monkeypatch.setattr(doctor, 'RUNS', tmp_path)
    provider = AsyncMock(return_value=response)
    monkeypatch.setattr(doctor.agent, 'structured_generation', provider)
    monkeypatch.setattr(doctor.agent, 'provider_label', lambda: 'Test AI')
    editor = AsyncMock(return_value={'verified': True, 'changes': []})
    monkeypatch.setattr(doctor, 'edit_model', editor)
    return provider, editor


def test_explain_only_never_edits(monkeypatch, tmp_path):
    provider, editor = setup(monkeypatch, tmp_path)
    result = asyncio.run(doctor.diagnose(request(question='Why does it fail at 0.2 s?'), 'job1'))
    assert result['proposal'] is None and result['provider'] == 'Test AI'
    cause = result['diagnosis']['causes'][0]
    assert cause['blockIds'] == ['gain'] and cause['diagnosticIds'] == ['d1']  # unknown IDs are dropped
    assert provider.call_args.kwargs['task'] == 'diagnose'
    prompt = provider.call_args.args[0]
    assert 'Why does it fail at 0.2 s?' in prompt and 'algebraic loop' in prompt and '"position"' not in prompt
    editor.assert_not_awaited()


def test_fix_runs_the_edit_pipeline_as_a_priced_part(monkeypatch, tmp_path):
    _, editor = setup(monkeypatch, tmp_path)
    parts = []
    async def edit(req, job_id, progress):
        parts.append(doctor.dispatch.current_job.get())
        assert req.prompt == 'Set gain.k to 0.5.' and req.verify and req.selection == ['gain']
        assert 'algebraic loop' in req.context
        return {'verified': True, 'changes': [{'op': 'set_parameter'}]}
    monkeypatch.setattr(doctor, 'edit_model', edit)
    token = doctor.dispatch.current_job.set({'id': 'job2', 'kind': 'diagnose'})
    try:
        result = asyncio.run(doctor.diagnose(request(proposeFix=True), 'job2'))
    finally:
        doctor.dispatch.current_job.reset(token)
    assert result['proposal'] == {'verified': True, 'changes': [{'op': 'set_parameter'}]}
    assert parts == [{'id': 'job2', 'kind': 'diagnose', 'part': 'edit'}]


def test_unfixable_problems_do_not_edit(monkeypatch, tmp_path):
    _, editor = setup(monkeypatch, tmp_path, DIAGNOSIS | {'fixable': False, 'editPrompt': 'ignored'})
    result = asyncio.run(doctor.diagnose(request(proposeFix=True), 'job3'))
    assert result['proposal'] is None and result['diagnosis']['editPrompt'] is None
    editor.assert_not_awaited()


def test_a_failed_fix_keeps_the_diagnosis(monkeypatch, tmp_path):
    setup(monkeypatch, tmp_path)
    monkeypatch.setattr(doctor, 'edit_model', AsyncMock(side_effect=ValueError('The edit could not be applied: no such block')))
    result = asyncio.run(doctor.diagnose(request(proposeFix=True), 'job4'))
    assert result['proposal'] is None and 'no such block' in result['fixError']
    assert result['diagnosis']['summary'].startswith('Subtract')


@pytest.mark.parametrize('run_id, model_id, expected', [
    ('run1', 'doc1', True), ('run1', 'other', False), ('../run1', 'doc1', False), ('missing', 'doc1', False), (None, 'doc1', False)])
def test_run_context_requires_the_same_document(monkeypatch, tmp_path, run_id, model_id, expected):
    provider, _ = setup(monkeypatch, tmp_path)
    folder = tmp_path/'run1'
    folder.mkdir()
    (folder/'project.json').write_text(json.dumps({'modelId': model_id}))
    (folder/'model.mo').write_text('model System\n  Gradara.Gain gain;\nend System;')
    (folder/'diagnostics.json').write_text(json.dumps({'diagnostics': [{'detail': 'LOG_ASSERT linear system 12'}]}))
    asyncio.run(doctor.diagnose(request(runId=run_id), 'job5'))
    prompt = provider.call_args.args[0]
    assert ('Emitted Modelica source' in prompt) == expected
    assert ('LOG_ASSERT linear system 12' in prompt) == expected


def test_diagnose_api_is_a_job(monkeypatch, tmp_path):
    from fastapi.testclient import TestClient
    from server import app as service
    monkeypatch.setattr(service, 'JOBS', {})
    monkeypatch.setattr(service, 'TASKS', {})
    async def fake(req, job_id, progress):
        progress('Reading the problems')
        return {'diagnosis': {}, 'proposal': None}
    monkeypatch.setattr(service, 'diagnose', fake)
    body = request().model_dump(exclude_none=True)
    with TestClient(service.app, headers={'X-Gradara-Client': 'test'}) as client:
        ident = client.post('/api/diagnose', json=body).json()['id']
        job = client.get('/api/jobs/'+ident).json()
        assert job['kind'] == 'diagnose' and job['status'] == 'complete'
        assert client.post('/api/diagnose', json={**body, 'diagnostics': []}).status_code == 422


def test_a_failed_run_never_calls_the_ai(monkeypatch, tmp_path):
    from fastapi.testclient import TestClient
    from server import app as service
    monkeypatch.setattr(service, 'JOBS', {})
    monkeypatch.setattr(service, 'TASKS', {})
    called = AsyncMock(side_effect=AssertionError('The provider must not be called'))
    monkeypatch.setattr(doctor.agent, 'structured_generation', called)
    monkeypatch.setattr(service.dispatch, 'generate', called)
    model, _, _ = positive_loop()
    model.wires = []
    with TestClient(service.app, headers={'X-Gradara-Client': 'test'}) as client:
        ident = client.post('/api/runs', json=model.model_dump(exclude_none=True)).json()['id']
        assert client.get('/api/jobs/'+ident).json()['status'] == 'failed'
    called.assert_not_awaited()
