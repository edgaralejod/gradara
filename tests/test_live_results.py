# SPDX-License-Identifier: Apache-2.0
"""Live results: reading a running simulation's growing result file (server/live_results.py)."""
import asyncio
import math
import uuid

import pytest
from fastapi.testclient import TestClient

from server import live_results
from server.models import Project


def project(**extra):
    def block(ident, kind, ports, logged=None):
        return {'id': ident, 'position': {'x': 0, 'y': 0}, **({'logged': logged} if logged else {}), 'definition': {
            'kind': kind, 'name': ident, 'description': '', 'domain': 'signal', 'symbol': '', 'equations': 'y = u;',
            'parameters': [], 'ports': [{'id': i, 'name': i, 'direction': d, 'domain': 'signal'} for i, d in ports]}}
    return Project.model_validate({'name': 'live', 'revision': 1, 'duration': 1.0, 'blocks': [
        block('a', 'gain', [('u', 'input'), ('y', 'output')], ['y']),
        block('b', 'gain', [('u', 'input'), ('y', 'output')], ['y']),
    ], 'wires': [{'id': 'w', 'source': 'a', 'sourceHandle': 'y', 'target': 'b', 'targetHandle': 'u'}], **extra})


@pytest.fixture
def run(tmp_path):
    job = 'job' + uuid.uuid4().hex[:8]
    live_results.register(job, project(), tmp_path)
    yield job, tmp_path/'simulation_res.csv'
    live_results.unregister(job)


def write(path, text, mode='a'):
    with path.open(mode, encoding='utf-8') as f:
        f.write(text)


def test_nothing_until_the_header_is_complete(run):
    job, csv = run
    assert live_results.read(job, 0)['pending']
    write(csv, '"time","a.y","b.y","hidden.x"', 'w')
    assert live_results.read(job, 0)['pending']
    write(csv, '\n')
    first = live_results.read(job, 0)
    assert first['row'] == 0 and [m['key'] for m in first['meta']] == ['a.y', 'b.y'] and first['series'] == []


def test_rows_arrive_in_order_and_a_partial_row_waits(run):
    job, csv = run
    write(csv, '"time","a.y","b.y","hidden.x"\n0,1,2,9\n0.1,1.5,2.5,9\n0.2,2', 'w')
    first = live_results.read(job, 0)
    assert first['row'] == 2 and first['time'] == [0, 0.1]
    assert first['series'] == [{'key': 'a.y', 'values': [1, 1.5]}, {'key': 'b.y', 'values': [2, 2.5]}]
    assert first['fraction'] == pytest.approx(0.1) and 'meta' in first
    # The partial row completes; only it is new.
    write(csv, ',3,9\n')
    second = live_results.read(job, 2)
    assert second['row'] == 3 and second['time'] == [0.2] and 'meta' not in second and not second['reset']
    # Asking again from the same cursor gives the same rows (a lost answer is safe to repeat).
    assert live_results.read(job, 2)['time'] == [0.2]
    # Nothing new: no rows, and the fraction is left to the client.
    idle = live_results.read(job, 3)
    assert idle['time'] == [] and 'fraction' not in idle


def test_an_unknown_cursor_starts_again(run):
    job, csv = run
    write(csv, '"time","a.y","b.y"\n0,1,2\n0.5,1,2\n', 'w')
    again = live_results.read(job, 99)
    assert again['reset'] and again['row'] == 2 and again['time'] == [0, 0.5] and 'meta' in again


def test_non_finite_rows_and_rows_past_the_stop_time_are_left_out(run):
    job, csv = run
    write(csv, '"time","a.y","b.y"\n0,1,2\n0.5,nan,2\n1,1,inf\n1,3,4\n1.2,5,6\n', 'w')
    data = live_results.read(job, 0)
    assert data['time'] == [0, 1] and data['series'][0]['values'] == [1, 3]
    assert data['row'] == 5 and data['fraction'] == 1


def test_a_long_stretch_keeps_each_bins_extremes():
    times = [i / 1000 for i in range(1000)]
    spike = [0.0] * 1000
    spike[537] = 9.0
    dip = [0.0] * 1000
    dip[12] = -4.0
    t, (s, d) = live_results.envelope(times, [spike, dip], bins=10)
    assert len(t) == 20 and max(s) == 9 and min(d) == -4
    # Each bin's points are in time order, at the bin's first and last time.
    assert t[:2] == [0.0, 0.099] and all(a <= b for a, b in zip(t, t[1:]))
    # Short stretches pass through.
    assert live_results.envelope(times[:10], [spike[:10]], bins=10) == (times[:10], [spike[:10]])


def test_a_burst_is_read_at_a_stride_but_ends_on_the_newest_row(run, monkeypatch):
    job, csv = run
    monkeypatch.setattr(live_results, 'WORK', 1000)
    rows = ''.join(f'{i / 10000},{math.sin(i)},{i}\n' for i in range(10000))
    write(csv, '"time","a.y","b.y"\n' + rows, 'w')
    data = live_results.read(job, 0)
    assert data['row'] == 10000 and data['time'][-1] == pytest.approx(0.9999)
    assert len(data['time']) <= 2 * live_results.BINS


def test_a_missing_logged_signal_disables_the_stream(run):
    job, csv = run
    write(csv, '"time","a.y"\n0,1\n', 'w')
    data = live_results.read(job, 0)
    assert data['unavailable'] and data['series'] == []


def test_the_endpoint_answers_done_after_the_run(run):
    from server import app as module
    job, csv = run
    write(csv, '"time","a.y","b.y"\n0,1,2\n', 'w')
    client = TestClient(module.app, headers={'X-Gradara-Client': 'workbench'})
    assert client.get(f'/api/runs/{job}/live?after=0').json()['row'] == 1
    assert client.get('/api/runs/nosuchjob/live').json() == {'done': True}
    assert client.get('/api/runs/bad-id!/live').status_code == 400


@pytest.mark.integration
def test_a_running_simulation_streams_before_it_finishes():
    """On the engine: rows are visible while the run lasts, and they agree with the finished result."""
    import json
    from pathlib import Path

    from server.engine import simulate
    from server.models import SimulationSettings
    from tests.recording import log_outputs
    raw = json.loads((Path(__file__).parents[1]/'models/examples/dc.json').read_text(encoding='utf-8'))
    # A fixed step fine enough that the run takes a while, so the stream is read mid-run.
    model = log_outputs(Project.model_validate(raw)).model_copy(
        update={'simulation': SimulationSettings(solver='rk4', step=2e-5)})
    job = 'live' + uuid.uuid4().hex[:10]
    seen = []

    async def watch(task):
        row = 0
        while not task.done():
            data = await asyncio.to_thread(live_results.read, job, row)
            if data.get('time'):
                seen.append((data['fraction'], data['time'][-1]))
            row = data.get('row', row)
            await asyncio.sleep(0.05)

    async def main():
        task = asyncio.ensure_future(simulate(model, job))
        await watch(task)
        return task.result()

    result = asyncio.run(main())
    assert seen, 'no rows were visible before the run finished'
    assert any(fraction < 1 for fraction, _ in seen)
    print('live fractions seen:', [round(f, 3) for f, _ in seen][:20], 'of', len(seen))
    assert live_results.read(job, 0) == {'done': True}
    assert result['series']
