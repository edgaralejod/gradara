# SPDX-License-Identifier: Apache-2.0
"""The Proposals tab kept per model on this computer, and unsupported edits as a result."""
import json

from server import proposals


def test_entries_round_trip_and_stay_bounded(monkeypatch, tmp_path):
    monkeypatch.setattr(proposals, 'DATA', tmp_path)
    assert proposals.load('m1') == []
    entries = [{'id': f'e{i}', 'kind': 'request', 'text': 'x'} for i in range(proposals.MAX_ENTRIES + 5)]
    kept = proposals.save('m1', entries)
    assert len(kept) == proposals.MAX_ENTRIES and kept[0]['id'] == 'e5'  # the oldest go first
    assert proposals.load('m1') == kept
    monkeypatch.setattr(proposals, 'MAX_BYTES', 200)
    assert len(json.dumps(proposals.save('m1', entries))) <= 200


def test_a_deleted_run_takes_its_discussions_with_it(monkeypatch, tmp_path):
    monkeypatch.setattr(proposals, 'DATA', tmp_path)
    proposals.save('m1', [{'id': 'a', 'kind': 'results', 'runIds': ['run1', 'run2']},
                          {'id': 'b', 'kind': 'results', 'runIds': ['run3']},
                          {'id': 'c', 'kind': 'proposal'}])
    assert proposals.forget_run('run2') == 1
    assert [e['id'] for e in proposals.load('m1')] == ['b', 'c']


def test_invalid_model_ids_are_refused(monkeypatch, tmp_path):
    monkeypatch.setattr(proposals, 'DATA', tmp_path)
    for bad in ('', '../x', 'a/b', 'x' * 200):
        try:
            proposals.path_for(bad)
        except ValueError:
            continue
        raise AssertionError(bad)


def test_proposals_api_and_run_deletion(monkeypatch, tmp_path):
    from fastapi.testclient import TestClient
    from server import app as service
    monkeypatch.setattr(proposals, 'DATA', tmp_path)
    monkeypatch.setattr(service, 'RUNS', tmp_path/'runs')
    folder = tmp_path/'runs'/'run1'
    folder.mkdir(parents=True)
    (folder/'result.json').write_text('{}', encoding='utf-8')
    with TestClient(service.app, headers={'X-Gradara-Client': 'test'}) as client:
        assert client.get('/api/proposals/m1').json() == {'entries': []}
        saved = client.put('/api/proposals/m1', json={'entries': [{'id': 'a', 'kind': 'results', 'runIds': ['run1']}]})
        assert saved.json() == {'saved': 1}
        assert client.get('/api/proposals/bad.id').status_code == 400
        assert client.delete('/api/results/run1').status_code == 200
        assert client.get('/api/proposals/m1').json() == {'entries': []}


def test_an_unsupported_edit_is_a_result_not_a_failure(monkeypatch):
    import asyncio
    from fastapi.testclient import TestClient
    from server import app as service
    from server.model_edit import Unsupported
    from tests.test_model_edit import catalog, motor

    async def refuse(request, job_id, progress):
        raise Unsupported('Gradara has no hydraulic domain yet.')
    monkeypatch.setattr(service, 'edit_model', refuse)
    body = {'prompt': 'Add a hydraulic pump', 'project': motor().model_dump(), 'catalog': [d.model_dump() for d in catalog().values()]}
    with TestClient(service.app, headers={'X-Gradara-Client': 'test'}) as client:
        job = client.post('/api/models/edit', json=body).json()
        for _ in range(100):
            job = client.get(f"/api/jobs/{job['id']}").json()
            if job['status'] != 'queued' and job['status'] != 'running':
                break
            asyncio.run(asyncio.sleep(0.01))
        assert job['status'] == 'complete' and job['result'] == {'unsupported': 'Gradara has no hydraulic domain yet.'}
