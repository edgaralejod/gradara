# SPDX-License-Identifier: Apache-2.0
import asyncio
from unittest.mock import AsyncMock
import pytest
from server import model_agent as builder
from server.models import Definition


def source():
    return Definition(kind='constant', name='Constant', description='', domain='signal', symbol='1', ports=[dict(id='y',name='y',domain='signal',direction='output')], parameters=[dict(id='k',name='Value',value=1,min=0)], equations='y=k;')


def plan(**overrides):
    return dict(name='Test system', description='test', assumptions=['Ideal'], unsupported='', reuse=['builtin:constant'], missing=[], **overrides)


def assembly(key='builtin:constant'):
    return dict(duration=.01, instances=[dict(id='source',libraryId=key,name='Source',column=0,row=0,parameters=[])], connections=[])


def setup(monkeypatch, tmp_path, responses):
    monkeypatch.setattr(builder, 'ROOT', tmp_path)
    monkeypatch.setattr(builder, 'list_components', lambda _: [])
    provider = AsyncMock(side_effect=responses)
    monkeypatch.setattr(builder.agent, 'structured_generation', provider)
    simulation = AsyncMock(return_value={'samples':6001})
    monkeypatch.setattr(builder, 'simulate', simulation)
    return provider, simulation


def test_reuses_library_without_creating_blocks(monkeypatch, tmp_path):
    provider, simulation = setup(monkeypatch, tmp_path, [plan(), assembly()])
    creation = AsyncMock()
    monkeypatch.setattr(builder.agent, 'generate_component', creation)
    request = builder.ModelGenerateRequest(prompt='A constant source',catalog=[source()])
    result = asyncio.run(builder.generate_model(request,'test'))
    assert result['reused'] == ['Constant']
    assert result['generated'] == []
    assert result['checked'] and result['samples'] == 6001
    creation.assert_not_awaited()
    simulation.assert_awaited_once()
    assert result['project'].get('modelId') is None  # No saved document is replaced.
    assert request.catalog[0].name == 'Constant'


def test_awaits_typed_dependency_before_assembly(monkeypatch, tmp_path):
    missing = dict(id='special',blockType='signal',prompt='A special source')
    p = plan(); p['missing']=[missing]
    events=[]
    _, _ = setup(monkeypatch,tmp_path,[])
    async def provider(prompt, schema, ident):
        events.append(ident)
        if ident.endswith('plan'): return p
        assert events == ['test-plan','component-start','component-ready','test-assembly0']
        assert 'new:special' in prompt
        return assembly('new:special')
    async def component(prompt, existing, ident, selected):
        assert selected == 'signal'
        events.append('component-start')
        await asyncio.sleep(0)
        events.append('component-ready')
        d=source().model_dump(); d['generated']=True
        return dict(libraryId='ai_checked',definition=d)
    monkeypatch.setattr(builder.agent,'structured_generation',provider)
    monkeypatch.setattr(builder.agent,'generate_component',component)
    result=asyncio.run(builder.generate_model(builder.ModelGenerateRequest(prompt='Special model',catalog=[source()]),'test'))
    assert result['generated'][0]['libraryId']=='ai_checked'


def test_dependency_failure_stops_assembly(monkeypatch,tmp_path):
    p=plan(); p['missing']=[dict(id='special',blockType='electrical',prompt='special device')]
    provider,simulation=setup(monkeypatch,tmp_path,[p])
    monkeypatch.setattr(builder.agent,'generate_component',AsyncMock(side_effect=RuntimeError('bad block')))
    with pytest.raises(RuntimeError,match='bad block'):
        asyncio.run(builder.generate_model(builder.ModelGenerateRequest(prompt='Circuit',catalog=[source()]),'test'))
    assert provider.await_count==1
    simulation.assert_not_awaited()


def test_invalid_reference_repaired_before_simulation(monkeypatch,tmp_path):
    provider,simulation=setup(monkeypatch,tmp_path,[plan(),assembly('invented'),assembly()])
    result=asyncio.run(builder.generate_model(builder.ModelGenerateRequest(prompt='A source',catalog=[source()]),'test'))
    assert result['checked']
    assert 'Unknown library reference' in provider.call_args_list[-1].args[0]
    simulation.assert_awaited_once()


def test_engine_failure_repairs_once(monkeypatch,tmp_path):
    provider,simulation=setup(monkeypatch,tmp_path,[plan(),assembly(),assembly()])
    simulation.side_effect=[RuntimeError('singular system'),{'samples':4}]
    asyncio.run(builder.generate_model(builder.ModelGenerateRequest(prompt='A source',catalog=[source()]),'test'))
    assert 'singular system' in provider.call_args_list[-1].args[0]
    assert simulation.await_count==2


def test_cancel_propagates_without_repair(monkeypatch,tmp_path):
    provider,simulation=setup(monkeypatch,tmp_path,[plan(),assembly()])
    simulation.side_effect=asyncio.CancelledError()
    with pytest.raises(asyncio.CancelledError):
        asyncio.run(builder.generate_model(builder.ModelGenerateRequest(prompt='A source',catalog=[source()]),'test'))
    assert provider.await_count==2


def test_rejects_invented_ports_ranges_and_duplicate_cells():
    p=builder.Plan.model_validate(plan())
    catalog={'builtin:constant':source()}
    bad=assembly(); bad['instances'][0]['parameters']=[dict(id='k',value=-1)]
    with pytest.raises(ValueError): builder.assemble(p,builder.Assembly.model_validate(bad),catalog)
    bad=assembly(); bad['connections']=[dict(source='source',sourcePort='nonexistent',target='source',targetPort='y')]
    with pytest.raises(ValueError): builder.assemble(p,builder.Assembly.model_validate(bad),catalog)
    bad=assembly(); bad['instances'].append({**bad['instances'][0],'id':'second'})
    with pytest.raises(ValueError,match='layout cell'): builder.assemble(p,builder.Assembly.model_validate(bad),catalog)


def test_existing_ai_library_is_available(monkeypatch,tmp_path):
    provider,_=setup(monkeypatch,tmp_path,[{**plan(),'reuse':['ai_existing']},assembly('ai_existing')])
    d=source().model_dump(); d['generated']=True
    monkeypatch.setattr(builder,'list_components',lambda _:[dict(id='ai_existing',definition=d,checked=True)])
    result=asyncio.run(builder.generate_model(builder.ModelGenerateRequest(prompt='Reuse AI source',catalog=[source()]),'test'))
    assert result['reused']==['Constant'] and not result['generated']
    assert 'ai_existing' in provider.call_args_list[0].args[0]


def test_model_generation_api_is_a_job_and_never_saves(monkeypatch, tmp_path):
    from fastapi.testclient import TestClient
    from server import app as service
    monkeypatch.setattr(service, 'JOBS', {})
    monkeypatch.setattr(service, 'TASKS', {})
    monkeypatch.setattr(service, 'PROJECT_DIR', tmp_path)
    async def generate(request, job_id, progress):
        assert request.prompt == 'Make a model'
        progress('Assembling')
        return {'checked': True}
    monkeypatch.setattr(service, 'generate_model', generate)
    with TestClient(service.app) as client:
        response = client.post('/api/models/generate', json={'prompt':'Make a model','catalog':[source().model_dump()]})
        assert response.status_code == 200
        ident = response.json()['id']
        job = client.get('/api/jobs/'+ident).json()
        assert job['kind'] == 'model'
        assert job['status'] == 'complete' and job['progress'] == 'Assembling'
        assert job['result']['checked']
        assert client.post('/api/models/generate',json={'prompt':'x','catalog':[]}).status_code == 422
    assert not list(tmp_path.iterdir())
