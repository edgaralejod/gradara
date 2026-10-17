# SPDX-License-Identifier: Apache-2.0
"""AI model editing: bounded operations, all-or-nothing application, and the edit pipeline."""
import asyncio
import json
from pathlib import Path
from unittest.mock import AsyncMock
import pytest
from server import model_edit as editing
from server.diagnostics import Diagnostic, SimulationFailure
from server.hierarchy import boundary_blocks
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


def feedback_wire(project: Project) -> str:
    return next(w.id for w in project.wires if w.source == 'sensor' and w.sourceHandle == 'y')


def test_disconnect_by_wire_or_endpoints_and_nets_follow():
    before = servo()
    feedback = feedback_wire(before)
    edited, changes = apply(before, op('disconnect', wireId=feedback))
    assert feedback not in {w.id for w in edited.wires}
    assert all(feedback not in n.wireIds for n in edited.nets)
    assert len(edited.nets) == len(before.nets) - 1
    drive = next(w.id for w in before.wires if w.source == 'controller' and w.target == 'drive')
    edited, _ = apply(before, op('disconnect', source='controller', sourcePort='y', target='drive', targetPort='v'))
    assert drive not in {w.id for w in edited.wires}
    kept = [w for w in edited.wires]
    assert all(w == next(x for x in before.wires if x.id == w.id) for w in kept)


def test_new_wires_join_nets_so_models_with_nets_stay_valid():
    before = servo()
    edited, _ = apply(before, op('add_block', libraryId='builtin:scope', alias='angleScope', near='sensor'),
                      op('connect', source='sensor', sourcePort='y', target='angleScope', targetPort='u'),
                      op('add_block', libraryId='builtin:display', alias='shown'),
                      op('add_block', libraryId='builtin:step', alias='other'),
                      op('connect', source='other', sourcePort='y', target='shown', targetPort='u'))
    feedback_net = next(n for n in edited.nets if feedback_wire(before) in n.wireIds)
    assert 'w_ai_1' in feedback_net.wireIds and feedback_net.name == 'θ measured'
    fresh = next(n for n in edited.nets if 'w_ai_2' in n.wireIds)
    assert fresh.wireIds == ['w_ai_2'] and fresh.id.startswith('net_ai_')
    owners = [i for n in edited.nets for i in n.wireIds]
    assert sorted(owners) == sorted(w.id for w in edited.wires)


def test_log_signal_logs_the_output_for_the_data_inspector():
    before = servo()
    edited, changes = apply(before, op('log_signal', blockId='sensor', sourcePort='y'))
    sensor = next(b for b in edited.blocks if b.id == 'sensor')
    assert 'y' in sensor.logged and changes[0].op == 'log_signal' and changes[0].blockIds == ['sensor']
    assert 'Data Inspector' in changes[0].description
    # An output need not be connected: a block added in the same edit can be logged at once.
    edited, _ = apply(before, op('add_block', libraryId='builtin:step', alias='probe'),
                      op('log_signal', blockId='probe', sourcePort='y'))
    assert next(b for b in edited.blocks if b.id == 'b_probe').logged == ['y']


@pytest.mark.parametrize('operation, message', [
    (op('log_signal', blockId='motor', sourcePort='pin_ap'), 'not a signal output'),
    (op('log_signal', blockId='controller', sourcePort='nope'), 'does not exist'),
])
def test_log_signal_refuses_what_cannot_be_logged(operation, message):
    with pytest.raises(ValueError, match=message):
        apply(servo(), operation)


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
    # Inside subsystems too: the prompt carries behavior and connectivity only.
    grouped = Project.model_validate_json((ROOT/'tests/fixtures/grouped-dc.json').read_text(encoding='utf-8'))
    view = editing.semantic_view(grouped)
    assert len(view['subsystems']) == 2
    for sheet in [view, *view['subsystems']]:
        assert 'junctions' not in sheet and 'annotations' not in sheet
        for block in sheet['blocks']:
            assert not any(key in block for key in editing.LAYOUT)
            assert all('side' not in p and 'offset' not in p for p in block['definition']['ports'])
        assert all('waypoints' not in w and 'junctions' not in w for w in sheet['wires'])
        assert all('label' not in n for n in sheet.get('nets') or [])


# ---------------------------------------------------------------- grouping

def grouped_servo():
    before = servo()
    edited, changes = apply(before, op('group_into_subsystem', blockIds=['controller', 'drive', 'isens', 'motor'],
                                       alias='stage', name='Motor stage'))
    return before, edited, changes


def test_group_into_subsystem_keeps_ids_and_makes_ports_of_cut_nets():
    before, edited, changes = grouped_servo()
    instance = next(b for b in edited.blocks if b.id == 'b_stage')
    assert instance.definition.subsystem.ref == 's_stage' and instance.definition.name == 'Motor stage'
    assert edited.version == 2
    sub = next(s for s in edited.subsystems if s.id == 's_stage')
    # Inner blocks keep their IDs, definitions, and positions.
    for ident in ('controller', 'drive', 'isens', 'motor'):
        assert next(b for b in sub.blocks if b.id == ident) == next(b for b in before.blocks if b.id == ident)
        assert ident not in {b.id for b in edited.blocks}
    # One port per cut net: inputs first, then outputs, then terminals, named after the inside port or the net.
    ports = [(p.id, p.name, p.direction, p.domain) for p in instance.definition.ports]
    assert ports == [('p_stage_ref', 'ref', 'input', 'signal'), ('p_stage_measured', 'θ measured', 'input', 'signal'),
                     ('p_stage_a', 'a−', 'physical', 'electrical'), ('p_stage_shaft', 'shaft', 'physical', 'mechanical')]
    pills = boundary_blocks(sub)
    assert [b.definition.kind for b in pills] == ['inport', 'inport', 'connport', 'connport']
    assert [b.definition.boundary.order for b in pills] == [0, 1, 2, 3]
    assert [b.definition.symbol for b in pills[:2]] == ['1', '2']
    assert changes[0].op == 'group_into_subsystem' and changes[0].blockIds[0] == 'b_stage'
    assert set(changes[0].blockIds[1:]) == {'controller', 'drive', 'isens', 'motor'}
    assert changes[0].description == 'Group 4 blocks into Motor stage'
    assert Project.model_validate(edited.model_dump()) == edited


def test_group_keeps_outer_wires_and_nets_and_copies_nets_inside_unlogged():
    before = servo()
    feedback = feedback_wire(before)
    net_before = next(n for n in before.nets if feedback in n.wireIds)
    net_before.logged = True
    edited, _ = apply(before, op('group_into_subsystem', blockIds=['controller', 'drive', 'isens', 'motor'], alias='stage'))
    # The cut feedback wire keeps its ID outside and now ends on the instance port.
    wire = next(w for w in edited.wires if w.id == feedback)
    assert (wire.source, wire.sourceHandle, wire.target, wire.targetHandle) == ('sensor', 'y', 'b_stage', 'p_stage_measured')
    outer = next(n for n in edited.nets if feedback in n.wireIds)
    assert outer.id == net_before.id and outer.name == 'θ measured' and outer.logged
    sub = edited.subsystems[-1]
    assert sub.name == 'Subsystem 1'
    inner = next(n for n in sub.nets if n.id == net_before.id)
    assert inner.name == 'θ measured' and not inner.logged
    inner_wire = next(w for w in sub.wires if w.id in inner.wireIds)
    assert inner.wireIds == [inner_wire.id] and inner_wire.id.startswith('w_stage_')
    assert (inner_wire.source, inner_wire.sourceHandle, inner_wire.target, inner_wire.targetHandle) == \
        ('p_stage_measured', 'y', 'controller', 'measured')
    # Every wire on every sheet belongs to one net.
    for sheet in [edited, sub]:
        assert sorted(i for n in sheet.nets for i in n.wireIds) == sorted(w.id for w in sheet.wires)
    # Untouched wires keep their routes.
    kept = [w for w in edited.wires if w.source != 'b_stage' and w.target != 'b_stage']
    assert all(w == next(x for x in before.wires if x.id == w.id) for w in kept)


def test_later_operations_use_the_instance_and_its_ports():
    edited, changes = apply(servo(), op('group_into_subsystem', blockIds=['controller', 'drive', 'isens', 'motor'], alias='stage'),
                            op('add_block', libraryId='builtin:scope', alias='probe', near='stage'),
                            op('disconnect', source='reference', sourcePort='y', target='stage', targetPort='p_stage_ref'),
                            op('add_block', libraryId='builtin:step', alias='other'),
                            op('connect', source='other', sourcePort='y', target='stage', targetPort='p_stage_ref'),
                            op('rename_block', blockId='stage', name='Drive'))
    wire = next(w for w in edited.wires if w.source == 'b_other')
    assert (wire.target, wire.targetHandle) == ('b_stage', 'p_stage_ref')
    assert next(b for b in edited.blocks if b.id == 'b_stage').definition.name == 'Drive'
    assert [c.op for c in changes] == ['group_into_subsystem', 'add_block', 'disconnect', 'add_block', 'connect', 'rename_block']
    assert sorted(i for n in edited.nets for i in n.wireIds) == sorted(w.id for w in edited.wires)
    with pytest.raises(ValueError, match='is now inside Subsystem 1; this edit cannot change it further'):
        apply(servo(), op('group_into_subsystem', blockIds=['controller', 'drive'], alias='g'),
              op('set_parameter', blockId='controller', parameterId='kp', value=1))


def goto_servo():
    project = servo()
    goto = catalog()['builtin:gain'].model_copy(deep=True)
    goto.kind, goto.name, goto.tag, goto.ports = 'goto', 'Goto', 'spd', [goto.ports[0]]
    sender = catalog()['builtin:gain'].model_copy(deep=True)
    sender.kind, sender.name, sender.tag, sender.ports = 'from', 'From', 'spd', [sender.ports[1]]
    data = project.model_dump(exclude_none=True)
    data['blocks'] += [{'id': 'g1', 'definition': goto.model_dump(exclude_none=True), 'position': {'x': 0, 'y': 900}},
                       {'id': 'f1', 'definition': sender.model_dump(exclude_none=True), 'position': {'x': 300, 'y': 900}}]
    return Project.model_validate(data)


@pytest.mark.parametrize('operation, message', [
    (op('group_into_subsystem', blockIds=['controller'], alias='g'), '2 to 200 blocks'),
    (op('group_into_subsystem', blockIds=['controller', 'nope'], alias='g'), 'Unknown block "nope"'),
    (op('group_into_subsystem', blockIds=['controller', 'controller'], alias='g'), 'listed twice'),
    (op('group_into_subsystem', blockIds=['controller', 'drive'], alias='9x'), 'short alias'),
    (op('group_into_subsystem', blockIds=['controller', 'drive'], alias='g', name=''), '1 to 100 characters'),
])
def test_group_refuses_bad_selections(operation, message):
    with pytest.raises(ValueError, match=message):
        apply(servo(), operation)


def test_group_refuses_a_goto_whose_from_stays_outside_and_blocks_inside_subsystems():
    with pytest.raises(ValueError, match=r'Tags reach down only: group the From too, or leave the Goto outside'):
        apply(goto_servo(), op('group_into_subsystem', blockIds=['g1', 'controller'], alias='g'))
    edited, _ = apply(goto_servo(), op('group_into_subsystem', blockIds=['g1', 'f1'], alias='g'))
    assert {b.id for b in edited.subsystems[-1].blocks} >= {'g1', 'f1'}
    grouped = Project.model_validate_json((ROOT/'tests/fixtures/grouped-dc.json').read_text(encoding='utf-8'))
    with pytest.raises(ValueError, match='"controller" is inside Drivetrain; the AI groups top-level blocks only'):
        apply(grouped, op('group_into_subsystem', blockIds=['reference', 'controller'], alias='g'))
    with pytest.raises(ValueError, match='subsystem port'):
        from server import grouping
        grouping.group(grouped.model_copy(update={'blocks': [*grouped.blocks, grouped.subsystems[0].blocks[3]]}),
                       ['reference', grouped.subsystems[0].blocks[3].id], 'g', 'G')


def test_group_limits():
    groups = [op('group_into_subsystem', blockIds=['a', 'b'], alias=f'g{i}') for i in range(9)]
    with pytest.raises(ValueError, match='at most 8'):
        editing.check_limits(plan(*groups))
    editing.check_limits(plan(*groups[:8]))
    with pytest.raises(ValueError, match='needs alias and blockIds'):
        editing.check_limits(plan(op('group_into_subsystem', alias='g')))


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


def test_a_proposal_carries_its_operations_and_can_be_revised(monkeypatch, tmp_path):
    provider, _ = setup(monkeypatch, tmp_path, [ADD_SCOPE, ADD_SCOPE])
    first = asyncio.run(editing.edit_model(request(), 'job1'))
    assert first['operations'] == [{k: v for k, v in o.items() if v is not None} for o in ADD_SCOPE['operations']]
    assert 'revising a proposal' not in provider.call_args.args[0]
    # Refine sends the earlier request and operations back with the revision.
    previous = {'prompt': 'Add a scope on the speed', 'summary': first['summary'], 'operations': first['operations']}
    revision = editing.ModelEditRequest(prompt='Name it Shaft speed instead', project=motor(),
                                        catalog=list(catalog().values()), previous=previous)
    asyncio.run(editing.edit_model(revision, 'job2'))
    prompt = provider.call_args.args[0]
    assert 'revising a proposal' in prompt and 'User request:' not in prompt
    assert prompt.index('Add a scope on the speed') < prompt.index('"libraryId": "builtin:scope"') \
        < prompt.index('Name it Shaft speed instead') < prompt.index('Current model')


def test_a_revision_needs_well_formed_earlier_operations():
    for operations in ([], [{'op': 'format_disk'}], [{'op': 'connect', 'surprise': 1}]):
        with pytest.raises(ValueError):
            request(previous={'prompt': 'Earlier', 'summary': 'Earlier', 'operations': operations})


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


# Edits inside a subsystem: the sheet is a path of instance IDs (server/sheets.py), the operations
# apply to that definition, and every instance follows its ports.

POWER = ['b_grp000e', 'b_grp0002']   # top level → Drivetrain → Power stage
DRIVETRAIN = ['b_grp000e']


def grouped_dc() -> Project:
    return Project.model_validate_json((ROOT/'tests/fixtures/grouped-dc.json').read_text(encoding='utf-8'))


def sheet_catalog() -> dict[str, Definition]:
    from server.grouping import boundary_definition
    return catalog() | {f'builtin:{k}': boundary_definition(k, k, 'signal' if k != 'connport' else 'electrical', 0)
                        for k in ('inport', 'outport', 'connport')}


def apply_in(project, sheet, *operations):
    return editing.apply_operations(project, plan(*operations), sheet_catalog(), sheet=sheet)


def subsystem(project: Project, ident: str):
    return next(s for s in project.subsystems if s.id == ident)


def test_an_edit_inside_a_subsystem_changes_only_that_definition():
    before = grouped_dc()
    edited, changes = apply_in(before, POWER, op('set_parameter', blockId='motor', parameterId='Ra', value=0.25))
    motor_block = next(b for b in subsystem(edited, 'sub_grp0001').blocks if b.id == 'motor')
    assert next(p.value for p in motor_block.definition.parameters if p.id == 'Ra') == 0.25
    assert changes[0].blockIds == ['motor']
    # The top level and the other definition are as they were.
    assert edited.model_dump()['blocks'] == before.model_dump()['blocks']
    assert subsystem(edited, 'sub_grp000d').model_dump() == subsystem(before, 'sub_grp000d').model_dump()


def test_blocks_on_other_sheets_cannot_be_named():
    with pytest.raises(ValueError, match='Unknown block "sensor"'):
        apply_in(grouped_dc(), POWER, op('rename_block', blockId='sensor', name='Tach'))
    with pytest.raises(ValueError, match='no longer in the model'):
        apply_in(grouped_dc(), ['b_grp000e', 'gone'], op('set_duration', duration=2))


def test_a_port_added_inside_appears_on_every_instance():
    edited, changes = apply_in(grouped_dc(), POWER,
                               op('add_block', libraryId='builtin:outport', alias='cur', name='current'),
                               op('connect', source='isens', sourcePort='y', target='cur', targetPort='u'))
    pill = next(b for b in subsystem(edited, 'sub_grp0001').blocks if b.id == 'b_cur')
    assert pill.definition.kind == 'outport' and pill.definition.boundary.order == 1   # after the one input
    instance = next(b for b in subsystem(edited, 'sub_grp000d').blocks if b.id == 'b_grp0002')
    assert ('b_cur', 'output', 'signal') in [(p.id, p.direction, p.domain) for p in instance.definition.ports]
    assert [c.op for c in changes] == ['add_block', 'connect']


def test_an_unwired_port_takes_the_type_of_its_first_connection():
    edited, _ = apply_in(grouped_dc(), POWER,
                         op('add_block', libraryId='builtin:connport', alias='case', name='case'),
                         op('connect', source='case', sourcePort='p', target='motor', targetPort='flange'))
    pill = next(b for b in subsystem(edited, 'sub_grp0001').blocks if b.id == 'b_case')
    assert pill.definition.ports[0].domain == 'mechanical'
    instance = next(b for b in subsystem(edited, 'sub_grp000d').blocks if b.id == 'b_grp0002')
    assert ('b_case', 'physical', 'mechanical') in [(p.id, p.direction, p.domain) for p in instance.definition.ports]


def test_removing_a_port_inside_drops_its_wires_outside():
    before = grouped_dc()
    outside = [w.id for w in before.wires if w.targetHandle == 'p_grp000j']
    assert outside
    edited, changes = apply_in(before, DRIVETRAIN, op('remove_block', blockId='p_grp000j'))
    assert 'subsystem port' in changes[0].description
    instance = next(b for b in edited.blocks if b.id == 'b_grp000e')
    assert 'p_grp000j' not in [p.id for p in instance.definition.ports]
    assert not {w.id for w in edited.wires} & set(outside)
    assert sorted(i for n in edited.nets for i in n.wireIds) == sorted(w.id for w in edited.wires)


def test_blocks_inside_a_subsystem_can_be_grouped_further():
    edited, changes = apply_in(grouped_dc(), POWER,
                               op('group_into_subsystem', blockIds=['drive', 'isens'], alias='amp', name='Amplifier'))
    inner = subsystem(edited, 'sub_grp0001')
    assert 'b_amp' in [b.id for b in inner.blocks] and 'drive' not in [b.id for b in inner.blocks]
    assert subsystem(edited, 's_amp').name == 'Amplifier'
    assert changes[0].op == 'group_into_subsystem'
    from server.diagnostics import validate_simulation
    validate_simulation(edited)


def test_the_prompt_and_proposal_name_the_sheet(monkeypatch, tmp_path):
    plans = [{'summary': 'Lower Ra.', 'assumptions': [], 'unsupported': '',
              'operations': [op('set_parameter', blockId='motor', parameterId='Ra', value=0.25)]}]
    provider, _ = setup(monkeypatch, tmp_path, plans)
    monkeypatch.setattr(editing, 'catalog_snapshot', lambda req, _: sheet_catalog())
    edit = editing.ModelEditRequest(prompt='Lower the armature resistance', project=grouped_dc(),
                                    catalog=list(catalog().values()), selection=['motor'], sheet=POWER)
    result = asyncio.run(editing.edit_model(edit, 'job1'))
    prompt = provider.call_args.args[0]
    assert 'inside of the subsystem "Power stage" (definition sub_grp0001' in prompt
    assert 'DC motor (motor)' in prompt and 'builtin:connport' in prompt
    assert result['sheet'] == POWER
    motor_block = next(b for s in result['project']['subsystems'] if s['id'] == 'sub_grp0001'
                       for b in s['blocks'] if b['id'] == 'motor')
    assert next(p['value'] for p in motor_block['definition']['parameters'] if p['id'] == 'Ra') == 0.25


def test_top_level_edits_offer_no_subsystem_ports(monkeypatch, tmp_path):
    provider, _ = setup(monkeypatch, tmp_path, [ADD_SCOPE])
    monkeypatch.setattr(editing, 'catalog_snapshot', lambda req, _: sheet_catalog())
    result = asyncio.run(editing.edit_model(request(), 'job1'))
    prompt = provider.call_args.args[0]
    assert 'builtin:inport' not in prompt and 'inside of the subsystem' not in prompt
    assert result['sheet'] == []


def test_a_shared_definition_is_called_out():
    from server.sheets import copies
    doc = grouped_dc()
    twin = next(b for b in doc.blocks if b.id == 'b_grp000e').model_copy(deep=True)
    twin.id = 'twin'
    doc = Project.model_validate(doc.model_dump() | {'blocks': [*doc.model_dump()['blocks'], twin.model_dump()]})
    assert copies(doc, 'sub_grp000d') == 2
    plan_ = plan(op('set_duration', duration=2))
    edited, changes = editing.apply_operations(doc, plan_, sheet_catalog(), sheet=DRIVETRAIN)
    out = editing.proposal(edited, doc, plan_, changes, {}, False, [], None, DRIVETRAIN)
    assert out['assumptions'][0].startswith('The change is inside Drivetrain, so it applies to all 2 blocks')
