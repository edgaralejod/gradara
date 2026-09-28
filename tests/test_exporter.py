# SPDX-License-Identifier: Apache-2.0
"""Controller C export: contract, repair, packaging, and replay of the servo reference."""
import asyncio
import csv
import json
import shutil
import subprocess
import uuid
import zipfile
from pathlib import Path
from unittest.mock import AsyncMock
import pytest
from server import exporter
from server.engine import RUNS, simulate
from server.models import Project

ROOT = Path(__file__).parents[1]
REFERENCE = ROOT/'tests/fixtures/servo-controller'
FLAGS = ['-std=c11', '-Wall', '-Wextra', '-Werror']


def servo() -> Project:
    return Project.model_validate(json.loads((ROOT/'models/examples/servo.json').read_text(encoding='utf-8')))


def reference_export():
    return {'header': (REFERENCE/'gradara_controller.h').read_text(encoding='utf-8'),
            'source': (REFERENCE/'gradara_controller.c').read_text(encoding='utf-8'),
            'notes': 'Call gradara_controller_step every 1 ms.'}


def compiler():
    return shutil.which('gcc') or shutil.which('cc')


def setup(monkeypatch, tmp_path, responses, compiles):
    monkeypatch.setattr(exporter, 'EXPORTS', tmp_path)
    provider = AsyncMock(side_effect=responses)
    monkeypatch.setattr(exporter.agent, 'structured_generation', provider)
    build = AsyncMock(side_effect=compiles)
    monkeypatch.setattr(exporter.engines, 'compile_c', build)
    return provider, build


def test_rejects_a_block_that_is_not_a_controller(monkeypatch, tmp_path):
    provider, _ = setup(monkeypatch, tmp_path, [], [])
    with pytest.raises(ValueError, match='marked as a controller'):
        asyncio.run(exporter.export_controller(servo(), 'drive', 'job1'))
    with pytest.raises(ValueError, match='marked as a controller'):
        asyncio.run(exporter.export_controller(servo(), 'missing', 'job1'))
    provider.assert_not_awaited()


def test_packages_a_compiled_export(monkeypatch, tmp_path):
    provider, build = setup(monkeypatch, tmp_path, [reference_export()], [(0, '')])
    result = asyncio.run(exporter.export_controller(servo(), 'controller', 'job2'))
    assert result['compiled'] and result['blockId'] == 'controller'
    assert result['compiler'] == exporter.COMPILE_COMMAND
    assert provider.await_count == 1 and build.await_count == 1
    folder = tmp_path/'job2'
    with zipfile.ZipFile(folder/'gradara-controller.zip') as archive:
        assert sorted(archive.namelist()) == ['README.md', 'controller-package.json',
                                              'gradara_controller.c', 'gradara_controller.h']
    assert 'Call gradara_controller_step every 1 ms.' in (folder/'README.md').read_text(encoding='utf-8')


def test_boundary_states_the_sampling_contract(monkeypatch, tmp_path):
    provider, _ = setup(monkeypatch, tmp_path, [reference_export()], [(0, '')])
    asyncio.run(exporter.export_controller(servo(), 'controller', 'job3'))
    package = json.loads((tmp_path/'job3'/'controller-package.json').read_text(encoding='utf-8'))
    target = package['target']
    assert target['samplePeriod'] == {'parameter': 'samplePeriod', 'value': 0.001, 'unit': 's'}
    assert target['discreteStates'] == ['e', 'integral', 'derivative', 'errorPrev']
    assert target['sampled'] is True
    assert '"discreteStates"' in provider.call_args.args[0]


def test_a_failed_compile_gets_exactly_one_repair(monkeypatch, tmp_path):
    broken = reference_export() | {'source': 'int broken('}
    provider, build = setup(monkeypatch, tmp_path, [broken, reference_export()],
                            [(1, 'gradara_controller.c:1: error: expected declaration'), (0, '')])
    asyncio.run(exporter.export_controller(servo(), 'controller', 'job4'))
    assert provider.await_count == 2 and build.await_count == 2
    repair = provider.call_args_list[1].args[0]
    assert 'Repair this compiler output' in repair and 'expected declaration' in repair


def test_two_failed_compiles_fail_the_export(monkeypatch, tmp_path):
    broken = reference_export() | {'source': 'int broken('}
    setup(monkeypatch, tmp_path, [broken, broken], [(1, 'error one'), (1, 'error two')])
    with pytest.raises(ValueError, match='needs a revision: error two'):
        asyncio.run(exporter.export_controller(servo(), 'controller', 'job5'))
    assert not (tmp_path/'job5'/'gradara-controller.zip').exists()


def test_export_api_is_a_job(monkeypatch, tmp_path):
    from fastapi.testclient import TestClient
    from server import app as service
    monkeypatch.setattr(service, 'JOBS', {})
    monkeypatch.setattr(service, 'TASKS', {})
    monkeypatch.setattr(service, 'EXPORTS', tmp_path)
    setup(monkeypatch, tmp_path, [reference_export()], [(0, '')])
    with TestClient(service.app, headers={'X-Gradara-Client': 'test'}) as client:
        body = {'project': servo().model_dump(exclude_none=True), 'blockId': 'controller'}
        ident = client.post('/api/exports', json=body).json()['id']
        job = client.get('/api/jobs/'+ident).json()
        assert job['kind'] == 'export' and job['status'] == 'complete'
        assert job['result']['compiled']
        download = client.get(f"/api/exports/{job['result']['id']}/download")
        assert download.status_code == 200
        assert download.headers['content-type'] == 'application/zip'


@pytest.mark.skipif(compiler() is None, reason='No C compiler on this machine.')
def test_reference_controller_compiles_with_export_flags(tmp_path):
    subprocess.run([compiler(), *FLAGS, '-c', str(REFERENCE/'gradara_controller.c'), '-o', str(tmp_path/'c.o')],
                   check=True, capture_output=True)


@pytest.mark.integration
@pytest.mark.skipif(compiler() is None, reason='No C compiler on this machine.')
def test_reference_c_reproduces_the_simulated_controller(tmp_path):
    """Feed the solver's sampled inputs to the C step; compare with the solver's controller output."""
    project = servo()
    result = asyncio.run(simulate(project, 'servoreplay'+uuid.uuid4().hex[:10]))
    period = next(p.value for b in project.blocks if b.id == 'controller' for p in b.definition.parameters
                  if p.id == 'samplePeriod')
    with (RUNS/result['id']/'simulation_res.csv').open(encoding='utf-8') as stream:
        rows = list(csv.DictReader(stream))
    # Each sample instant is logged as a pre-event and a post-event row; the
    # post-event row holds the inputs the when-clause read and its new output.
    # The first such row per sample index counts: the solver repeats rows at
    # the start and writes a closing duplicate at stop time.
    by_index = {}
    for i in range(1, len(rows)):
        t = float(rows[i]['time'])
        k = round(t/period)
        if rows[i]['time'] == rows[i-1]['time'] and abs(t/period - k) < 1e-6:
            by_index.setdefault(k, rows[i])
    samples = [by_index[k] for k in sorted(by_index)]
    assert sorted(by_index) == list(range(round(project.duration/period) + 1))
    harness = tmp_path/'harness'
    subprocess.run([compiler(), *FLAGS, str(REFERENCE/'gradara_controller.c'), str(REFERENCE/'harness.c'),
                    '-o', str(harness)], check=True, capture_output=True)
    stdin = ''.join(f"{r['controller.reference']} {r['controller.measured']}\n" for r in samples)
    output = subprocess.run([str(harness)], input=stdin, capture_output=True, text=True, check=True, encoding='utf-8', errors='replace').stdout.split()
    assert len(output) == len(samples)
    worst = max(abs(float(y) - float(r['controller.y'])) for y, r in zip(output, samples))
    assert worst < 1e-6
    # The comparison covers saturation, the step, and settling, not only a quiet tail.
    assert any(abs(float(r['controller.y'])) >= 23.999 for r in samples)
    assert float(samples[-1]['sensor.y']) == pytest.approx(1, abs=0.01)
