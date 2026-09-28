# SPDX-License-Identifier: Apache-2.0
"""AI model editing: bounded operations, all-or-nothing application, and the edit pipeline."""
import asyncio
import json
from pathlib import Path
from unittest.mock import AsyncMock
import pytest
from server import model_edit as editing
from server.diagnostics import Diagnostic, SimulationFailure
from server.models import Definition, Project
from tests.test_workspace import feedback

ROOT = Path(__file__).parents[1]


def motor() -> Project:
    return Project.model_validate(json.loads((ROOT/'tests/motor-project.json').read_text(encoding='utf-8')))


def servo() -> Project:
    return Project.model_validate(json.loads((ROOT/'models/examples/servo.json').read_text(encoding='utf-8')))


def catalog() -> dict[str, Definition]:
    kinds = {b.definition.kind: b.definition for b in feedback().blocks}
    return {'builtin:' + kind: d for kind, d in kinds.items()}


def plan(*operations, **fields):
    return editing.EditPlan.model_validate({'summary': 'Test edit', 'assumptions': [], 'unsupported': '',
                                            'operations': list(operations), **fields})


def op(kind, **fields):
    return {'op': kind, **fields}


def apply(project, *operations, generated=None, revised=None):
    return editing.apply_operations(project, plan(*operations), catalog(), generated, revised)


def test_add_and_connect_a_catalog_block():
    before = motor()
    edited, changes = apply(before,
                            op('add_block', libraryId='builtin:scope', alias='speedScope', name='Speed scope', near='sensor'),
                            op('connect', source='sensor', sourcePort='y', target='speedScope', targetPort='u'))
    scope = next(b for b in edited.blocks if b.id == 'b_speedScope')
    assert scope.definition.name == 'Speed scope'
    assert scope.position.x == next(b for b in before.blocks if b.id == 'sensor').position.x + 320
    wire = edited.wires[-1]
    assert (wire.source, wire.sourceHandle, wire.target, wire.targetHandle) == ('sensor', 'y', 'b_speedScope', 'u')
    assert [c.op for c in changes] == ['add_block', 'connect']
    assert changes[1].wireIds == [wire.id] and set(changes[1].blockIds) == {'sensor', 'b_speedScope'}
    # Everything else is untouched.
    assert edited.wires[:-1] == before.wires
    assert [b for b in edited.blocks if b.id != 'b_speedScope'] == before.blocks
    assert len(before.blocks) == 7


def test_connect_orients_signals_from_output_to_input():
    edited, _ = apply(motor(), op('add_block', libraryId='builtin:scope', alias='s'),
                      op('connect', source='b_s', sourcePort='u', target='controller', targetPort='y'))
    wire = edited.wires[-1]
    assert (wire.source, wire.target) == ('controller', 'b_s')


def test_parameters_rename_duration_and_removal():
    edited, changes = apply(motor(), op('set_parameter', blockId='controller', parameterId='kp', value=1.5),
                            op('rename_block', blockId='controller', name='Speed PI'),
                            op('set_duration', duration=2), op('remove_block', blockId='sensor'))
    controller = next(b for b in edited.blocks if b.id == 'controller')
    assert controller.definition.name == 'Speed PI'
    assert [p.value for p in controller.definition.parameters] == [1.5, 2, 24, 0.001]
    assert edited.duration == 2
    assert 'sensor' not in {b.id for b in edited.blocks}
    assert not any('sensor' in (w.source, w.target) for w in edited.wires)
    assert set(changes[-1].wireIds) == {'wire6', 'wire7'}
    assert 'from 0.6 to 1.5' in changes[0].description


def test_disconnect_by_wire_or_endpoints_and_nets_follow():
    before = servo()
    edited, changes = apply(before, op('disconnect', wireId='wire7'))
    assert 'wire7' not in {w.id for w in edited.wires}
    assert all('wire7' not in n.wireIds for n in edited.nets)
    assert len(edited.nets) == len(before.nets) - 1
    edited, _ = apply(before, op('disconnect', source='controller', sourcePort='y', target='drive', targetPort='u'))
    assert 'wire1' not in {w.id for w in edited.wires}
    kept = [w for w in edited.wires]
    assert all(w == next(x for x in before.wires if x.id == w.id) for w in kept)


def test_new_wires_join_nets_so_models_with_nets_stay_valid():
    before = servo()
    edited, _ = apply(before, op('add_block', libraryId='builtin:scope', alias='angleScope', near='sensor'),
                      op('connect', source='sensor', sourcePort='y', target='angleScope', targetPort='u'),
                      op('add_block', libraryId='builtin:display', alias='shown'),
                      op('add_block', libraryId='builtin:step', alias='other'),
                      op('connect', source='other', sourcePort='y', target='shown', targetPort='u'))
    feedback_net = next(n for n in edited.nets if 'wire7' in n.wireIds)
    assert 'w_ai_1' in feedback_net.wireIds and feedback_net.name == 'θ measured'
    fresh = next(n for n in edited.nets if 'w_ai_2' in n.wireIds)
    assert fresh.wireIds == ['w_ai_2'] and fresh.id.startswith('net_ai_')
    owners = [i for n in edited.nets for i in n.wireIds]
    assert sorted(owners) == sorted(w.id for w in edited.wires)


def test_revise_and_create_use_generated_definitions():
    revised = next(b for b in motor().blocks if b.id == 'controller').definition.model_copy(deep=True)
    revised.equations += '\n'
    revised.name = 'Generated name'
    new = catalog()['builtin:gain'].model_copy(deep=True)
    new.kind, new.name, new.generated = 'softGain', 'Soft gain', True
    edited, changes = apply(motor(), op('revise_definition', blockId='controller', prompt='Add feedforward'),
                            op('create_block', alias='soft', blockType='signal', prompt='A soft gain'),
                            revised={'controller': revised}, generated={'soft': new})
    controller = next(b for b in edited.blocks if b.id == 'controller')
    assert controller.definition.equations.endswith('\n')
    assert controller.definition.name == 'PI controller'  # the instance name is kept
    assert next(b for b in edited.blocks if b.id == 'b_soft').definition.kind == 'softGain'
    assert [c.op for c in changes] == ['revise_definition', 'create_block']


@pytest.mark.parametrize('operations, message', [
    ([op('remove_block', blockId='nope')], 'Unknown block'),
    ([op('connect', source='reference', sourcePort='y', target='controller', targetPort='reference')], 'already has a source'),
    ([op('connect', source='drive', sourcePort='p', target='load', targetPort='a')], 'Cannot connect electrical'),
    ([op('set_parameter', blockId='motor', parameterId='R', value=0)], 'must be at least'),
    ([op('connect', source='drive', sourcePort='p', target='motor', targetPort='p')], 'already connected'),
    ([op('connect', source='motor', sourcePort='p', target='motor', targetPort='p')], 'cannot connect to itself'),
    ([op('connect', source='reference', sourcePort='y', target='drive', targetPort='p')], 'Cannot connect signal'),
    ([op('add_block', libraryId='builtin:missing', alias='x')], 'Unknown library block'),
    ([op('disconnect', wireId='nope')], 'no such connection'),
    ([op('set_duration', duration=0)], 'stop time'),
])
def test_invalid_operations_are_rejected(operations, message):
    with pytest.raises(ValueError, match=message):
        apply(motor(), *operations)


def test_a_mixed_plan_applies_nothing():
    before = motor()
    snapshot = before.model_dump()
    with pytest.raises(ValueError):
        apply(before, op('set_parameter', blockId='controller', parameterId='kp', value=3), op('remove_block', blockId='nope'))
    assert before.model_dump() == snapshot


def test_generation_limits():
    creates = [op('create_block', alias=f'a{i}', blockType='signal', prompt='A block') for i in range(3)]
    with pytest.raises(ValueError, match='at most 2'):
        editing.check_limits(plan(*creates))
    mix = creates[:2] + [op('revise_definition', blockId='controller', prompt='x'),
                         op('revise_definition', blockId='motor', prompt='y')]
    with pytest.raises(ValueError, match='at most 3'):
        editing.check_limits(plan(*mix))
    editing.check_limits(plan(*mix[:3]))


def test_semantic_view_drops_layout():
    view = editing.semantic_view(servo())
    assert 'annotations' not in view and 'plots' not in view and 'junctions' not in view
    assert all('position' not in b and 'size' not in b for b in view['blocks'])
    assert all('waypoints' not in w for w in view['wires'])


# ---------------------------------------------------------------- pipeline

def request(**fields):
    return editing.ModelEditRequest(prompt='Add a scope on the speed', project=motor(),
                                    catalog=list(catalog().values()), **fields)


def setup(monkeypatch, tmp_path, plans, simulate_effect=None):
    monkeypatch.setattr(editing, 'DATA', tmp_path)
    monkeypatch.setattr(editing, 'catalog_snapshot', lambda req, _: catalog())
    provider = AsyncMock(side_effect=plans)
    monkeypatch.setattr(editing.agent, 'structured_generation', provider)
    simulation = AsyncMock(side_effect=simulate_effect or [{'samples': 42}, {'samples': 42}])
    monkeypatch.setattr(editing, 'simulate', simulation)
    monkeypatch.setattr(editing.agent, 'provider_label', lambda: 'Test AI')
    return provider, simulation


ADD_SCOPE = {'summary': 'Adds a scope.', 'assumptions': [], 'unsupported': '', 'operations': [
    op('add_block', libraryId='builtin:scope', alias='scope', name='Speed scope', near='sensor'),
    op('connect', source='sensor', sourcePort='y', target='scope', targetPort='u')]}


def test_pipeline_returns_a_verified_proposal(monkeypatch, tmp_path):
    provider, simulation = setup(monkeypatch, tmp_path, [ADD_SCOPE])
    result = asyncio.run(editing.edit_model(request(selection=['sensor']), 'job1'))
    assert result['verified'] and result['samples'] == 42 and result['provider'] == 'Test AI'
    assert [c['op'] for c in result['changes']] == ['add_block', 'connect']
    assert provider.call_args.kwargs['task'] == 'edit-plan'
    prompt = provider.call_args.args[0]
    assert 'Speed sensor (sensor)' in prompt and '"position"' not in prompt
    new = [w for w in result['project']['wires'] if w['id'].startswith('w_ai_')]
    assert new and all('waypoints' not in w for w in new)
    assert all('waypoints' in w for w in result['project']['wires'] if not w['id'].startswith('w_ai_'))
    simulation.assert_awaited_once()


def test_pipeline_repairs_an_unappliable_plan(monkeypatch, tmp_path):
    bad = {**ADD_SCOPE, 'operations': [op('remove_block', blockId='ghost')]}
    provider, _ = setup(monkeypatch, tmp_path, [bad, ADD_SCOPE])
    result = asyncio.run(editing.edit_model(request(), 'job2'))
    assert result['verified']
    assert 'Unknown block "ghost"' in provider.call_args_list[1].args[0]


def test_pipeline_repairs_from_simulation_then_returns_unverified(monkeypatch, tmp_path):
    failure = SimulationFailure('singular', [Diagnostic(source='runtime', message='Algebraic loop', blockIds=['controller'])])
    provider, simulation = setup(monkeypatch, tmp_path, [ADD_SCOPE, ADD_SCOPE], [failure, failure])
    result = asyncio.run(editing.edit_model(request(), 'job3'))
    assert result['verified'] is False
    assert result['diagnostics'][0]['message'] == 'Algebraic loop'
    assert 'failed its check' in provider.call_args_list[1].args[0]
    assert simulation.await_count == 2


def test_pipeline_can_skip_verification(monkeypatch, tmp_path):
    _, simulation = setup(monkeypatch, tmp_path, [ADD_SCOPE])
    result = asyncio.run(editing.edit_model(request(verify=False), 'job4'))
    assert result['verified'] is False and result['samples'] is None
    simulation.assert_not_awaited()


def test_unsupported_requests_are_refused_without_repair(monkeypatch, tmp_path):
    refused = {**ADD_SCOPE, 'unsupported': 'Hydraulics are not supported.'}
    provider, _ = setup(monkeypatch, tmp_path, [refused])
    with pytest.raises(ValueError, match='Hydraulics'):
        asyncio.run(editing.edit_model(request(), 'job5'))
    assert provider.await_count == 1


def test_cancellation_propagates_without_repair(monkeypatch, tmp_path):
    provider, _ = setup(monkeypatch, tmp_path, [ADD_SCOPE], [asyncio.CancelledError()])
    with pytest.raises(asyncio.CancelledError):
        asyncio.run(editing.edit_model(request(), 'job6'))
    assert provider.await_count == 1


def test_created_blocks_are_generated_once_as_priced_parts(monkeypatch, tmp_path):
    create = {**ADD_SCOPE, 'operations': [op('create_block', alias='soft', blockType='signal', prompt='A soft gain', name='Soft gain'),
                                          op('connect', source='sensor', sourcePort='y', target='soft', targetPort='u')]}
    setup(monkeypatch, tmp_path, [create])
    parts = []
    async def generate(prompt, existing, ident, block_type):
        parts.append(editing.dispatch.current_job.get())
        d = catalog()['builtin:gain'].model_copy(deep=True)
        d.kind, d.generated = 'softGain', True
        return {'definition': d.model_dump()}
    monkeypatch.setattr(editing.agent, 'generate_component', generate)
    token = editing.dispatch.current_job.set({'id': 'job7', 'kind': 'edit'})
    try:
        result = asyncio.run(editing.edit_model(request(), 'job7'))
    finally:
        editing.dispatch.current_job.reset(token)
    assert parts == [{'id': 'job7', 'kind': 'edit', 'part': 'block:1'}]
    assert result['generated'] == [{'alias': 'soft', 'name': 'Gain'}]


def test_edit_api_is_a_job(monkeypatch, tmp_path):
    from fastapi.testclient import TestClient
    from server import app as service
    monkeypatch.setattr(service, 'JOBS', {})
    monkeypatch.setattr(service, 'TASKS', {})
    async def edit(req, job_id, progress):
        assert req.prompt == 'Add a scope on the speed' and req.selection == ['sensor']
        progress('Planning the edit')
        return {'verified': True}
    monkeypatch.setattr(service, 'edit_model', edit)
    body = {'prompt': 'Add a scope on the speed', 'project': motor().model_dump(exclude_none=True),
            'catalog': [d.model_dump() for d in catalog().values()], 'selection': ['sensor']}
    with TestClient(service.app, headers={'X-Gradara-Client': 'test'}) as client:
        ident = client.post('/api/models/edit', json=body).json()['id']
        job = client.get('/api/jobs/'+ident).json()
        assert job['kind'] == 'edit' and job['status'] == 'complete'
        assert job['progress'] == 'Planning the edit' and job['result'] == {'verified': True}
        assert client.post('/api/models/edit', json={**body, 'prompt': 'x'}).status_code == 422
