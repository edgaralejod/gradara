"""A running simulation's stage, read from its job folder (server/run_progress.py), and reported on its job."""
import asyncio
import json
import time
import uuid
from pathlib import Path

import pytest

from server import engine, engines
from server.models import Project
from server.run_progress import last_time, message, stage

ROOT = Path(__file__).resolve().parent.parent


def test_the_stage_follows_the_files_openmodelica_leaves(tmp_path):
    assert stage(tmp_path, 4) == {'phase': 'preparing'}
    (tmp_path/'model.mo').write_text('model M end M;', encoding='utf-8')
    assert stage(tmp_path, 4) == {'phase': 'translating'}
    (tmp_path/'simulation.makefile').write_text('', encoding='utf-8')
    assert stage(tmp_path, 4) == {'phase': 'compiling'}
    (tmp_path/'simulation.exe').write_bytes(b'')
    assert stage(tmp_path, 4) == {'phase': 'starting'}
    result = tmp_path/'simulation_res.csv'
    result.write_text('"time","x"\n', encoding='utf-8')
    assert stage(tmp_path, 4) == {'phase': 'simulating', 'time': 0.0, 'fraction': 0.0}
    result.write_text('"time","x"\n0,1\n1,2\n1.5,3', encoding='utf-8')  # the last row is still being written
    assert stage(tmp_path, 4) == {'phase': 'simulating', 'time': 1.0, 'fraction': 0.25}
    result.write_text('"time","x"\n0,1\n4.0000003,2\n', encoding='utf-8')  # DASSL's row just past the stop time
    assert stage(tmp_path, 4)['fraction'] == 1.0
    assert message({'phase': 'simulating', 'fraction': 0.426}) == 'Simulating · 43%'
    assert message({'phase': 'compiling'}) == 'Compiling the simulation'


def test_the_last_row_is_found_when_rows_are_longer_than_the_window(tmp_path):
    path = tmp_path/'simulation_res.csv'
    row = lambda t: ','.join([repr(t)] + ['1.2345678901234567'] * 9000)  # about 170 kB per row
    path.write_text('"time",' + ','.join(f'"v{i}"' for i in range(9000)) + '\n' + row(0.5) + '\n' + row(0.75) + '\n',
                    encoding='utf-8')
    assert last_time(path) == 0.75
    assert last_time(tmp_path/'missing.csv') is None


def test_a_run_reports_each_stage_on_its_job(tmp_path, monkeypatch):
    monkeypatch.setattr(engine, 'RUNS', tmp_path)

    async def fake(folder, config, name):
        # What OpenModelica leaves behind, step by step.
        await asyncio.sleep(0.6)
        (folder/'simulation.makefile').write_text('', encoding='utf-8')
        await asyncio.sleep(0.6)
        (folder/'simulation').write_bytes(b'')
        await asyncio.sleep(0.6)
        (folder/'simulation_res.csv').write_text('time,y\n0,0\n1,1\n', encoding='utf-8')
        await asyncio.sleep(0.6)
        with (folder/'simulation_res.csv').open('a', encoding='utf-8') as f:
            f.write('2,2\n3,3\n4,4\n')
        return {'result': {}, 'diagnostics': ''}
    monkeypatch.setattr(engines, 'execute', fake)
    project = Project.model_validate(json.loads((ROOT/'models'/'examples'/'dc.json').read_text(encoding='utf-8')))
    stages = []
    result = asyncio.run(engine.simulate(project, 'progress' + uuid.uuid4().hex[:8], stages.append))
    phases = [s['phase'] for s in stages]
    assert phases[0] == 'preparing' and phases[-1] == 'reading'
    for expected in ('translating', 'compiling', 'starting', 'simulating'):
        assert expected in phases
    assert phases.index('compiling') < phases.index('starting') < phases.index('simulating')
    assert {'phase': 'simulating', 'time': 1.0, 'fraction': 0.25} in stages
    assert result['duration'] == 4


def test_the_job_carries_the_stage(monkeypatch, tmp_path):
    from fastapi.testclient import TestClient
    from server import app as service
    monkeypatch.setattr(service, 'JOBS', {})
    monkeypatch.setattr(service, 'TASKS', {})

    async def slow(project, job_id, on_stage=None):
        on_stage({'phase': 'simulating', 'time': 2.0, 'fraction': 0.5})
        await asyncio.sleep(30)
    monkeypatch.setattr(service, 'simulate', slow)
    project = json.loads((ROOT/'models'/'examples'/'dc.json').read_text(encoding='utf-8'))
    with TestClient(service.app, headers={'X-Gradara-Client': 'test'}) as client:
        ident = client.post('/api/runs', json=project).json()['id']
        for _ in range(50):
            job = client.get('/api/jobs/' + ident).json()
            if job.get('stage'):
                break
            time.sleep(0.02)
        assert job['stage'] == {'phase': 'simulating', 'time': 2.0, 'fraction': 0.5}
        assert job['progress'] == 'Simulating · 50%'
        client.delete('/api/jobs/' + ident)
