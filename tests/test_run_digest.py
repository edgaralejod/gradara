# SPDX-License-Identifier: Apache-2.0
"""The run digest: deterministic statistics, events and differences the Run summary and Explain results use."""
import json
import math

import pytest

from server import run_digest as rd
from server.run_store import RunUnavailable


def step_response(n=2001, stop=1.0, gain=10.0, tau=0.05, zeta=0.4):
    """An underdamped second-order step response with a known overshoot."""
    wn = 1 / tau
    wd = wn * math.sqrt(1 - zeta ** 2)
    phi = math.acos(zeta)
    time = [stop * i / (n - 1) for i in range(n)]
    values = [gain * (1 - math.exp(-zeta * wn * t) / math.sqrt(1 - zeta ** 2) * math.sin(wd * t + phi)) for t in time]
    return time, values


def run(run_id, series, time, model='m1', parameters=None, duration=None, name='', problems=()):
    return {'id': run_id, 'name': name, 'finished': 1, 'duration': duration or time[-1], 'samples': len(time),
            'time': time, 'series': series, 'problems': [{'message': p} for p in problems],
            'snapshot': {'modelId': model, 'duration': duration or time[-1],
                         'blocks': [{'id': 'pi', 'definition': {'name': 'PI', 'parameters': [
                             {'id': 'k', 'name': 'Gain', 'value': (parameters or {}).get('k', 1.0), 'unit': ''}]}}]}}


def loader(runs):
    def load(run_id):
        if run_id not in runs:
            raise RunUnavailable('Results are unavailable.')
        return json.loads(json.dumps(runs[run_id]))
    return load


def test_statistics_are_time_weighted_and_exact_for_lines():
    # A ramp 0 → 2 over 1 s sampled unevenly: the mean is 1 and the RMS 2/√3 whatever the grid.
    ts = [0, 0.1, 0.15, 0.9, 1.0]
    vs = [2 * t for t in ts]
    s = rd.statistics(ts, vs)
    assert s['mean'] == pytest.approx(1.0) and s['rms'] == pytest.approx(2 / math.sqrt(3))
    assert (s['min'], s['tMin'], s['max'], s['tMax'], s['peakToPeak']) == (0, 0, 2, 1.0, 2)


def test_window_interpolates_its_end_points():
    ts, vs = rd.window_of([0, 1, 2], [0, 10, 20], 0.5, 1.5)
    assert ts == [0.5, 1, 1.5] and vs == [5, 10, 15]


def test_value_at_takes_the_later_sample_at_an_event():
    assert rd.value_at([0, 1, 1, 2], [0, 0, 5, 5], 1) == 5
    assert rd.value_at([0, 1], [3, 4], -1) == 3 and rd.value_at([0, 1], [3, 4], 9) == 4


def test_step_response_overshoot_and_settling():
    time, values = step_response()
    steady = rd.steady_state(time, values)
    expected = math.exp(-0.4 * math.pi / math.sqrt(1 - 0.16)) * 100   # textbook overshoot, 25.4 %
    assert steady['value'] == pytest.approx(10, rel=1e-3)
    assert steady['overshootPercent'] == pytest.approx(expected, rel=0.02)
    assert 0.1 < steady['settlingTime'] < 0.6


def test_constant_signal_is_settled_from_the_start_with_no_events():
    ts, vs = [0, 0.5, 1], [3.0, 3.0, 3.0]
    stats, steady = rd.statistics(ts, vs), rd.steady_state(ts, vs)
    assert steady['settlingTime'] == 0 and steady['overshootPercent'] is None
    assert rd.events(ts, vs, stats, steady) == []


def test_ripple_widens_the_settling_band():
    # A converter-like current: rises to 5 A, then a 1 A triangular ripple forever.
    time = [i / 4000 for i in range(4001)]
    values = [min(5.0, 100 * t) + (0.5 - abs((t * 2000) % 1 - 0.5)) * 2 - 0.5 for t in time]
    steady = rd.steady_state(time, values)
    assert steady['ripple'] == pytest.approx(1.0, abs=0.05)
    assert steady['settlingTime'] is not None and steady['settlingTime'] < 0.1


def test_events_find_clips_steps_and_switching_but_not_pwm_clips():
    time = [i / 1000 for i in range(1001)]
    clipped = [min(2.0, 10 * t) if t < 0.6 else 1.0 for t in time]
    stats, steady = rd.statistics(time, clipped), rd.steady_state(time, clipped)
    kinds = {e['kind'] for e in rd.events(time, clipped, stats, steady)}
    assert 'clipped' in kinds
    # A PWM signal returns to its extremes again and again: switching, never a clip.
    pwm_t, pwm_v = [], []
    for k in range(20):
        pwm_t += [k * 0.05, k * 0.05 + 0.025, k * 0.05 + 0.025]
        pwm_v += [1.0, 1.0, 0.0]
        pwm_t += [k * 0.05 + 0.05]
        pwm_v += [0.0]
    pwm_t, pwm_v = zip(*sorted(set(zip(pwm_t, pwm_v)), key=lambda p: (p[0], -p[1])))
    pwm_t, pwm_v = list(pwm_t), list(pwm_v)
    stats, steady = rd.statistics(pwm_t, pwm_v), rd.steady_state(pwm_t, pwm_v)
    found = rd.events(pwm_t, pwm_v, stats, steady)
    assert {e['kind'] for e in found} >= {'switching'} and 'clipped' not in {e['kind'] for e in found}


def test_envelope_keeps_peaks():
    ts = [0, 0.5, 0.5001, 1]
    vs = [0, 0, 9, 0]
    env = rd.envelope(ts, vs, 4)
    assert len(env) == 4 and max(b[2] for b in env) == pytest.approx(9, rel=1e-3)


def test_crossings_and_correlation():
    ts = [i / 100 for i in range(101)]
    sine = [math.sin(2 * math.pi * 2 * t) for t in ts]
    assert len(rd.crossings(ts, sine, 0.0)) == 3   # 0.25, 0.5, 0.75 interior zero passes
    assert rd.correlation(ts, sine, ts, [2 * v + 1 for v in sine], 0, 1) == pytest.approx(1.0)
    assert rd.correlation(ts, sine, ts, [1.0] * len(ts), 0, 1) is None


def test_digest_is_deterministic_and_compares_runs():
    time, values = step_response()
    current = run('runA', [{'key': 'i.y', 'name': 'Current', 'unit': 'A', 'netId': 'n1', 'values': values}], time,
                  parameters={'k': 2.0}, name='Higher gain', problems=['Slow step'])
    earlier = run('runB', [{'key': 'i.y', 'name': 'Current', 'unit': 'A', 'netId': 'n1', 'values': [v * 0.9 for v in values]}], time)
    request = rd.DigestRequest(modelId='m1', runIds=['runA', 'runB'])
    one = rd.digest(request, loader({'runA': current, 'runB': earlier}))
    two = rd.digest(request, loader({'runA': current, 'runB': earlier}))
    assert one == two and json.dumps(one)  # same input, same digest; plain JSON
    assert [r['label'] for r in one['runs']] == ['A', 'B'] and one['runs'][1]['baseline']
    assert one['runs'][0]['name'] == 'Higher gain'
    a = next(s for s in one['signals'] if s['run'] == 'A')
    assert a['stats']['max'] == pytest.approx(max(values), rel=1e-4) and a['unit'] == 'A' and a['logged']
    assert one['comparison'][0]['signal'] == 'i.y' and one['comparison'][0]['maxAbsDifference'] > 0
    assert one['parameters'] == [{'run': 'A', 'baseline': 'B', 'block': 'PI', 'parameter': 'Gain', 'from': 1.0, 'to': 2.0, 'unit': ''}]
    assert one['warnings'] == ['Slow step']
    assert 20 <= len(a["envelope"]) <= 120


def test_digest_window_and_missing_signals():
    time, values = step_response()
    runs = {'runA': run('runA', [{'key': 'i.y', 'name': 'Current', 'unit': 'A', 'values': values}], time)}
    out = rd.digest(rd.DigestRequest(modelId='m1', runIds=['runA'], signals=['i.y', 'v.y'], window=(0.2, 0.4)), loader(runs))
    assert out['window'] == [0.2, 0.4] and not out['wholeRun']
    assert out['missing'] == [{'signal': 'v.y', 'run': 'A'}]
    with pytest.raises(ValueError):
        rd.digest(rd.DigestRequest(modelId='m1', runIds=['runA'], window=(5, 6)), loader(runs))


def test_digest_refuses_runs_of_another_model_and_bad_requests():
    time, values = step_response(n=11)
    runs = {'runA': run('runA', [{'key': 'i.y', 'name': 'I', 'unit': 'A', 'values': values}], time, model='other')}
    with pytest.raises(RunUnavailable):
        rd.digest(rd.DigestRequest(modelId='m1', runIds=['runA']), loader(runs))
    with pytest.raises(RunUnavailable):
        rd.digest(rd.DigestRequest(modelId='m1', runIds=['gone']), loader(runs))
    with pytest.raises(ValueError):
        rd.DigestRequest(modelId='m1', runIds=['a', 'a'])
    with pytest.raises(ValueError):
        rd.DigestRequest(modelId='m1', runIds=['a'], baseline='b')
    with pytest.raises(ValueError):
        rd.DigestRequest(modelId='m1', runIds=['a'], window=(1, 1))


def test_measure_matches_the_digest():
    time, values = step_response()
    stats = rd.statistics(time, values)
    assert rd.measure(time, values, 'max', 0, 1) == stats['max']
    assert rd.measure(time, values, 'valueAt', 0, 1, at=0.5) == pytest.approx(rd.value_at(time, values, 0.5))
    assert rd.measure(time, values, 'overshootPercent', 0, 1) == rd.steady_state(time, values)['overshootPercent']


def test_digest_endpoint(monkeypatch, tmp_path):
    from fastapi.testclient import TestClient
    from server import app as service
    monkeypatch.setattr(service, 'RUNS', tmp_path)
    folder = tmp_path/'run1'
    folder.mkdir()
    (folder/'simulation_res.csv').write_text('time,i.y\n0,0\n0.5,4\n1,2\n', encoding='utf-8')
    (folder/'result.json').write_text(json.dumps({'id': 'run1', 'duration': 1, 'samples': 3, 'snapshot': {'modelId': 'm1'},
                                                  'series': [{'key': 'i.y', 'name': 'Current', 'unit': 'A', 'blockId': 'i'}]}),
                                      encoding='utf-8')
    with TestClient(service.app, headers={'X-Gradara-Client': 'test'}) as client:
        response = client.post('/api/results/digest', json={'modelId': 'm1', 'runIds': ['run1']})
        assert response.status_code == 200
        body = response.json()
        assert body['signals'][0]['stats']['max'] == 4 and body['signals'][0]['stats']['tMax'] == 0.5
        assert client.post('/api/results/digest', json={'modelId': 'm2', 'runIds': ['run1']}).status_code == 404
        assert client.post('/api/results/digest', json={'modelId': 'm1', 'runIds': ['run1'], 'window': [3, 4]}).status_code == 422
