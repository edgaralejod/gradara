# SPDX-License-Identifier: Apache-2.0
"""Deterministic C code generation: unit extraction, templates, compilation, and SIL verification."""
import asyncio
import json
import shutil
import subprocess
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from server import app as service
from server import engines
from server.codegen import (CodegenError, CodegenOptions, CodegenRequest, archive, generate, parse_outputs, sil_main,
                            verify)
from server.modelica import semantic_hash
from server.models import Project

ROOT = Path(__file__).resolve().parents[1]
gcc = pytest.mark.skipif(shutil.which('gcc') is None, reason='needs a C compiler')


def example(name):
    return Project.model_validate(json.loads((ROOT/'models/examples'/f'{name}.json').read_text(encoding='utf-8')))


def block(ident, kind, ports, params=(), **extra):
    return {'id': ident, 'position': {'x': 0, 'y': 0}, 'definition': {
        'kind': kind, 'name': ident, 'description': '', 'domain': 'signal', 'symbol': '', 'equations': 'y = u;',
        'parameters': [{'id': k, 'name': k, 'value': v} for k, v in params],
        'ports': [{'id': i, 'name': i, 'direction': d, 'domain': 'signal'} for i, d in ports], **extra}}


def wire(ident, a, ah, b, bh):
    return {'id': ident, 'source': a, 'sourceHandle': ah, 'target': b, 'targetHandle': bh}


def chain(*blocks_and_wires):
    blocks = [b for b in blocks_and_wires if 'definition' in b]
    wires = [w for w in blocks_and_wires if 'source' in w]
    return Project.model_validate({'name': 'test', 'revision': 1, 'duration': 1, 'blocks': blocks, 'wires': wires})


def run_c(tmp_path, generated, rows, prefix='controller'):
    """Compile the generated unit with a host program and run it over `rows` of inputs."""
    for name, text in generated.files.items():
        (tmp_path/name).write_text(text, encoding='utf-8')
    (tmp_path/'main.c').write_text(sil_main(prefix, generated.inputs, generated.outputs, len(rows)), encoding='utf-8')
    (tmp_path/'inputs.csv').write_text(''.join(','.join(repr(float(v)) for v in r) + '\n' for r in rows), encoding='utf-8')
    subprocess.run(['gcc', '-std=c11', '-Wall', '-Wextra', '-Werror', '-o', 'sil', f'{prefix}.c', 'main.c', '-lm'],
                   cwd=tmp_path, check=True, capture_output=True, text=True, encoding='utf-8', errors='replace')
    subprocess.run(['./sil'], cwd=tmp_path, check=True)
    return parse_outputs((tmp_path/'outputs.csv').read_text(encoding='utf-8'), len(generated.outputs))


FOC = ['units', 'speedError', 'speedKp', 'speedKi', 'speedIntegral', 'speedSum', 'iqReference', 'qError', 'qPI',
       'dReference', 'dError', 'dPI', 'inverse', 'clarke', 'park']


def test_selection_finds_its_inputs_and_outputs():
    g = generate(example('dc'), [], None, ['controller'], CodegenOptions())
    assert sorted(i['column'] for i in g.inputs) == ['reference.y', 'sensor.y']
    assert [o['column'] for o in g.outputs] == ['controller.y']
    assert g.step == 0.001  # the PI sample period
    assert set(g.files) == {'controller.h', 'controller.c', 'README.md'}
    assert 'controller_step' in g.files['controller.h'] and 'controller_Params' in g.files['controller.h']


def test_generation_is_deterministic():
    a = generate(example('foc'), [], None, FOC, CodegenOptions(step=1e-4))
    b = generate(example('foc'), [], None, list(reversed(FOC)), CodegenOptions(step=1e-4))
    assert a.files == b.files
    assert archive(a) == archive(b)


@gcc
@pytest.mark.parametrize('method', ['forward', 'backward', 'tustin'])
@pytest.mark.parametrize('real', ['double', 'float'])
def test_generated_code_compiles_cleanly(tmp_path, method, real):
    for name, ids, step in [('dc', ['controller'], None), ('servo', ['controller'], None), ('foc', FOC, 1e-4)]:
        g = generate(example(name), [], None, ids, CodegenOptions(method=method, real=real, step=step))
        folder = tmp_path/name
        folder.mkdir()
        run_c(folder, g, [[0.0] * len(g.inputs)] * 3)


@gcc
def test_sampled_pi_matches_its_equations(tmp_path):
    project = example('dc')
    g = generate(project, [], None, ['controller'], CodegenOptions())
    names = [i['column'] for i in g.inputs]
    rows = [[1.0 if c == 'reference.y' else 0.2 * k / 50 for c in names] for k in range(50)]
    out = run_c(tmp_path, g, rows)
    params = {p.id: p.value for p in next(b for b in project.blocks if b.id == 'controller').definition.parameters}
    integral, expected = 0.0, []
    for row in rows:
        error = row[names.index('reference.y')] - row[names.index('sensor.y')]
        integral = max(-params['limit'], min(params['limit'], integral + params['samplePeriod'] * params['ki'] * error))
        expected.append(max(-params['limit'], min(params['limit'], params['kp'] * error + integral)))
    assert [r[0] for r in out] == pytest.approx(expected, rel=1e-12)


@gcc
@pytest.mark.parametrize('method,tolerance', [('forward', 2e-2), ('backward', 2e-2), ('tustin', 1e-9)])
def test_integrator_discretizations(tmp_path, method, tolerance):
    project = chain(block('src', 'constant', [('y', 'output')], [('value', 1)]),
                    block('int', 'integrator', [('u', 'input'), ('y', 'output')], [('limit', 100)]),
                    block('out', 'terminator', [('u', 'input')]),
                    wire('w1', 'src', 'y', 'int', 'u'), wire('w2', 'int', 'y', 'out', 'u'))
    g = generate(project, [], None, ['int'], CodegenOptions(method=method, step=0.01))
    out = run_c(tmp_path, g, [[1.0]] * 100)
    # y(t) = t from y(0) = 0; Tustin integrates a constant exactly.
    assert out[-1][0] == pytest.approx(0.99, rel=tolerance)


@gcc
def test_unit_delay_delays_by_one_sample(tmp_path):
    project = chain(block('src', 'constant', [('y', 'output')], [('value', 1)]),
                    block('z', 'unitDelay', [('u', 'input'), ('y', 'output')], [('Ts', 0.02)]),
                    block('out', 'terminator', [('u', 'input')]),
                    wire('w1', 'src', 'y', 'z', 'u'), wire('w2', 'z', 'y', 'out', 'u'))
    g = generate(project, [], None, ['z'], CodegenOptions(step=0.01))
    out = [r[0] for r in run_c(tmp_path, g, [[k] for k in range(8)])]
    # Samples at steps 0, 2, 4, 6 take the input; the output shows the previous sample and holds.
    assert out == [0, 0, 0, 0, 2, 2, 4, 4]


def test_algebraic_loop_is_reported():
    project = chain(block('a', 'gain', [('u', 'input'), ('y', 'output')], [('k', 0.5)]),
                    block('b', 'gain', [('u', 'input'), ('y', 'output')], [('k', 0.5)]),
                    wire('w1', 'a', 'y', 'b', 'u'), wire('w2', 'b', 'y', 'a', 'u'))
    with pytest.raises(CodegenError, match='algebraic loop') as info:
        generate(project, [], None, ['a', 'b'], CodegenOptions())
    assert sorted(info.value.block_ids) == ['a', 'b']


def test_physical_blocks_are_refused():
    with pytest.raises(CodegenError, match='physical') as info:
        generate(example('dc'), [], None, ['controller', 'drive'], CodegenOptions())
    assert 'drive' in info.value.block_ids


def test_blocks_without_a_template_are_named():
    with pytest.raises(CodegenError, match='no C template') as info:
        generate(example('foc'), [], None, FOC + ['inverter'], CodegenOptions(step=1e-4))
    assert info.value.block_ids == ['inverter']


def test_sample_period_must_fit_the_step():
    with pytest.raises(CodegenError, match='whole number'):
        generate(example('dc'), [], None, ['controller'], CodegenOptions(step=3e-4))


def test_selection_inside_a_subsystem_uses_nested_result_names():
    project = Project.model_validate(json.loads((ROOT/'tests/fixtures/grouped-dc.json').read_text(encoding='utf-8')))
    g = generate(project, ['b_2f80d45f5e'], None, ['controller'], CodegenOptions())
    assert all(i['column'].startswith('b_2f80d45f5e.p_') for i in g.inputs)
    assert [o['column'] for o in g.outputs] == ['b_2f80d45f5e.controller.y']
    with pytest.raises(CodegenError, match='physical'):
        generate(project, [], 'b_2f80d45f5e', [], CodegenOptions())


def controller_subsystem():
    def port(ident, kind, order):
        handle = ('y', 'output') if kind == 'inport' else ('u', 'input')
        b = block(ident, kind, [handle])
        b['definition']['boundary'] = {'order': order}
        b['definition']['equations'] = ''
        return b
    inner = {'id': 'ctl', 'name': 'Controller', 'parameters': [], 'junctions': [], 'nets': [], 'blocks': [
        port('r', 'inport', 0), port('m', 'inport', 1), port('u', 'outport', 0),
        block('err', 'subtract', [('a', 'input'), ('b', 'input'), ('y', 'output')]),
        block('k', 'gain', [('u', 'input'), ('y', 'output')], [('k', 3)])],
        'wires': [wire('i1', 'r', 'y', 'err', 'a'), wire('i2', 'm', 'y', 'err', 'b'),
                  wire('i3', 'err', 'y', 'k', 'u'), wire('i4', 'k', 'y', 'u', 'u')]}
    inner['nets'] = [{'id': f'n{w["id"]}', 'anchor': f'{w["source"]}.{w["sourceHandle"]}', 'wireIds': [w['id']]}
                     for w in inner['wires']]
    instance = block('c1', 'subsystem', [('r', 'input'), ('m', 'input'), ('u', 'output')])
    instance['definition']['subsystem'] = {'ref': 'ctl'}
    instance['definition']['equations'] = ''
    return Project.model_validate({'name': 'test', 'revision': 1, 'duration': 1, 'version': 2, 'subsystems': [inner], 'blocks': [
        block('ref', 'constant', [('y', 'output')], [('value', 1)]),
        block('meas', 'constant', [('y', 'output')], [('value', 0.25)]),
        instance, block('sink', 'terminator', [('u', 'input')])],
        'wires': [wire('w1', 'ref', 'y', 'c1', 'r'), wire('w2', 'meas', 'y', 'c1', 'm'), wire('w3', 'c1', 'u', 'sink', 'u')]})


@gcc
def test_subsystem_instance_is_a_unit(tmp_path):
    g = generate(controller_subsystem(), [], 'c1', [], CodegenOptions(prefix='ctl'))
    assert [(i['label'], i['column']) for i in g.inputs] == [('r', 'ref.y'), ('m', 'meas.y')]
    assert [o['column'] for o in g.outputs] == ['c1.u']
    out = run_c(tmp_path, g, [[1.0, 0.25], [2.0, 0.5]], prefix='ctl')
    assert [r[0] for r in out] == pytest.approx([2.25, 4.5])


def fake_run(tmp_path, project, rows, header):
    folder = tmp_path/'runs'/'run1'
    folder.mkdir(parents=True)
    (folder/'result.json').write_text(json.dumps({'modelHash': semantic_hash(project), 'duration': project.duration}), encoding='utf-8')
    (folder/'simulation_res.csv').write_text(','.join(header) + '\n' + ''.join(','.join(map(repr, r)) + '\n' for r in rows), encoding='utf-8')
    return tmp_path/'runs'


@gcc
def test_verification_replays_the_last_run(tmp_path):
    project = controller_subsystem()
    project.duration = 0.1
    rows = [[k * 0.01, 1.0 + k * 0.01, 0.25, 3 * (0.75 + k * 0.01)] for k in range(11)]
    runs = fake_run(tmp_path, project, rows, ['time', 'ref.y', 'meas.y', 'c1.u'])
    request = CodegenRequest(project=project, instanceId='c1', runId='run1', options=CodegenOptions(step=0.005))
    report = asyncio.run(verify(request, runs, engines.NATIVE.run_c))
    assert report['ok'] and report['steps'] == 21
    assert report['outputs'][0]['maxError'] < 1e-9
    # A wrong recording fails the check instead of passing silently.
    csv_file = runs/'run1'/'simulation_res.csv'
    csv_file.write_text(csv_file.read_text(encoding='utf-8').replace(',2.25\n', ',5.0\n'), encoding='utf-8')
    assert not asyncio.run(verify(request, runs, engines.NATIVE.run_c))['ok']


def test_verification_needs_a_matching_run(tmp_path):
    project = controller_subsystem()
    runs = fake_run(tmp_path, project, [[0, 1, 0.25, 2.25]], ['time', 'ref.y', 'meas.y', 'c1.u'])
    changed = project.model_copy(deep=True)
    changed.blocks[0].definition.parameters[0].value = 2
    with pytest.raises(CodegenError, match='changed since the last run'):
        asyncio.run(verify(CodegenRequest(project=changed, instanceId='c1', runId='run1'), runs, engines.NATIVE.run_c))
    with pytest.raises(CodegenError, match='Run the model first'):
        asyncio.run(verify(CodegenRequest(project=project, instanceId='c1'), runs, engines.NATIVE.run_c))


def test_api_generates_and_reports_problems():
    client = TestClient(service.app, headers={'X-Gradara-Client': 'workbench'})
    body = {'project': example('dc').model_dump(exclude_none=True), 'blockIds': ['controller']}
    data = client.post('/api/codegen', json=body).json()
    assert data['ok'] and 'controller.c' in data['files'] and data['step'] == 0.001
    bad = client.post('/api/codegen', json=body | {'blockIds': ['controller', 'drive']}).json()
    assert not bad['ok'] and bad['blockIds'] == ['drive']
    zipped = client.post('/api/codegen/archive', json=body)
    assert zipped.status_code == 200 and zipped.content[:2] == b'PK'


@pytest.mark.integration
@pytest.mark.parametrize('name,ids,step,path', [
    ('dc', ['controller'], None, []),
    ('servo', ['controller'], None, []),
    ('foc', FOC, 1e-4, []),
    ('grouped-dc', ['controller'], None, ['b_2f80d45f5e']),
])
def test_generated_code_reproduces_the_simulation(name, ids, step, path):
    """Software in the loop: the compiled controller, fed the simulated plant signals, gives the simulated commands."""
    import uuid

    from server.engine import RUNS, simulate
    source = ROOT/'tests/fixtures/grouped-dc.json' if name == 'grouped-dc' else ROOT/'models/examples'/f'{name}.json'
    project = Project.model_validate_json(source.read_text(encoding='utf-8'))
    run_id = 'sil' + uuid.uuid4().hex[:10]
    asyncio.run(simulate(project, run_id))
    request = CodegenRequest(project=project, path=path, blockIds=ids, runId=run_id, options=CodegenOptions(step=step))
    report = asyncio.run(verify(request, RUNS, engines.run_c))
    assert report['ok'], report


@pytest.mark.integration
def test_unit_delay_block_delays_by_one_sample_in_the_simulation():
    """The library's Unit delay outputs the previous sample, and its C matches."""
    import uuid

    from server.engine import RUNS, simulate
    ramp = block('src', 'ramp', [('y', 'output')], [('slope', 1), ('startTime', 0)])
    ramp['definition']['equations'] = 'y = if time < startTime then 0 else slope*(time-startTime);'
    delay = block('z', 'unitDelay', [('u', 'input'), ('y', 'output')], [('Ts', 0.1)])
    delay['definition'] |= {'declarations': 'discrete Real stored(start=0, fixed=true);',
                            'equations': 'when sample(0, Ts) then\n  y = pre(stored);\n  stored = u;\nend when;'}
    sink = block('out', 'terminator', [('u', 'input')])
    sink['definition'] |= {'declarations': 'Real unused;', 'equations': 'unused = u;'}
    project = chain(ramp, delay, sink, wire('w1', 'src', 'y', 'z', 'u'), wire('w2', 'z', 'y', 'out', 'u'))
    run_id = 'ud' + uuid.uuid4().hex[:10]
    result = asyncio.run(simulate(project, run_id))
    series = next(s for s in result['series'] if s['key'] == 'z.y')
    at = lambda t: series['values'][max(i for i, x in enumerate(result['time']) if x <= t + 1e-9)]
    assert at(0.55) == pytest.approx(0.4) and at(0.95) == pytest.approx(0.8)
    report = asyncio.run(verify(CodegenRequest(project=project, blockIds=['z'], runId=run_id), RUNS, engines.run_c))
    assert report['ok'], report
