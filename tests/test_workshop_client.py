# SPDX-License-Identifier: Apache-2.0
"""The workshop client in the local service: settings, dispatching, progress and published layers."""
import asyncio
import io
import json
import zipfile

import pytest

from server import credentials, settings, workshop


@pytest.fixture
def isolated(monkeypatch, tmp_path):
    monkeypatch.setattr(settings, 'SETTINGS_FILE', tmp_path/'settings.json')
    monkeypatch.setattr(credentials, 'FALLBACK', tmp_path/'.credentials.json')
    monkeypatch.setenv('GRADARA_CREDENTIAL_STORE', 'file')
    return tmp_path


def fake_github(monkeypatch, routes):
    calls = []

    async def github(method, path, *, json_body=None, auth=True, accept=None, raw=False):
        calls.append((method, path, json_body))
        for prefix, answer in routes.items():
            if path.startswith(prefix):
                return answer(path, json_body) if callable(answer) else answer
        raise AssertionError(f'unexpected {method} {path}')
    monkeypatch.setattr(workshop, 'github', github)
    return calls


def test_repository_setting(isolated):
    assert workshop.repository() == workshop.DEFAULT_REPOSITORY
    assert workshop.set_repository('https://github.com/me/gradara-fork/') == 'me/gradara-fork'
    with pytest.raises(workshop.WorkshopError):
        workshop.set_repository('not a repo')
    assert workshop.set_repository('') == workshop.DEFAULT_REPOSITORY


def test_ids_are_what_the_pipeline_accepts():
    layer = workshop.new_id('f', 'Plot the speed error, please!')
    assert workshop.REQUEST_ID.fullmatch(layer) and layer.startswith('f-plot-the-speed-error-please-')
    assert workshop.REQUEST_ID.fullmatch(workshop.new_id('s'))


def test_dispatch_sends_the_inputs(isolated, monkeypatch):
    calls = fake_github(monkeypatch, {'/repos/edgaralejod/gradara/actions': {}, '/repos/edgaralejod/gradara': {'default_branch': 'main'}})
    stack = [{'id': 'f-one', 'title': 'One', 'commit': 'a' * 40}]
    asyncio.run(workshop.dispatch('build', 'f-two-261007-abc123', request='Add two', title='Two', base='v0.7.0',
                                  stack=stack, budget=7))
    method, path, body = calls[-1]
    assert (method, path) == ('POST', '/repos/edgaralejod/gradara/actions/workflows/workshop.yml/dispatches')
    assert body['ref'] == 'main' and body['inputs']['mode'] == 'build' and body['inputs']['budget'] == '7.00'
    assert json.loads(body['inputs']['stack']) == stack
    with pytest.raises(workshop.WorkshopError):
        asyncio.run(workshop.dispatch('build', 'Bad ID'))


def zipped(files):
    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, 'w') as archive:
        for name, value in files.items():
            archive.writestr(name, json.dumps(value))
    return buffer.getvalue()


def test_progress_follows_the_run_and_reads_its_reports(isolated, monkeypatch):
    run = {'id': 9, 'display_title': 'Workshop build · f-two-261007-abc123', 'status': 'completed', 'conclusion': 'success',
           'html_url': 'https://github.com/x', 'run_started_at': 'now'}
    jobs = {'jobs': [{'steps': [{'name': 'Implement the request', 'status': 'completed'},
                                {'name': 'Gate · Core CI', 'status': 'completed'},
                                {'name': 'Publish the layer and the draft pull request', 'status': 'completed'},
                                {'name': 'Cost report', 'status': 'completed'}]}]}
    archive = zipped({'report.json': {'stage': 'published', 'message': 'layer-f-two-261007-abc123-v0.7.0'},
                      'cost.json': {'totalUsd': 2.5, 'runs': {}}})
    fake_github(monkeypatch, {
        '/repos/edgaralejod/gradara/actions/workflows/workshop.yml/runs': {'workflow_runs': [run]},
        '/repos/edgaralejod/gradara/actions/runs/9/jobs': jobs,
        '/repos/edgaralejod/gradara/actions/runs/9/artifacts': {'artifacts': [{'id': 4, 'name': 'workshop-f-two-261007-abc123'}]},
        '/repos/edgaralejod/gradara/actions/artifacts/4/zip': archive,
    })
    out = asyncio.run(workshop.progress('f-two-261007-abc123'))
    assert out['stage'] == 'Publishing' and out['conclusion'] == 'success'
    assert out['report']['stage'] == 'published' and out['cost']['totalUsd'] == 2.5 and out['layer'] is None
    fake_github(monkeypatch, {'/repos/edgaralejod/gradara/actions/workflows/workshop.yml/runs': {'workflow_runs': []}})
    assert asyncio.run(workshop.progress('f-none-261007-abc123'))['status'] == 'queued'


def test_layers_for_this_version_only(isolated, monkeypatch):
    def release(tag, assets, draft=False):
        return {'tag_name': tag, 'name': f'Personal feature: {tag}', 'draft': draft, 'published_at': 'now', 'html_url': '',
                'assets': [{'name': n, 'browser_download_url': f'https://github.com/o/r/releases/download/{tag}/{n}'} for n in assets]}
    complete = ['gradara-layer-0.7.0-f-a.tar.gz', 'gradara-layer-0.7.0-f-a.tar.gz.sig', 'layer.json']
    fake_github(monkeypatch, {'/repos/edgaralejod/gradara/releases': [
        release('layer-f-a-v0.7.0', complete),
        release('layer-f-a-v0.6.9', complete),
        release('layer-f-b-v0.7.0', ['gradara-layer-0.7.0-f-b.tar.gz']),     # unsigned: never offered
        release('layer-f-c-v0.7.0', complete, draft=True),
        release('v0.7.0', ['Gradara-win-x64.exe']),
    ]})

    class Response:
        status_code = 200

        def json(self):
            return {'features': [{'id': 'f-a', 'title': 'A', 'commit': 'c' * 40}]}

    class Client:
        def __init__(self, *a, **k):
            pass

        async def __aenter__(self):
            return self

        async def __aexit__(self, *a):
            return False

        async def get(self, url, headers=None):
            assert url.endswith('/layer-f-a-v0.7.0/layer.json')
            return Response()
    monkeypatch.setattr(workshop.httpx, 'AsyncClient', Client)
    found = asyncio.run(workshop.layers('0.7.0'))
    assert [layer['id'] for layer in found] == ['f-a']
    assert found[0]['signatureUrl'].endswith('.tar.gz.sig') and found[0]['features'][0]['title'] == 'A'


def test_requests_need_a_token(isolated):
    with pytest.raises(workshop.WorkshopError, match='GitHub token'):
        asyncio.run(workshop.github('GET', '/user'))


def test_workshop_api_validates_requests(isolated, monkeypatch):
    from fastapi.testclient import TestClient
    from server import app as service
    sent = []

    async def dispatch(mode, request_id, **kw):
        sent.append((mode, request_id, kw))
        return request_id
    monkeypatch.setattr(service.workshop, 'dispatch', dispatch)
    with TestClient(service.app, headers={'X-Gradara-Client': 'test'}) as client:
        assert client.post('/api/workshop/requests', json={'mode': 'build', 'request': 'short'}).status_code == 422
        assert client.post('/api/workshop/requests', json={'mode': 'rebuild'}).status_code == 422
        assert client.post('/api/workshop/requests', json={'mode': 'build', 'request': 'x' * 20, 'budget': 99}).status_code == 422
        answer = client.post('/api/workshop/requests', json={'mode': 'build', 'request': 'Plot the speed error with a band',
                                                             'title': 'Speed error', 'budget': 5}).json()
        assert answer['requestId'].startswith('f-speed-error-')
        assert sent[-1][0] == 'build' and sent[-1][2]['base'] == f'v{service.VERSION}'
        assert client.put('/api/workshop', json={'repository': 'nope'}).status_code == 422
