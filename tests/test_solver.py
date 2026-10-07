"""Simulation settings: what they mean, the OpenModelica call they become, and their failures.

Unit tests use a stand-in engine; the integration tests at the end run every solver
on an RC circuit in the installed OpenModelica.
"""
import asyncio
import json
import math
import uuid
from pathlib import Path
from typing import get_args

import pytest
from pydantic import ValidationError

from server import engine, engines, solver
from server.diagnostics import SimulationFailure, validate_simulation
from server.modelica import emit_project, semantic_hash
from server.models import Project, SimulationSettings, SolverId

ROOT = Path(__file__).resolve().parent.parent
CASES = json.loads((ROOT/'tests'/'fixtures'/'solver-cases.json').read_text(encoding='utf-8'))
OLD_CALL = ('simulate(Gradara.System, startTime=0, stopTime=4.0, numberOfIntervals=6000, tolerance=1e-06, '
            'method="dassl", outputFormat="csv", fileNamePrefix="simulation")')


def example(name: str, simulation: dict | None = None) -> Project:
    data = json.loads((ROOT/'models'/'examples'/f'{name}.json').read_text(encoding='utf-8'))
    if simulation is not None:
        data['simulation'] = simulation
    return Project.model_validate(data)


@pytest.mark.parametrize('case', CASES, ids=[c['about'] for c in CASES])
def test_settings_mean_the_same_run_as_in_the_workbench(case):
    settings = SimulationSettings.model_validate(case['settings']) if case['settings'] else None
    assert solver.effective(case['duration'], settings) == case['effective']


def test_the_document_schema_and_the_shared_limits_agree():
    assert set(get_args(SolverId)) == set(solver.limits()['solvers']) == set(solver.METHODS)
    field = SimulationSettings.model_fields['tolerance']
    bounds = {type(m).__name__: m for m in field.metadata}
    assert bounds['Ge'].ge == solver.limits()['tolerance']['min']
    assert bounds['Le'].le == solver.limits()['tolerance']['max']


def test_bad_settings_are_refused_by_the_schema():
    for bad in ({'solver': 'ode45'}, {'tolerance': 1e-12}, {'tolerance': 0.1}, {'step': 0}, {'maxStep': -1},
                {'outputInterval': float('nan')}):
        with pytest.raises(ValidationError):
            SimulationSettings.model_validate(bad)


def test_a_model_without_settings_runs_and_hashes_exactly_as_before():
    project = example('dc')
    assert solver.simulate_expression(4.0, None) == OLD_CALL
    assert solver.simulate_expression(4.0, SimulationSettings(solver='dassl', tolerance=1e-6)) == OLD_CALL
    assert 'annotation(experiment(StartTime=0, StopTime=4.0, Tolerance=1e-6));' in emit_project(project)
    # A field of the other solver type changes neither the run nor the result identity.
    assert semantic_hash(example('dc', {'step': 0.01})) == semantic_hash(project)
    assert semantic_hash(example('dc', {'tolerance': 1e-8})) != semantic_hash(project)


@pytest.mark.parametrize('settings, method, flags', [
    ({'solver': 'esdirk', 'maxStep': 1e-5}, 'gbode', '-gbm=esdirk4 -maxStepSize=1e-05'),
    ({'solver': 'backwardEuler', 'step': 0.001, 'maxStep': 1}, 'gbode', '-gbm=impl_euler -gbctrl=const'),
    ({'solver': 'rk4', 'step': 0.001}, 'gbode', '-gbm=rungekutta -gbctrl=const'),
    ({'maxStep': 0.01}, 'dassl', '-maxStepSize=0.01'),
])
def test_each_solver_becomes_its_openmodelica_method(settings, method, flags):
    call = solver.simulate_expression(4.0, SimulationSettings.model_validate(settings))
    assert f'method="{method}"' in call
    assert f'simflags="{flags}"' in call
    if settings.get('solver') in ('rk4', 'backwardEuler'):
        assert 'numberOfIntervals=4000,' in call


def test_the_emitted_model_records_its_settings():
    source = emit_project(example('dc', {'solver': 'esdirk', 'tolerance': 1e-8, 'maxStep': 0.001, 'outputInterval': 0.01}))
    assert ('annotation(experiment(StartTime=0, StopTime=4.0, Tolerance=1e-8, Interval=0.01), '
            '__OpenModelica_simulationFlags(s="gbode", gbm="esdirk4", maxStepSize="0.001"));') in source


def test_settings_that_cannot_run_are_validation_problems():
    project = example('dc', {'solver': 'rk4', 'step': 1e-6})
    with pytest.raises(SimulationFailure) as failure:
        validate_simulation(project)
    [diagnostic] = failure.value.diagnostics
    assert diagnostic.source == 'validation'
    assert diagnostic.message == 'A 1e-06 s step takes 4,000,000 steps; the limit is 200,000.'
    assert diagnostic.hint and '2e-05 s' in diagnostic.hint
    longer = example('dc', {'outputInterval': 10})
    with pytest.raises(SimulationFailure, match='longer than the stop time'):
        validate_simulation(longer)
    validate_simulation(example('dc', {'step': 1e-9}))  # a fixed step does not apply to DASSL


def stand_in(monkeypatch, behave):
    calls = []

    async def fake(folder, config, name):
        calls.append(config)
        return await behave(folder, config)
    monkeypatch.setattr(engines, 'execute', fake)
    return calls


def run_project(tmp_path, project):
    folder = tmp_path/'run'
    folder.mkdir()
    return asyncio.run(engine.run(project, 'test' + uuid.uuid4().hex[:8], folder))


def test_the_run_sends_the_settings_and_records_them(tmp_path, monkeypatch):
    async def finished(folder, config):
        (folder/'simulation_res.csv').write_text('time,y\n0,0\n2,1\n4,2\n', encoding='utf-8')
        return {'result': {}, 'diagnostics': ''}
    calls = stand_in(monkeypatch, finished)
    project = example('dc', {'solver': 'rk4', 'step': 0.01})
    result = run_project(tmp_path, project)
    assert result['simulation'] == {'solver': 'rk4', 'tolerance': 1e-6, 'points': 400, 'step': 0.01}
    assert calls[0]['simulate'] == solver.simulate_expression(4.0, project.simulation)
    assert 'numberOfIntervals=400,' in calls[0]['simulate']


def test_a_timeout_is_the_settings_problem_it_usually_is(tmp_path, monkeypatch):
    async def slow(folder, config):
        raise engines.EngineTimeout(engines.timeout_message())
    stand_in(monkeypatch, slow)
    with pytest.raises(SimulationFailure) as failure:
        run_project(tmp_path, example('dc', {'solver': 'rk4', 'step': 2e-5}))
    [diagnostic] = failure.value.diagnostics
    assert diagnostic.source == 'runtime' and diagnostic.help == 'slow'
    assert '200,000 fixed steps' in diagnostic.hint
    assert 'rk4 · step 2e-05 s' in diagnostic.detail


def test_a_run_that_floods_the_disk_is_stopped(tmp_path, monkeypatch):
    monkeypatch.setattr(engine, 'RESULT_LIMIT', 1000)
    cancelled = []

    async def flood(folder, config):
        try:
            (folder/'simulation_res.csv').write_bytes(b'x' * 5000)
            await asyncio.sleep(30)
        except asyncio.CancelledError:
            cancelled.append(True)
            raise
    stand_in(monkeypatch, flood)
    with pytest.raises(SimulationFailure) as failure:
        run_project(tmp_path, example('dc'))
    assert cancelled == [True]
    assert failure.value.diagnostics[0].help == 'too-much-data'


def test_a_run_that_stops_early_says_why(tmp_path, monkeypatch):
    async def early(folder, config):
        (folder/'simulation_res.csv').write_text('time,y\n0,0\n0.5,1\n', encoding='utf-8')
        (folder/'simulation.log').write_text(
            'LOG_STDOUT | error | Simulation aborted since gbode is running with fixed step size and step '
            'calculation has failed at time = 0.5 with step size h = 0.01.\n', encoding='utf-8')
        return {'result': {}, 'diagnostics': ''}
    stand_in(monkeypatch, early)
    with pytest.raises(SimulationFailure) as failure:
        run_project(tmp_path, example('dc', {'solver': 'backwardEuler', 'step': 0.01}))
    [diagnostic] = failure.value.diagnostics
    assert diagnostic.help == 'stopped-early'
    assert 'smaller step' in diagnostic.hint
    assert 'step calculation has failed' in diagnostic.detail


def test_a_fixed_step_failure_is_not_called_an_algebraic_loop():
    from server.diagnostics import failure_diagnostics, warning_diagnostics
    raw = ('LOG_ASSERT | debug | Solving non-linear system 292 failed at time=0.033.\n'
           'LOG_STDOUT | error | Simulation aborted since gbode is running with fixed step size and step calculation '
           'has failed at time = 0.033 with step size h = 2e-05.')
    [fixed] = failure_diagnostics(example('dc', {'solver': 'backwardEuler', 'step': 2e-5}), raw)
    assert fixed.message == 'The fixed-step solver could not complete a step at 0.033 s.'
    assert fixed.help == 'stopped-early' and 'smaller step' in fixed.hint
    variable = failure_diagnostics(example('dc'), 'LOG_STDOUT | info | model terminate | Integrator failed. | at time 4e-05')
    assert all(d.help == 'stopped-early' for d in variable)
    note = 'LOG_STDOUT | warning | Numerical Jacobians without coloring are currently not supported by GBODE. Colored numerical Jacobian will be used.'
    assert warning_diagnostics(example('dc'), note) == []


def test_stored_runs_list_their_settings(tmp_path, monkeypatch):
    from server import app as app_module
    runs = tmp_path/'runs'
    for run_id, simulation in (('a1', None), ('b2', {'solver': 'rk4', 'tolerance': 1e-6, 'points': 400, 'step': 0.01})):
        (runs/run_id).mkdir(parents=True)
        (runs/run_id/'simulation_res.csv').write_text('time\n0\n', encoding='utf-8')
        result = {'id': run_id, 'duration': 4, 'samples': 1, 'series': [], 'projectRevision': 1, 'modelHash': 'h',
                  'engine': 'OpenModelica', 'snapshot': {'modelId': 'm1'}}
        if simulation:
            result['simulation'] = simulation
        (runs/run_id/'result.json').write_text(json.dumps(result), encoding='utf-8')
    monkeypatch.setattr(app_module, 'RUNS', runs)
    listed = asyncio.run(app_module.stored_runs('m1'))['runs']
    by_id = {r['id']: r for r in listed}
    assert 'simulation' not in by_id['a1']
    assert by_id['b2']['simulation']['solver'] == 'rk4'


# ---------------------------------------------------------------- real engine

def rc_project(simulation: dict | None, capacitance: str = '1e-3', duration: float = 5) -> Project:
    """1 V through 1 kΩ into C: τ = RC (1 s by default)."""
    from tests.test_msl_engine import _block, _w, wrap
    E = 'electrical'
    two = lambda cls, mods: wrap(cls, [('p', 'physical', E), ('n', 'physical', E)], mods, E)
    sensor = wrap('Modelica.Electrical.Analog.Sensors.VoltageSensor',
                  [('p', 'physical', E), ('n', 'physical', E), ('v', 'output', 'signal')], {}, E)
    blocks = [_block('src', two('Modelica.Electrical.Analog.Sources.ConstantVoltage', {'V': '1'})),
              _block('g', wrap('Modelica.Electrical.Analog.Basic.Ground', [('p', 'physical', E)], {}, E)),
              _block('r', two('Modelica.Electrical.Analog.Basic.Resistor', {'R': '1000'})),
              _block('c', two('Modelica.Electrical.Analog.Basic.Capacitor', {'C': capacitance})),
              _block('vc', sensor)]
    wires = [_w(1, 'src', 'p', 'r', 'p'), _w(2, 'r', 'n', 'c', 'p'), _w(3, 'c', 'n', 'g', 'p'),
             _w(4, 'src', 'n', 'g', 'p'), _w(5, 'vc', 'p', 'c', 'p'), _w(6, 'vc', 'n', 'g', 'p')]
    data = {'version': 1, 'name': 'solver', 'duration': duration, 'revision': 0, 'blocks': blocks, 'wires': wires}
    if simulation:
        data['simulation'] = simulation
    return Project.model_validate(data)


def at(time, values, t):
    for (t0, v0), (t1, v1) in zip(zip(time, values), zip(time[1:], values[1:])):
        if t0 <= t <= t1:
            return v0 if t1 == t0 else v0 + (v1 - v0) * (t - t0) / (t1 - t0)
    return values[-1]


@pytest.mark.integration
@pytest.mark.parametrize('simulation, accuracy', [
    (None, 2e-4),
    ({'solver': 'esdirk'}, 2e-4),
    ({'tolerance': 1e-9, 'maxStep': 0.05, 'outputInterval': 0.01}, 1e-5),
    ({'solver': 'rk4', 'step': 0.01}, 1e-5),
    ({'solver': 'backwardEuler', 'step': 0.01}, 3e-3),
])
def test_every_solver_charges_the_rc_circuit(simulation, accuracy):
    project = rc_project(simulation)
    result = asyncio.run(engine.simulate(project, 'solver' + uuid.uuid4().hex[:10]))
    assert result['simulation'] == solver.effective(5, project.simulation)
    series = {s['key']: s['values'] for s in result['series']}
    measured = at(result['time'], series['vc.v'], 1)
    print(f'{solver.describe(result["simulation"])}: v(1 s) = {measured:.6f} V, closed form {1 - math.exp(-1):.6f} V')
    assert measured == pytest.approx(1 - math.exp(-1), abs=accuracy)
    if simulation and simulation.get('step'):
        assert result['samples'] >= 500  # one row per fixed step


@pytest.mark.integration
def test_a_fixed_step_too_large_for_the_model_fails_with_settings_help():
    """τ = 1 ms with a 10 ms Runge-Kutta 4 step: each step multiplies the error by about 291."""
    project = rc_project({'solver': 'rk4', 'step': 0.01}, capacitance='1e-6', duration=10)
    with pytest.raises(SimulationFailure) as failure:
        asyncio.run(engine.simulate(project, 'solver' + uuid.uuid4().hex[:10]))
    helps = {d.help for d in failure.value.diagnostics}
    print(failure.value, helps)
    assert helps & {'fixed-blows-up', 'stopped-early'}
