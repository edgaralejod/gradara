# SPDX-License-Identifier: Apache-2.0
"""Structured diagnostics: block mapping, solver text, job contract, and a real failing run."""
import asyncio
import json
import uuid
from unittest.mock import AsyncMock
import pytest
from server import engine
from server.diagnostics import (LOOP_HINT, SimulationFailure, failure_diagnostics, signal_loops,
                                validate_simulation, warning_diagnostics)
from tests.test_workspace import feedback


def positive_loop():
    model = feedback()
    gain = next(b for b in model.blocks if b.definition.kind == 'gain')
    gain.definition.parameters[0].value = 1
    summing = next(b for b in model.blocks if b.definition.kind in {'sum', 'subtract'})
    summing.definition.equations = 'y = a + b;'
    return model, gain, summing


def test_unconnected_inputs_name_the_block_and_port():
    model = feedback()
    model.wires = []
    with pytest.raises(SimulationFailure, match='Connect these signal inputs') as failure:
        validate_simulation(model)
    diagnostics = failure.value.diagnostics
    assert all(d.source == 'validation' and d.severity == 'error' for d in diagnostics)
    assert [d.id for d in diagnostics] == [f'd{i + 1}' for i in range(len(diagnostics))]
    first = diagnostics[0]
    block = next(b for b in model.blocks if b.id == first.blockIds[0])
    assert first.ports[0].blockId == block.id
    assert first.ports[0].portId in {p.id for p in block.definition.ports if p.direction == 'input'}
    assert first.message.startswith(block.definition.name + '.')


def test_drawing_only_blocks_are_reported_individually():
    model = feedback()
    model.blocks[0].definition.kind = 'subsystem'
    model.blocks[0].definition.generated = False
    model.blocks[0].definition.ports = [p for p in model.blocks[0].definition.ports if p.direction != 'input']
    with pytest.raises(SimulationFailure, match='full simulation behavior') as failure:
        validate_simulation(model)
    assert failure.value.diagnostics[0].blockIds == [model.blocks[0].id]


def test_compiler_errors_map_instance_ids_to_blocks_and_names():
    model = feedback()
    gain = next(b for b in model.blocks if b.definition.kind == 'gain')
    raw = f'[/work/model.mo:12:3-12:20:writable] Error: Variable {gain.id}.k2 not found in scope System.\nError: Failed to instantiate.'
    first, second = failure_diagnostics(model, raw)
    assert first.source == 'compiler' and first.blockIds == [gain.id]
    assert first.message == f'Variable {gain.definition.name}.k2 not found in scope System.'
    assert gain.id not in first.detail and gain.definition.name in first.detail
    assert second.message == 'Failed to instantiate.' and second.blockIds == []


def test_algebraic_loops_select_the_feedthrough_cycle():
    model, gain, summing = positive_loop()
    blocks, wires = signal_loops(model)
    assert set(blocks) == {gain.id, summing.id}
    assert wires and all(w in {x.id for x in model.wires} for w in wires)
    [diagnostic] = failure_diagnostics(model, 'LOG_ASSERT | debug | Solving linear system 12 failed at time=0.2.')
    assert diagnostic.source == 'runtime' and diagnostic.hint == LOOP_HINT
    assert set(diagnostic.blockIds) == {gain.id, summing.id}
    assert 'failed at time=0.2' in diagnostic.message


def test_stateful_blocks_break_algebraic_loops():
    model, gain, _ = positive_loop()
    gain.definition.equations = 'der(y) = k*u - y;'
    assert signal_loops(model) == ([], [])


def test_success_warnings_become_problems():
    model = feedback()
    gain = next(b for b in model.blocks if b.definition.kind == 'gain')
    text = f'Warning: Parameter {gain.id}.k has no value.\nLOG_STDOUT | warning | The default linear solver fails.\nNotification: done'
    problems = warning_diagnostics(model, text)
    assert [p.severity for p in problems] == ['warning', 'warning']
    assert problems[0].blockIds == [gain.id] and problems[0].source == 'compiler'
    assert problems[1].source == 'runtime'


def test_solver_warnings_are_said_in_gradara_terms():
    model = feedback()
    text = ('Warning: The initial conditions are not fully specified. For more information set -d=initialization. '
            'In OMEdit Tools->Options->Simulation->Show additional information from the initialization process, '
            'in OMNotebook call setCommandLineOptions("-d=initialization").\n'
            'Warning: Alias set with conflicting start values\n'
            'Warning: Something the table does not know.')
    problems = warning_diagnostics(model, text)
    assert 'OMEdit' not in problems[0].message and 'initial state' in problems[0].message
    assert problems[0].hint and 'initial value' in problems[0].hint
    assert 'OMEdit' in problems[0].detail, 'the engine text is kept for the details'
    assert problems[1].message.startswith('Two connected quantities')
    assert problems[2].message == 'Something the table does not know.' and problems[2].hint is None


def test_failed_jobs_record_diagnostics(monkeypatch, tmp_path):
    from fastapi.testclient import TestClient
    from server import app as service
    monkeypatch.setattr(service, 'JOBS', {})
    monkeypatch.setattr(service, 'TASKS', {})
    monkeypatch.setattr(service, 'RUNS', tmp_path)
    model = feedback()
    model.wires = []
    async def fail(project, job_id, on_stage=None):
        validate_simulation(project)
    monkeypatch.setattr(service, 'simulate', fail)
    with TestClient(service.app, headers={'X-Gradara-Client': 'test'}) as client:
        ident = client.post('/api/runs', json=model.model_dump(exclude_none=True)).json()['id']
        job = client.get('/api/jobs/'+ident).json()
        assert job['status'] == 'failed' and 'Connect these signal inputs' in job['error']
        assert job['diagnostics'] and job['diagnostics'][0]['source'] == 'validation'
        assert job['diagnostics'][0]['ports'][0]['blockId']
        assert client.get('/api/runs/'+ident+'/diagnostics').status_code == 404
        (tmp_path/'abc123').mkdir()
        (tmp_path/'abc123'/'diagnostics.json').write_text(json.dumps({'error': 'x', 'diagnostics': []}), encoding='utf-8')
        assert client.get('/api/runs/abc123/diagnostics').json() == {'error': 'x', 'diagnostics': []}
        assert client.get('/api/runs/bad-id/diagnostics').status_code == 400


def test_engine_failures_are_engine_diagnostics(monkeypatch, tmp_path):
    monkeypatch.setattr(engine, 'RUNS', tmp_path)
    monkeypatch.setattr(engine.engines, 'execute', AsyncMock(side_effect=engine.engines.EngineError('Start Docker Desktop, then check again.')))
    with pytest.raises(SimulationFailure) as failure:
        asyncio.run(engine.simulate(feedback(), 'enginedown'))
    [diagnostic] = failure.value.diagnostics
    assert diagnostic.source == 'engine' and 'Start Docker' in diagnostic.message
    saved = json.loads((tmp_path/'enginedown'/'diagnostics.json').read_text(encoding='utf-8'))
    assert saved['diagnostics'][0]['source'] == 'engine'


def test_unsafe_definitions_name_the_block(monkeypatch, tmp_path):
    monkeypatch.setattr(engine, 'RUNS', tmp_path)
    model = feedback()
    gain = next(b for b in model.blocks if b.definition.kind == 'gain')
    gain.definition.equations = 'y = k*u; // fine\nexternal "C";'
    with pytest.raises(SimulationFailure, match='does not allow') as failure:
        asyncio.run(engine.simulate(model, 'unsafe'))
    assert failure.value.diagnostics[0].source == 'safety'
    assert failure.value.diagnostics[0].blockIds == [gain.id]


@pytest.mark.integration
def test_real_algebraic_loop_names_the_loop_blocks():
    model, gain, summing = positive_loop()
    job_id = 'diagloop' + uuid.uuid4().hex[:10]
    with pytest.raises(SimulationFailure) as failure:
        asyncio.run(engine.simulate(model, job_id))
    [diagnostic] = failure.value.diagnostics
    assert diagnostic.source == 'runtime' and diagnostic.hint == LOOP_HINT
    assert set(diagnostic.blockIds) == {gain.id, summing.id}
    assert len(diagnostic.detail) > 100
    saved = json.loads((engine.RUNS/job_id/'diagnostics.json').read_text(encoding='utf-8'))
    assert saved['diagnostics'][0]['blockIds'] == diagnostic.blockIds
    assert not (engine.RUNS/job_id/'result.json').exists()
