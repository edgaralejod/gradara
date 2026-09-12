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
    raw['wires'].append({**raw['wires'][0],'id':'duplicateDriver'})
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
