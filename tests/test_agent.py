"""Selected block types are executable connector contracts, not visual labels."""
import asyncio
import csv
import json
from pathlib import Path
from unittest.mock import AsyncMock
import uuid
import pytest
from server import agent
from server.models import Definition, Project
from server.modelica import component_source
from server.engine import RUNS, check_component, simulate


def transformer():
    return Definition(kind='idealTransformer', name='Transformer', description='Ideal lossless transformer',
        domain='electrical', symbol='N:1', generated=True,
        ports=[dict(id=p, name=p, direction='physical', domain='electrical', side='left' if p.endswith('1') else 'right') for p in ['p1','n1','p2','n2']],
        parameters=[dict(id='ratio', name='Turns ratio', value=2)],
        equations='p1.v-n1.v = ratio*(p2.v-n2.v); p1.i+n1.i=0; p2.i+n2.i=0; ratio*p1.i+p2.i=0;')


def test_wrong_type_is_repaired_before_compiler(monkeypatch):
    good = transformer().model_dump()
    bad = {**good, 'domain':'signal', 'ports':[dict(id='y',name='y',direction='output',domain='signal')], 'equations':'y=1;'}
    provider = AsyncMock(side_effect=[bad, good])
    compiler = AsyncMock()
    monkeypatch.setattr(agent, 'structured_generation', provider)
    monkeypatch.setattr(agent, 'check_component', compiler)
    monkeypatch.setattr(agent, 'save_component', lambda *args: {'id':'test-library'})
    result = asyncio.run(agent.generate_component('ideal transformer', None, 'test', 'electrical'))
    assert result['blockType'] == 'electrical'
    assert compiler.await_count == 1
    assert len(result['definition']['ports']) == 4
    for call in provider.call_args_list:
        assert call.args[1]['properties']['domain']['enum'] == ['electrical']
        assert 'SELECTED BLOCK TYPE' in call.args[0]
    assert agent.BLOCK_SCHEMA['properties']['ports']['items']['properties']['domain']['enum'] == ['signal']


def test_refinement_preserves_connected_interface():
    original = transformer()
    changed = transformer()
    changed.ports.pop()
    with pytest.raises(ValueError, match='preserve terminal'):
        agent.validate_generated_type(changed, 'electrical', original)
    with pytest.raises(ValueError, match='requires thermal'):
        agent.validate_generated_type(original, 'thermal')
    changed = transformer()
    changed.ports[0].direction = 'input'
    with pytest.raises(ValueError, match='input/output'):
        agent.validate_generated_type(changed, 'electrical')


@pytest.mark.parametrize('domain,connector,fields', [
    ('electrical','Modelica.Electrical.Analog.Interfaces.Pin', ('v','i')),
    ('mechanical','Modelica.Mechanics.Rotational.Interfaces.Flange_a', ('phi','tau')),
    ('thermal','Modelica.Thermal.HeatTransfer.Interfaces.HeatPort_a', ('T','Q_flow')),
])
def test_physical_wrappers(domain, connector, fields):
    d = transformer()
    d.domain = domain
    d.ports = d.ports[:2]
    for p in d.ports: p.domain = domain
    potential, flow = fields
    d.equations = f'p1.{potential}=n1.{potential}; p1.{flow}+n1.{flow}=0;'
    agent.validate_generated_type(d, domain)
    source = component_source(d, 'Component')
    assert source.startswith('model Component')
    assert f'{connector} p1;' in source
    assert 'RealInput' not in source


@pytest.mark.integration
def test_generated_transformer_runs_in_real_circuit():
    async def run():
        d = transformer()
        await check_component(d, 'transformercheck'+uuid.uuid4().hex[:10])
        raw = json.loads((Path(__file__).parents[1]/'models/examples/buck.json').read_text())
        defs = {b['definition']['kind']:b['definition'] for b in raw['blocks']}
        blocks = []
        for ident, definition in [('source', defs['dcSource']), ('transformer', d.model_dump()), ('load', defs['resistor']), ('primaryGround', defs['ground']), ('secondaryGround', defs['ground'])]:
            blocks.append(dict(id=ident, definition=definition, position=dict(x=0,y=0)))
        pairs = [('source','p','transformer','p1'), ('source','n','primaryGround','p'), ('transformer','n1','primaryGround','p'), ('transformer','p2','load','p'), ('load','n','secondaryGround','p'), ('transformer','n2','secondaryGround','p')]
        project = Project(name='Generated transformer test', duration=.02, revision=0, blocks=blocks,
            wires=[dict(id=f'w{i}',source=a,sourceHandle=b,target=c,targetHandle=e) for i,(a,b,c,e) in enumerate(pairs)])
        result = await simulate(project, 'transformer'+uuid.uuid4().hex[:10])
        with (RUNS/result['id']/'simulation_res.csv').open() as stream:
            row = list(csv.DictReader(stream))[-1]
        # OpenModelica folds the ideal source voltage into a parameter.
        v1 = next(p.value for p in project.blocks[0].definition.parameters if p.id == 'V')
        v2 = float(row['transformer.p2.v'])-float(row['transformer.n2.v'])
        i1, i2 = float(row['transformer.p1.i']), float(row['transformer.p2.i'])
        assert v1 == pytest.approx(24)
        assert v2 == pytest.approx(12)
        assert abs(i2) > .1
        assert i2 == pytest.approx(-2*i1)
        assert v1*i1 + v2*i2 == pytest.approx(0, abs=1e-8)
    asyncio.run(run())


def test_repeated_type_violation_never_reaches_compiler(monkeypatch):
    wrong = transformer().model_dump()
    provider = AsyncMock(return_value=wrong)
    compiler = AsyncMock()
    monkeypatch.setattr(agent, 'structured_generation', provider)
    monkeypatch.setattr(agent, 'check_component', compiler)
    monkeypatch.setattr(agent, 'save_component', lambda *args: {'id':'test-library'})
    with pytest.raises(RuntimeError, match='requires thermal'):
        asyncio.run(agent.generate_component('heat resistor', None, 'test', 'thermal'))
    assert provider.await_count == 2
    compiler.assert_not_awaited()


def test_multidomain_and_optional_signal_contract():
    d = transformer()
    from server.models import Port
    d.ports.append(Port(id='y',name='V',direction='output',domain='signal'))
    agent.validate_generated_type(d, 'electrical')
    assert agent.infer_block_type(d) == 'electrical'
    with pytest.raises(ValueError, match='at least two'):
        agent.validate_generated_type(d, 'multidomain')
    d.ports.append(Port(id='heat',name='heat',direction='physical',domain='thermal'))
    agent.validate_generated_type(d, 'multidomain')
    assert agent.infer_block_type(d) == 'multidomain'
    with pytest.raises(ValueError, match='requires electrical'):
        agent.validate_generated_type(d, 'electrical')


def test_legacy_request_defaults_and_refinement_type_lock(monkeypatch):
    from server.models import GenerateRequest
    assert GenerateRequest(prompt='low-pass filter').blockType is None
    assert agent.infer_block_type(None) == 'signal'
    provider = AsyncMock()
    monkeypatch.setattr(agent, 'structured_generation', provider)
    with pytest.raises(ValueError, match='cannot change'):
        asyncio.run(agent.generate_component('change it', transformer(), 'test', 'signal'))
    provider.assert_not_awaited()
