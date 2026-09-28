# SPDX-License-Identifier: Apache-2.0
"""C templates for custom blocks: validation, use in code generation, and the AI job with a fake provider."""
import asyncio
import shutil
import subprocess

import pytest

from server import ctemplate
from server.codegen import CodegenError, CodegenOptions, generate
from server.ctemplate import TemplateError, check, signature, write_template
from server.models import CTemplate, Definition

LAG = Definition.model_validate({
    'kind': 'customLag', 'name': 'Custom lag', 'description': '', 'domain': 'signal', 'symbol': 'lag',
    'generated': True, 'declarations': 'Real x(start=0, fixed=true);',
    'equations': 'der(x) = (u - x)/tau;\ny = k*x;',
    'parameters': [{'id': 'tau', 'name': 'Time constant', 'value': 0.1}, {'id': 'k', 'name': 'Gain', 'value': 2}],
    'ports': [{'id': 'u', 'name': 'u', 'direction': 'input', 'domain': 'signal'},
              {'id': 'y', 'name': 'y', 'direction': 'output', 'domain': 'signal'}]})

GOOD = {'state': [{'name': 'x', 'type': 'real', 'init': 0}],
        'output': ['{y.y} = {p.k} * {x.x};'],
        'update': ['{x.x} = {x.x} + {h} * ({u.u} - {x.x}) / {p.tau};'],
        'feedthrough': False, 'notes': 'Forward Euler.'}


def template(data=GOOD):
    return CTemplate.model_validate(data | {'signature': signature(LAG)})


def test_a_numeric_template_passes():
    check(LAG, template())


@pytest.mark.parametrize('line, message', [
    ('{y.y} = system("rm");', 'not allowed'),
    ('{y.y} = {u.u}; {x.x} = 1;', 'not allowed|Unexpected'),
    ('{y.z} = 1;', 'not an output'),
    ('{y.y} = {p.nope};', 'not part'),
    ('int a = 1;', 'Each statement'),
    ('{y.y} = (1;', 'Unbalanced'),
    ('{y.y} = printf(1);', 'not allowed'),
    ('{y.y} = 1 //{u.u};', 'Comments'),
    ('{y.y} = 1 /* {u.u};', 'Comments'),
    ('{y.y} = 1 * / 2;', 'Comments'),
])
def test_anything_but_arithmetic_is_refused(line, message):
    with pytest.raises(TemplateError, match=message):
        check(LAG, template(GOOD | {'output': [line]}))


def test_outputs_must_be_set_in_the_output_phase():
    with pytest.raises(TemplateError, match='never sets'):
        check(LAG, template(GOOD | {'output': []}))


def project(definition):
    return ctemplate._probe(definition)


@pytest.mark.skipif(shutil.which('gcc') is None, reason='needs a C compiler')
def test_code_generation_uses_a_matching_template(tmp_path):
    g = generate(project(LAG.model_copy(update={'ctemplate': template()})), [], None, ['block'], CodegenOptions(step=0.01))
    assert 'Forward Euler' in ' '.join(g.notes)
    for name, text in g.files.items():
        (tmp_path/name).write_text(text, encoding='utf-8')
    subprocess.run(['gcc', '-std=c11', '-Wall', '-Wextra', '-Werror', '-c', 'controller.c'], cwd=tmp_path, check=True)


def test_a_stale_template_is_ignored():
    changed = LAG.model_copy(update={'ctemplate': template(), 'equations': 'der(x) = (u - x)/tau;\ny = x;'})
    with pytest.raises(CodegenError, match='no C template'):
        generate(project(changed), [], None, ['block'], CodegenOptions())


@pytest.mark.skipif(shutil.which('gcc') is None, reason='needs a C compiler')
def test_the_ai_job_retries_once_with_the_reason(monkeypatch, tmp_path):
    from server import agent, engines, paths
    prompts = []

    async def provider(prompt, schema, job_id, task):
        prompts.append(prompt)
        assert task == 'export' and schema is ctemplate.TEMPLATE_SCHEMA
        return GOOD | {'output': ['{y.y} = fopen(1);']} if len(prompts) == 1 else GOOD

    async def compile_c(folder, source):
        run = subprocess.run(['gcc', '-std=c11', '-Wall', '-Wextra', '-Werror', '-c', source], cwd=folder,
                             capture_output=True, text=True, encoding='utf-8', errors='replace')
        return run.returncode, run.stdout + run.stderr
    monkeypatch.setattr(agent, 'structured_generation', provider)
    monkeypatch.setattr(engines, 'compile_c', compile_c)
    monkeypatch.setattr(paths, 'EXPORTS', tmp_path)
    result = asyncio.run(write_template(LAG, 'job1'))
    assert result['ctemplate']['signature'] == signature(LAG)
    assert 'fopen is not allowed' in prompts[1]
