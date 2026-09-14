"""Contract and real-engine integration checks for the first workbench slice."""
import asyncio
import json
from pathlib import Path
import uuid
import pytest
from pydantic import ValidationError
from server.models import Project
from server.modelica import emit_project, semantic_hash
from server.engine import simulate

FIXTURE = Path(__file__).with_name('motor-project.json')

def project():
    return Project.model_validate_json(FIXTURE.read_text())

def test_layout_does_not_change_executable_model():
    p=project()
    baseline=semantic_hash(p)
    p.blocks[0].position.x += 456
    p.blocks[0].position.y -= 102
    assert semantic_hash(p)==baseline
    p.blocks[0].definition.parameters[0].value=80
    assert semantic_hash(p)!=baseline

def test_connection_domains_and_single_signal_driver():
    raw=json.loads(FIXTURE.read_text())
    raw['wires'][0]['target']='motor'
    raw['wires'][0]['targetHandle']='p'
    with pytest.raises(ValidationError,match='same domain'):
        Project.model_validate(raw)
    raw=json.loads(FIXTURE.read_text())
    controller = next(b for b in raw['blocks'] if b['id']=='controller')
    output = next(p['id'] for p in controller['definition']['ports'] if p['direction']=='output')
    raw['wires'].append({**raw['wires'][0],'id':'duplicateDriver','source':'controller','sourceHandle':output})
    with pytest.raises(ValidationError,match='only one source'):
        Project.model_validate(raw)

def test_reject_invalid_parameter_and_duplicate_names():
    raw=json.loads(FIXTURE.read_text())
    next(b for b in raw['blocks'] if b['id']=='motor')['definition']['parameters'][0]['value']=-1
    with pytest.raises(ValidationError,match='Resistance'):
        Project.model_validate(raw)
    raw=json.loads(FIXTURE.read_text())
    raw['blocks'][0]['definition']['parameters'][0]['id']='y'
    with pytest.raises(ValidationError,match='unique names'):
        Project.model_validate(raw)

@pytest.mark.integration
def test_real_model_parameter_changes_and_feedback():
    async def run():
        base=project()
        altered=project()
        altered.blocks[0].definition.parameters[0].value=60
        a,b=await asyncio.gather(simulate(base,'test'+uuid.uuid4().hex[:12]),simulate(altered,'test'+uuid.uuid4().hex[:12]))
        def series(r,key):return next(s['values'] for s in r['series'] if s['key']==key)
        assert abs(series(a,'load.w')[-1]-100)<1
        assert abs(series(b,'load.w')[-1]-60)<1
        assert max(series(a,'controller.y'))<=24.00001
        assert len(a['time'])<a['samples']
        assert all(len(s['values'])==len(a['time']) for s in a['series'])
        assert all(t1<=t2 for t1,t2 in zip(a['time'],a['time'][1:]))
        disconnected=project()
        disconnected.wires=[w for w in disconnected.wires if not (w.source=='sensor' and w.target=='controller')]
        with pytest.raises(RuntimeError):
            await simulate(disconnected,'test'+uuid.uuid4().hex[:12])
    asyncio.run(run())

def test_block_sizes_round_trip_without_changing_execution_identity():
    from server.models import Size
    from server.modelica import project_key
    p=project()
    executable=semantic_hash(p)
    key=project_key(p)
    p.blocks[0].size=Size(width=240,height=170)
    restored=Project.model_validate_json(p.model_dump_json())
    assert restored.blocks[0].size.width==240
    assert restored.blocks[0].size.height==170
    assert semantic_hash(restored)==executable
    assert project_key(restored)==key

@pytest.mark.integration
def test_foc_tracks_speed_rejects_load_and_keeps_phases_balanced():
    fixture=Path(__file__).parents[1]/'models/examples/foc.json'
    async def run():
        baseline=Project.model_validate_json(fixture.read_text())
        slower=baseline.model_copy(deep=True)
        next(b for b in slower.blocks if b.id=='reference').definition.parameters[0].value=1000
        a,b=await asyncio.gather(simulate(baseline,'foc'+uuid.uuid4().hex[:12]),simulate(slower,'foc'+uuid.uuid4().hex[:12]))
        def trace(r,key): return next(s['values'] for s in r['series'] if s['key']==key)
        assert abs(trace(a,'motor.rpm')[-1]-1500)<2
        assert abs(trace(b,'motor.rpm')[-1]-1000)<2
        assert max(trace(a,'motor.rpm'))<1650
        assert max(abs(v) for t,v in zip(a['time'],trace(a,'park.id')) if t>.6)<.02
        assert max(abs(x+y+z) for x,y,z in zip(trace(a,'motor.ia'),trace(a,'motor.ib'),trace(a,'motor.ic')))<1e-8
        assert trace(a,'load.loadTorque')[0]==pytest.approx(.05)
        assert trace(a,'load.loadTorque')[-1]==pytest.approx(.4)
        before=[v for t,v in zip(a['time'],trace(a,'motor.torque')) if .40<t<.44]
        assert trace(a,'motor.torque')[-1]>sum(before)/len(before)+.2
        assert all(len(s['values'])==len(a['time']) for s in a['series'])
    asyncio.run(run())


def test_junction_geometry_is_absent_from_execution_and_rejects_two_drivers():
    from server.models import flatten_connects
    raw = json.loads(FIXTURE.read_text())
    w = raw['wires'][0]
    source, target, handle = w['source'], w['target'], w['targetHandle']
    raw['junctions'] = [{'id': 'test_j', 'domain': 'signal', 'position': {'x': 180, 'y': 140}}]
    raw['wires'][0] = {**w, 'target': 'test_j', 'targetHandle': 'node', 'waypoints': [{'x': 180, 'y': 60}]}
    raw['wires'].append({'id': 'test_branch', 'source': 'test_j', 'sourceHandle': 'node', 'target': target, 'targetHandle': handle})
    p = Project.model_validate(raw)
    assert flatten_connects(p) == flatten_connects(project())
    assert semantic_hash(p) == semantic_hash(project())
    from server.models import Position
    p.junctions[0].position.x += 200
    p.wires[0].waypoints = [Position(x=50, y=100)]
    assert semantic_hash(p) == semantic_hash(project())
    other = next(b for b in raw['blocks'] if b['id'] == 'controller')
    output = next(port['id'] for port in other['definition']['ports'] if port['direction'] == 'output')
    raw['wires'].append({'id':'bad_driver','source':other['id'],'sourceHandle':output,'target':'test_j','targetHandle':'node'})
    with pytest.raises(ValidationError, match='signal net may have only one source'):
        Project.model_validate(raw)


def test_physical_connection_set_has_no_duplicate_or_reverse_pairs():
    from server.models import flatten_connects
    pairs = flatten_connects(project())
    undirected = {tuple(sorted(((a, b), (c, d)))) for a, b, c, d in pairs}
    assert len(undirected) == len(pairs)


@pytest.mark.integration
def test_branched_feedback_runs_in_openmodelica():
    fixture = Path(__file__).parent / 'fixtures/feedback-project.json'
    async def run():
        p = Project.model_validate_json(fixture.read_text())
        result = await simulate(p, 'wiring'+uuid.uuid4().hex[:12])
        traces = {s['key']:s['values'] for s in result['series']}
        assert traces['gain.y'][-1] == pytest.approx(traces['reference.y'][-1]/3, abs=1e-6)
        assert traces['scope.u'][-1] == pytest.approx(traces['gain.y'][-1], abs=1e-6)
        assert traces['display.u'][-1] == pytest.approx(traces['reference.y'][-1], abs=1e-6)
        assert next(s for s in result['series'] if s['key'] == 'scope.u')['name'] == 'Scope.u'
        import csv
        from server.engine import RUNS
        with (RUNS/result['id']/'simulation_res.csv').open() as stream:
            last = list(csv.DictReader(stream))[-1]
        assert float(last['scope.u']) == pytest.approx(traces['gain.y'][-1], abs=1e-6)
        assert float(last['display.u']) == pytest.approx(traces['reference.y'][-1], abs=1e-6)
    asyncio.run(run())


def test_a_disconnected_branch_can_be_saved_and_reconnected_to_one_driver():
    from server.models import flatten_connects
    raw = json.loads(FIXTURE.read_text())
    controller = next(b for b in raw['blocks'] if b['id'] == 'controller')
    inputs = [p['id'] for p in controller['definition']['ports'] if p['direction'] == 'input']
    raw['wires'] = [{'id':'partial','source':'controller','sourceHandle':inputs[0],'target':'controller','targetHandle':inputs[1]}]
    partial = Project.model_validate(raw)
    assert flatten_connects(partial) == []
    raw['wires'].append({'id':'reconnect','source':'reference','sourceHandle':'y','target':'controller','targetHandle':inputs[0]})
    restored = Project.model_validate(raw)
    assert len(flatten_connects(restored)) == 2

def test_label_offsets_roundtrip_without_changing_simulation():
    p=project()
    source=emit_project(p)
    key=semantic_hash(p)
    raw=p.model_dump()
    raw['blocks'][0]['labelOffset']={'x':27.5,'y':-84}
    moved=Project.model_validate(raw)
    restored=Project.model_validate_json(moved.model_dump_json())
    assert restored.blocks[0].labelOffset.x==27.5
    assert restored.blocks[0].labelOffset.y==-84
    assert emit_project(restored)==source
    assert semantic_hash(restored)==key
    raw['blocks'][0]['labelOffset']['x']=float('inf')
    with pytest.raises(ValidationError):
        Project.model_validate(raw)


def named_project():
    """Net metadata over the same topology used by the compiler."""
    from server.models import net_components
    p = project()
    raw = p.model_dump(exclude_none=True)
    raw['nets'] = []
    for i, component in enumerate(net_components(p)):
        endpoints = set(component)
        wires = [w.id for w in p.wires if (w.source, w.sourceHandle) in endpoints]
        raw['nets'].append({'id': f'net_test_{i}', 'name': f'Signal {i}',
            'anchor': '.'.join(component[0]), 'wireIds': wires,
            'label': {'wireId': wires[0], 'fraction': .37, 'side': -1}})
    return raw


def test_net_metadata_roundtrips_and_cannot_affect_compilation_or_result_cache():
    from server.modelica import project_key
    raw = named_project()
    p = Project.model_validate(raw)
    restored = Project.model_validate_json(p.model_dump_json(exclude_none=True))
    assert restored.nets[0].id == 'net_test_0'
    assert restored.nets[0].name == 'Signal 0'
    assert restored.nets[0].label.fraction == .37
    assert emit_project(restored) == emit_project(project())
    assert semantic_hash(restored) == semantic_hash(project())
    assert project_key(restored) == project_key(project())
    restored.nets[0].name = 'ω / measured current'
    restored.nets[0].hidden = True
    assert project_key(restored) == project_key(project())


@pytest.mark.parametrize('mutation, message', [
    (lambda n: n[1].update(id=n[0]['id']), 'Net identifiers must be unique'),
    (lambda n: n.pop(), 'Every wire must belong to exactly one net'),
    (lambda n: n[1]['wireIds'].append(n[0]['wireIds'][0]), 'Every wire must belong to exactly one net'),
    (lambda n: n[0].update(anchor='missing.port'), 'net anchor must belong'),
    (lambda n: n[0]['label'].update(wireId=n[1]['wireIds'][0]), 'label must be attached'),
    (lambda n: n[0]['label'].update(fraction=float('inf')), 'finite number'),
    (lambda n: n[0].update(name='x'*121), 'at most 120'),
])
def test_invalid_net_metadata_is_rejected(mutation, message):
    raw = named_project()
    mutation(raw['nets'])
    with pytest.raises(ValidationError, match=message):
        Project.model_validate(raw)


def test_disconnected_nets_cannot_share_one_id():
    raw = named_project()
    other = raw['nets'].pop()
    raw['nets'][0]['wireIds'].extend(other['wireIds'])
    with pytest.raises(ValidationError, match='one connected component'):
        Project.model_validate(raw)


def test_connected_branches_cannot_claim_separate_net_ids():
    raw = named_project()
    net = next(n for n in raw['nets'] if len(n['wireIds']) > 1)
    wire_id = net['wireIds'].pop()
    wire = next(w for w in raw['wires'] if w['id'] == wire_id)
    net.pop('label')
    raw['nets'].append({'id':'net_invalid_split','anchor':f"{wire['source']}.{wire['sourceHandle']}", 'wireIds':[wire_id]})
    with pytest.raises(ValidationError, match='share one net identifier|anchor must belong'):
        Project.model_validate(raw)


def test_automatic_block_names_do_not_invalidate_simulation_or_cache():
    from server.modelica import project_key
    p = project()
    source, key, model_hash = emit_project(p), project_key(p), semantic_hash(p)
    for i, block in enumerate(p.blocks):
        block.definition.name = 'Block' if i == 0 else f'Block{i}'
    assert emit_project(p) == source
    assert project_key(p) == key
    assert semantic_hash(p) == model_hash
    restored = Project.model_validate_json(p.model_dump_json())
    assert [b.definition.name for b in restored.blocks] == [b.definition.name for b in p.blocks]
