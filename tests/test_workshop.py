# SPDX-License-Identifier: Apache-2.0
"""Workshop pipeline scripts: path rules, planning, agent bookkeeping and reports."""
import importlib.util
import json
import subprocess
import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).parents[1]


def load(name):
    spec = importlib.util.spec_from_file_location(name, ROOT/'scripts'/f'{name}.py')
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


paths = load('workshop_paths')
plan = load('workshop_plan')
report = load('workshop_report')


@pytest.mark.parametrize('path, verdict', [
    ('components/gradara/data-inspector.tsx', 'allowed'),
    ('server/results_agent.py', 'allowed'),
    ('docs/USER_GUIDE.md', 'allowed'),
    ('tests/test_new.py', 'allowed'),
    ('server/credentials.py', 'forbidden'),
    ('server/llm/dispatch.py', 'forbidden'),
    ('server/requirements.txt', 'forbidden'),
    ('desktop/main.cjs', 'forbidden'),
    ('packaging/backend_entry.py', 'forbidden'),
    ('.github/workflows/workshop.yml', 'forbidden'),
    ('cloud/gateway/app.py', 'forbidden'),
    ('package.json', 'forbidden'),
    ('docs/PRIVACY.md', 'forbidden'),
    ('scripts/workshop_paths.py', 'forbidden'),
    ('random-top-level.txt', 'forbidden'),
])
def test_path_rules(path, verdict):
    assert paths.verdict(path) == verdict


def run_plan(monkeypatch, capsys, **env):
    monkeypatch.setenv('GITHUB_REPOSITORY', 'owner/repo')
    for key, value in env.items():
        monkeypatch.setenv(key, value)
    plan.main()
    out = capsys.readouterr().out.strip()
    assert out.startswith('builds=')
    return json.loads(out[len('builds='):])


COMMIT = 'a' * 40


def test_a_build_is_one_agent_item(monkeypatch, capsys):
    builds = run_plan(monkeypatch, capsys, EVENT='workflow_dispatch', MODE='build', REQUEST_ID='f-speed-plot',
                      REQUEST='Add a plot of the motor speed error\nwith a band', TITLE='', BASE='v0.7.0', BUDGET='7.5',
                      STACK=json.dumps([{'id': 'f-earlier', 'title': 'Earlier', 'commit': COMMIT}]))
    assert builds == [{'id': 'f-speed-plot', 'base': 'v0.7.0', 'agent': True,
                       'request': 'Add a plot of the motor speed error\nwith a band',
                       'title': 'Add a plot of the motor speed error', 'budget': '7.50',
                       'stack': [{'id': 'f-earlier', 'title': 'Earlier', 'commit': COMMIT, 'request': ''}]}]


@pytest.mark.parametrize('env, message', [
    ({'MODE': 'build', 'REQUEST_ID': 'Bad ID', 'REQUEST': 'x' * 20}, 'layer ID'),
    ({'MODE': 'build', 'REQUEST_ID': 'f-ok-id', 'REQUEST': 'short'}, 'too short'),
    ({'MODE': 'build', 'REQUEST_ID': 'f-ok-id', 'REQUEST': 'x' * 20, 'BUDGET': '500'}, 'between'),
    ({'MODE': 'rebuild', 'REQUEST_ID': 'f-ok-id', 'STACK': '[]'}, 'features to keep'),
    ({'MODE': 'build', 'REQUEST_ID': 'f-ok-id', 'REQUEST': 'x' * 20, 'STACK': '[{"id": "f-x", "commit": "nope"}]'}, 'malformed'),
    ({'MODE': 'build', 'REQUEST_ID': 'f-ok-id', 'REQUEST': 'x' * 20, 'BASE': 'main'}, 'not a release tag'),
])
def test_bad_dispatches_are_refused(monkeypatch, capsys, env, message):
    with pytest.raises(SystemExit):
        run_plan(monkeypatch, capsys, EVENT='workflow_dispatch', BASE=env.pop('BASE', 'v0.7.0'), **env)
    assert message in capsys.readouterr().err


def test_a_release_rebuilds_older_layers_without_an_agent(monkeypatch, capsys):
    listing = '\n'.join(json.dumps(r) for r in [
        {'tag_name': 'v0.7.1', 'prerelease': False, 'draft': False},
        {'tag_name': 'layer-f-speed-plot-v0.7.0', 'prerelease': True, 'draft': False},
        {'tag_name': 'layer-f-speed-plot-v0.6.9', 'prerelease': True, 'draft': False},
        {'tag_name': 'layer-f-current-v0.7.1', 'prerelease': True, 'draft': False},
    ])
    manifest = {'features': [{'id': 'f-speed-plot', 'title': 'Speed plot', 'commit': COMMIT}]}

    def gh(*args):
        if args[0] == 'api':
            return listing
        assert args[:3] == ('release', 'download', 'layer-f-speed-plot-v0.7.0')
        return json.dumps(manifest)
    monkeypatch.setattr(plan, 'gh', gh)
    builds = run_plan(monkeypatch, capsys, EVENT='release', RELEASE_TAG='v0.7.1', PRERELEASE='false')
    assert [(b['id'], b['base'], b['agent']) for b in builds] == [('f-speed-plot', 'v0.7.1', False)]
    assert run_plan(monkeypatch, capsys, EVENT='release', RELEASE_TAG='layer-f-x-v0.7.1', PRERELEASE='true') == []


def agent_file(tmp_path, result, cost=0.42, subtype='success'):
    path = tmp_path/'agent.json'
    path.write_text(json.dumps({'type': 'result', 'subtype': subtype, 'result': result, 'total_cost_usd': cost,
                                'num_turns': 7, 'usage': {'input_tokens': 1000, 'output_tokens': 200,
                                                          'cache_read_input_tokens': 5000}}), encoding='utf-8')
    return str(path)


def test_scope_answer_is_parsed_and_bounded(tmp_path):
    agent = agent_file(tmp_path, 'Here you go:\n```json\n{"buildable": true, "personal": true, "summary": "Adds a plot.",'
                                 ' "will": ["A plot"], "wont": ["Hydraulics"], "risk": "low", "estimate": "small", "reason": ""}\n```')
    report.scope(agent, str(tmp_path/'scope.json'))
    scope = json.loads((tmp_path/'scope.json').read_text(encoding='utf-8'))
    assert scope['buildable'] and scope['personal'] and scope['will'] == ['A plot'] and scope['cost']['usd'] == 0.42
    with pytest.raises(SystemExit):
        report.scope(agent_file(tmp_path, 'no json here'), str(tmp_path/'bad.json'))


def test_costs_add_up_and_a_rejected_review_fails(tmp_path):
    out = str(tmp_path/'cost.json')
    report.cost(agent_file(tmp_path, '', cost=3.1), out, 'build')
    report.cost(agent_file(tmp_path, '', cost=0.4), out, 'review')
    totals = json.loads(Path(out).read_text(encoding='utf-8'))
    assert totals['totalUsd'] == 3.5 and totals['runs']['build']['turns'] == 7
    approved = agent_file(tmp_path, '{"approve": true, "summary": "Fine.", "findings": []}')
    report.review(approved, str(tmp_path/'verdict.json'))
    rejected = agent_file(tmp_path, '{"approve": false, "summary": "Adds a network call.", "findings": [{"file": "x"}]}')
    with pytest.raises(SystemExit):
        report.review(rejected, str(tmp_path/'verdict.json'))
    assert 'network call' in json.loads((tmp_path/'report.json').read_text(encoding='utf-8'))['message']


def test_features_follow_the_branch(tmp_path, monkeypatch, capsys):
    def git(*args):
        return subprocess.run(['git', *args], cwd=tmp_path, check=True, capture_output=True, text=True, encoding='utf-8').stdout.strip()
    git('init', '-q')
    git('-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-q', '--allow-empty', '-m', 'base')
    base = git('rev-parse', 'HEAD')
    git('-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-q', '--allow-empty', '-m', 'earlier feature')
    stack_sha = git('rev-parse', 'HEAD')
    git('-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-q', '--allow-empty', '-m', 'new feature')
    monkeypatch.chdir(tmp_path)
    monkeypatch.setenv('STACK', json.dumps([{'id': 'f-earlier', 'title': 'Earlier', 'commit': COMMIT}]))
    monkeypatch.setenv('BASE_SHA', base)
    monkeypatch.setenv('AGENT', 'true')
    monkeypatch.setenv('ID', 'f-new')
    monkeypatch.setenv('TITLE', 'New')
    report.features(stack_sha)
    features = json.loads(capsys.readouterr().out)
    assert [f['id'] for f in features] == ['f-earlier', 'f-new']
    assert features[0]['commit'] == stack_sha and features[1]['commit'] == git('rev-parse', 'HEAD')


def test_notes_and_summary(tmp_path, capsys):
    (tmp_path/'layer.json').write_text(json.dumps({'id': 'f-new', 'base': '0.7.0', 'features': [
        {'id': 'f-new', 'title': 'New', 'commit': COMMIT, 'request': 'Do the thing'}]}), encoding='utf-8')
    (tmp_path/'cost.json').write_text(json.dumps({'runs': {'build': report.spend({'total_cost_usd': 2})}, 'totalUsd': 2}), encoding='utf-8')
    (tmp_path/'report.json').write_text(json.dumps({'stage': 'published', 'message': 'layer-f-new-v0.7.0'}), encoding='utf-8')
    report.notes(str(tmp_path))
    notes = capsys.readouterr().out
    assert 'f-new' in notes and 'Do the thing' in notes and '$2.00' in notes and 'Personal features' in notes
    report.summary(str(tmp_path))
    assert '| **Total** |' in capsys.readouterr().out


def test_the_workflow_never_interpolates_requests_into_scripts():
    """Requests are untrusted text: they reach shell steps only through environment variables."""
    workflow = (ROOT/'.github'/'workflows'/'workshop.yml').read_text(encoding='utf-8')
    import re
    untrusted = re.compile(r'(inputs|matrix\.item)\.(request|title)\b(?!_)')
    for line in workflow.splitlines():
        if '${{' in line and untrusted.search(line):
            assert line.strip().split(':')[0].isupper(), f'interpolated outside env: {line.strip()}'


def test_layer_build_script_round_trip(tmp_path):
    """The pipeline's build script packs what the shell's checks accept."""
    if not (ROOT/'dist-desktop'/'web'/'index.html').exists():
        pytest.skip('needs `npm run desktop:web`')
    features = tmp_path/'features.json'
    features.write_text(json.dumps([{'id': 'f-test', 'title': 'Test', 'commit': COMMIT}]), encoding='utf-8')
    subprocess.run(['node', 'scripts/build-layer.cjs', 'build', '--id', 'f-test', '--base', '9.9.9', '--features', str(features),
                    '--out', str(tmp_path)], cwd=ROOT, check=True, capture_output=True)
    layer = json.loads((tmp_path/'layer.json').read_text(encoding='utf-8'))
    assert layer['id'] == 'f-test' and layer['base'] == '9.9.9' and 'files' not in layer
    subprocess.run(['node', 'scripts/build-layer.cjs', 'unpack', str(tmp_path/'gradara-layer-9.9.9-f-test.tar.gz'),
                    str(tmp_path/'unpacked')], cwd=ROOT, check=True, capture_output=True)
    assert (tmp_path/'unpacked'/'server'/'app.py').exists() and (tmp_path/'unpacked'/'web'/'index.html').exists()
    assert not list((tmp_path/'unpacked').rglob('__pycache__'))


if __name__ == '__main__':
    sys.exit(pytest.main([__file__]))
