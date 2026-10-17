import asyncio
import uuid
import json
from pathlib import Path
import pytest
from server.models import Project
from server.modelica import emit_project, semantic_hash
from server.logging_signals import logged_signals
from server.engine import simulate


def circuit():
    raw=json.loads((Path(__file__).parents[1]/'models/examples/buck.json').read_text(encoding='utf-8'))
    p=Project.model_validate(raw)
    blocks={b.id:b for b in p.blocks}
    selected=next(n for n in p.nets if any(w.id in n.wireIds and any(port.id==w.sourceHandle and port.direction=='output' for port in blocks[w.source].definition.ports) for w in p.wires if w.source in blocks))
    selected.logged=True
    return p


def test_signal_logging_emits_observable_and_changes_run_contract():
    p=circuit()
    logs=logged_signals(p)
    assert len(logs)==1
    assert f"output Real {logs[0]['key']}" in emit_project(p)
    before=semantic_hash(p)
    next(n for n in p.nets if n.logged).logged=False
    assert semantic_hash(p)!=before


def test_physical_nets_require_sensors():
    p=circuit()
    for n in p.nets: n.logged=False
    physical=next(w for w in p.wires if any(b.id==w.source and b.definition.domain=='electrical' for b in p.blocks) and w.sourceHandle in {'p','n'})
    next(n for n in p.nets if physical.id in n.wireIds).logged=True
    with pytest.raises(ValueError,match='sensor'):
        logged_signals(p)
    with pytest.raises(ValueError,match='sensor'):
        Project.model_validate(p.model_dump())


@pytest.mark.integration
def test_logged_signal_is_present_in_real_solver_output():
    p=circuit()
    result=asyncio.run(simulate(p,'logging'+uuid.uuid4().hex[:12]))
    # Results lists only what is logged: the logged net, beside the outputs the template's plots log.
    assert any(s.get('netId') for s in result['series'])
    assert all(s.get('netId') or s['key'].split('.')[0] in {b.id for b in p.blocks if b.logged} for s in result['series'])
    # Logging the output that drives a logged net lists it once, under the output's key.
    expression=logged_signals(p)[0]['expression']
    block_id, _, port = expression.partition('.')
    for b in p.blocks:
        if b.id == block_id:
            b.logged=[port]
    both=asyncio.run(simulate(p,'logging'+uuid.uuid4().hex[:12]))
    keys=[s['key'] for s in both['series']]
    assert expression in keys and len(keys)==len(result['series'])
    original=next(s for s in both['series'] if s['key']==expression)
    logged=next(s for s in result['series'] if s.get('netId')==logged_signals(p)[0]['netId'])
    assert logged['values']==original['values']


def test_full_resolution_endpoint_preserves_event_pairs(tmp_path, monkeypatch):
    from server import app as module
    from fastapi.testclient import TestClient
    folder=tmp_path/'run1';folder.mkdir()
    (folder/'result.json').write_text(json.dumps(dict(id='run1',duration=1,time=[0,1],series=[dict(key='signal',values=[0,2])],samples=4)), encoding='utf-8')
    (folder/'simulation_res.csv').write_text('time,signal\n0,0\n0.5,0\n0.5,2\n1,2\n1.1,2\n', encoding='utf-8')
    monkeypatch.setattr(module,'RUNS',tmp_path)
    with TestClient(module.app) as client:
        response=client.get('/api/results/run1/data')
        assert response.status_code==200
        data=response.json()
        assert data['time']==[0,.5,.5,1]
        assert data['series'][0]['values']==[0,0,2,2]
        assert client.get('/api/results/missing/data').status_code==404


@pytest.mark.integration
def test_results_list_only_what_is_logged_and_physical_variables_on_request():
    from tests.test_physical_buses import flat_document
    doc = flat_document()
    # Nothing logged: the run records nothing, though it simulates everything.
    bare = asyncio.run(simulate(Project.model_validate(doc), 'rec' + uuid.uuid4().hex[:10]))
    assert bare['series'] == []
    # A sensor output logged with no wire on it is recorded, and only it.
    doc['wires'] = [w for w in doc['wires'] if w['source'] != 'vs' or w['sourceHandle'] != 'v']
    for block in doc['blocks']:
        if block['id'] == 'vs':
            block['logged'] = ['v']
    one = asyncio.run(simulate(Project.model_validate(doc), 'rec' + uuid.uuid4().hex[:10]))
    assert [s['key'] for s in one['series']] == ['vs.v'] and one['series'][0]['values'][-1] == pytest.approx(10)
    # Physical variables on request, apart from logged signals.
    doc['logPhysical'] = True
    full = asyncio.run(simulate(Project.model_validate(doc), 'rec' + uuid.uuid4().hex[:10]))
    physical = {s['key']: s for s in full['series'] if s.get('physical')}
    assert physical['r.v']['values'][-1] == pytest.approx(10) and physical['r.v']['unit'] == 'V'
    assert physical['r.i']['values'][-1] == pytest.approx(5)
    assert 'hot.port.T' in physical and 'b1.e1' not in physical
    assert [s['key'] for s in full['series'] if not s.get('physical')] == ['vs.v']
    # A mark on a port that is not an output is dropped, not refused.
    pruned = Project.model_validate({**doc, 'blocks': [{**doc['blocks'][0], 'logged': ['p']}, *doc['blocks'][1:]]})
    assert pruned.blocks[0].logged is None
