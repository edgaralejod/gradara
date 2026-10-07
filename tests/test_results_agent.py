# SPDX-License-Identifier: Apache-2.0
"""Explain results: digest-grounded answers, rechecked numbers, measurement rounds, and failures."""
import asyncio
import json
import math
from unittest.mock import AsyncMock

import pytest

from server import results_agent as ra
from server.llm.providers import ProviderError
from tests.test_run_digest import loader, run, step_response


def runs():
    time, current = step_response(gain=10.0)
    _, lower = step_response(gain=8.0)
    a = run('runA', [{'key': 'l.i', 'name': 'Inductor current', 'unit': 'A', 'netId': 'n1', 'values': current},
                     {'key': 'c.v', 'name': 'Output voltage', 'unit': 'V', 'values': [v * 1.2 for v in current]}],
            time, parameters={'k': 2.0})
    b = run('runB', [{'key': 'l.i', 'name': 'Inductor current', 'unit': 'A', 'netId': 'n1', 'values': lower},
                     {'key': 'c.v', 'name': 'Output voltage', 'unit': 'V', 'values': [v * 1.2 for v in lower]}], time)
    return {'runA': a, 'runB': b}, max(current)


def request(**fields):
    return ra.ExplainRequest(**{'modelId': 'm1', 'runIds': ['runA', 'runB'],
                                'question': 'Why is the current so high at start-up?'} | fields)


def answer(**fields):
    base = {'explanation': 'The current overshoots during the start-up transient because the loop is underdamped.',
            'findings': [], 'causes': [], 'nextSteps': ['Lower the controller gain.'], 'missing': [],
            'measurements': [], 'changePrompt': None}
    return base | fields


def evidence(value, metric='max', signal='l.i', run_label='A', **extra):
    return {'run': run_label, 'signal': signal, 'metric': metric, 't0': None, 't1': None, 'at': None, 'value': value} | extra


def setup(monkeypatch, *responses):
    provider = AsyncMock(side_effect=list(responses))
    monkeypatch.setattr(ra.agent, 'structured_generation', provider)
    monkeypatch.setattr(ra.agent, 'provider_label', lambda: 'Test AI')
    return provider


def test_a_good_answer_is_checked_and_grounded(monkeypatch):
    data, peak = runs()
    provider = setup(monkeypatch, answer(
        findings=[{'text': f'The current peaks at {peak:.2f} A.', 'evidence': [evidence(round(peak, 2))]}],
        causes=[{'text': 'Underdamped PI loop.', 'kind': 'measured', 'blockIds': ['pi', 'ghost'],
                 'evidence': [evidence(25.4, metric='overshootPercent')]}]))
    result = asyncio.run(ra.explain(request(), 'job1', loader=loader(data)))
    found = result['answer']['findings'][0]['evidence'][0]
    assert found['checked'] and found['value'] == pytest.approx(peak)  # the exact recomputed value replaces the quote
    cause = result['answer']['causes'][0]
    assert cause['kind'] == 'measured' and cause['blockIds'] == ['pi'] and cause['evidence'][0]['checked']
    assert result['answer']['removed'] == 0 and result['runs'] == {'A': 'runA', 'B': 'runB'}
    assert result['signals'] == {'l.i': {'name': 'Inductor current', 'unit': 'A'}}
    assert result['provider'] == 'Test AI'
    prompt = provider.call_args.args[0]
    assert provider.call_args.kwargs['task'] == 'results'
    assert 'Why is the current so high' in prompt and '"overshootPercent"' in prompt and '"position"' not in prompt
    assert '"Gain"' in prompt  # the parameter that differs between the runs


def test_a_wrong_number_is_removed_and_an_unchecked_cause_is_a_hypothesis(monkeypatch):
    data, peak = runs()
    setup(monkeypatch, answer(
        findings=[{'text': 'The current peaks at 40 A.', 'evidence': [evidence(40.0)]},
                  {'text': 'It settles to 10 A.', 'evidence': []},        # a number nobody can check
                  {'text': 'The voltage follows the current.', 'evidence': []}],
        causes=[{'text': 'Saturated inductor.', 'kind': 'measured', 'blockIds': [], 'evidence': [evidence(99.0, metric='final')]},
                {'text': 'Too much gain.', 'kind': 'measured', 'blockIds': [], 'evidence': []}]))
    result = asyncio.run(ra.explain(request(), 'job2', loader=loader(data)))
    checked = result['answer']
    assert [f['text'] for f in checked['findings']] == ['The voltage follows the current.']
    assert [c['kind'] for c in checked['causes']] == ['hypothesis', 'hypothesis'] and not checked['causes'][0]['evidence']
    assert checked['removed'] == 3


def test_requested_measurements_are_computed_and_sent_back(monkeypatch):
    data, peak = runs()
    provider = setup(monkeypatch,
                     answer(measurements=[{'kind': 'stats', 'run': 'A', 'signal': 'l.i', 't0': 0, 't1': 0.3},
                                          {'kind': 'valueAt', 'run': 'B', 'signal': 'l.i', 'at': 0.5},
                                          {'kind': 'crossings', 'run': 'A', 'signal': 'l.i', 'level': 10},
                                          {'kind': 'correlation', 'run': 'A', 'signal': 'l.i', 'other': 'c.v'}]),
                     answer(findings=[{'text': 'Peak in the first 0.3 s.', 'evidence': [evidence(peak, t0=0.0, t1=0.3)]}]))
    result = asyncio.run(ra.explain(request(), 'job3', loader=loader(data)))
    assert provider.await_count == 2
    second = provider.call_args_list[1].args[0]
    assert 'Measurements you asked for' in second and 'measurements must be empty' in second
    measured = result['measurements']
    assert measured[0]['stats']['max'] == pytest.approx(peak, rel=1e-4)
    assert measured[1]['value'] == pytest.approx(8.0, rel=0.03)
    assert measured[2]['count'] >= 2 and measured[3]['correlation'] == pytest.approx(1.0)
    assert result['answer']['findings'][0]['evidence'][0]['checked']


def test_a_signal_that_was_not_logged_cannot_be_measured(monkeypatch):
    data, _ = runs()
    setup(monkeypatch,
          answer(measurements=[{'kind': 'stats', 'run': 'A', 'signal': 'motor.w'}]),
          answer(missing=['Motor speed was not recorded.'], nextSteps=['Log the speed sensor output and run again.'],
                 findings=[{'text': 'The speed peaks.', 'evidence': [evidence(3.0, signal='motor.w')]}],
                 changePrompt='Log sensor.y in the Data Inspector.'))
    result = asyncio.run(ra.explain(request(), 'job4', loader=loader(data)))
    assert 'error' in result['measurements'][0]
    assert result['answer']['missing'] == ['Motor speed was not recorded.']
    assert result['answer']['findings'] == [] and result['answer']['removed'] == 1
    assert result['answer']['changePrompt'] == 'Log sensor.y in the Data Inspector.'


def test_follow_ups_carry_the_thread(monkeypatch):
    data, _ = runs()
    provider = setup(monkeypatch, answer())
    thread = [{'question': 'What is the peak?', 'answer': 'About 12.5 A at 0.06 s.'}]
    asyncio.run(ra.explain(request(question='And in run B?', thread=thread), 'job5', loader=loader(data)))
    prompt = provider.call_args.args[0]
    assert prompt.index('Earlier question:\nWhat is the peak?') < prompt.index('Question:\nAnd in run B?')
    with pytest.raises(ValueError):
        request(thread=[thread[0]] * (ra.MAX_TURNS + 1))


def test_provider_errors_and_cancellation_propagate(monkeypatch):
    data, _ = runs()
    setup(monkeypatch, ProviderError('Gradara AI did not answer in time.', 504))
    with pytest.raises(ProviderError):
        asyncio.run(ra.explain(request(), 'job6', loader=loader(data)))
    setup(monkeypatch, asyncio.CancelledError())
    with pytest.raises(asyncio.CancelledError):
        asyncio.run(ra.explain(request(), 'job7', loader=loader(data)))


def test_preview_is_exactly_the_first_prompt(monkeypatch):
    data, _ = runs()
    provider = setup(monkeypatch, answer())
    shown = ra.preview(request(), loader(data))
    asyncio.run(ra.explain(request(), 'job8', loader=loader(data)))
    assert shown['prompt'] == provider.call_args.args[0] and shown['characters'] == len(shown['prompt'])
    assert 'simulation_res' not in shown['prompt']


def test_check_tolerances():
    data, peak = runs()
    runs_ = ra.Runs(request(), loader(data))
    window = (0.0, 1.0)
    assert ra.check(ra.Evidence(**evidence(peak * 1.01)), runs_, window) == pytest.approx(peak)
    assert ra.check(ra.Evidence(**evidence(peak * 1.2)), runs_, window) is None
    t_max = next(s for s in data['runA']['series'] if s['key'] == 'l.i')
    assert ra.check(ra.Evidence(**evidence(0.0, metric='tMax', run_label='Z')), runs_, window) is None
    assert ra.check(ra.Evidence(**evidence(0.5, metric='valueAt', at=0.5)), runs_, window) is None
    assert math.isfinite(ra.check(ra.Evidence(**evidence(10.0, metric='final')), runs_, window))
    assert t_max


def test_explain_api_is_a_job_and_refuses_bad_runs(monkeypatch, tmp_path):
    from fastapi.testclient import TestClient
    from server import app as service
    monkeypatch.setattr(service, 'RUNS', tmp_path)
    folder = tmp_path/'run1'
    folder.mkdir()
    (folder/'simulation_res.csv').write_text('time,i.y\n0,0\n0.5,4\n1,2\n', encoding='utf-8')
    (folder/'result.json').write_text(json.dumps({'id': 'run1', 'duration': 1, 'samples': 3, 'snapshot': {'modelId': 'm1'},
                                                  'series': [{'key': 'i.y', 'name': 'Current', 'unit': 'A', 'blockId': 'i'}]}),
                                      encoding='utf-8')
    setup(monkeypatch, answer(findings=[{'text': 'Peak.', 'evidence': [evidence(4.0, signal='i.y')]}]))
    body = {'modelId': 'm1', 'runIds': ['run1'], 'question': 'What is the peak?'}
    with TestClient(service.app, headers={'X-Gradara-Client': 'test'}) as client:
        assert client.post('/api/results/explain', json=body | {'runIds': ['gone']}).status_code == 404
        assert client.post('/api/results/explain', json=body | {'modelId': 'other'}).status_code == 404
        preview = client.post('/api/results/explain/preview', json=body).json()
        assert 'What is the peak?' in preview['prompt']
        job = client.post('/api/results/explain', json=body).json()
        assert job['kind'] == 'results'
        for _ in range(100):
            job = client.get(f"/api/jobs/{job['id']}").json()
            if job['status'] in {'complete', 'failed'}:
                break
            asyncio.run(asyncio.sleep(0.02))
        assert job['status'] == 'complete', job
        assert job['result']['answer']['findings'][0]['evidence'][0]['checked']
