#!/usr/bin/env python3
# SPDX-License-Identifier: Apache-2.0
"""Workshop bookkeeping: agent results, costs, the review verdict, layer features and reports.

    workshop_report.py scope    <agent.json> <scope.json>     scope answer from the scoping agent
    workshop_report.py cost     <agent.json> <cost.json> <label>  add one agent run's spend
    workshop_report.py review   <agent.json> <verdict.json>   exit 1 unless the reviewer approved
    workshop_report.py stage    <report.json> <stage>         where the build is, for the app
    workshop_report.py features <stack-sha>                   the layer's features with their commits
    workshop_report.py notes    <out-folder>                  release and pull-request text
    workshop_report.py summary  <out-folder>                  the cost report for the job summary

The agent JSON is Claude Code's `--output-format json` result. Standard library only.
"""
from __future__ import annotations

import json
import os
import re
import subprocess
import sys
from pathlib import Path


def agent_result(path: str) -> dict:
    try:
        data = json.loads(Path(path).read_text(encoding='utf-8') or '{}')
    except (OSError, ValueError):
        data = {}
    return data if isinstance(data, dict) else {}


def answer_json(text: str) -> dict:
    """The JSON object in an agent's final message (it may be fenced or surrounded by words)."""
    fenced = re.search(r'```(?:json)?\s*(\{.*?\})\s*```', text, re.S)
    candidate = fenced.group(1) if fenced else text[text.find('{'):text.rfind('}') + 1]
    try:
        value = json.loads(candidate)
    except ValueError:
        raise SystemExit('The agent did not answer with a JSON object.')
    if not isinstance(value, dict):
        raise SystemExit('The agent did not answer with a JSON object.')
    return value


def spend(data: dict) -> dict:
    usage = data.get('usage') or {}
    return {'usd': round(float(data.get('total_cost_usd') or 0), 4), 'turns': int(data.get('num_turns') or 0),
            'inputTokens': int(usage.get('input_tokens') or 0), 'outputTokens': int(usage.get('output_tokens') or 0),
            'cacheReadTokens': int(usage.get('cache_read_input_tokens') or 0),
            'cacheWriteTokens': int(usage.get('cache_creation_input_tokens') or 0),
            'outcome': data.get('subtype') or ('error' if data.get('is_error') else 'unknown')}


def scope(agent: str, out: str) -> None:
    data = agent_result(agent)
    answer = answer_json(str(data.get('result') or ''))
    lists = lambda key: [str(x)[:300] for x in answer.get(key, []) if isinstance(x, str)][:10]  # noqa: E731
    result = {
        'buildable': bool(answer.get('buildable')), 'personal': bool(answer.get('personal')),
        'summary': str(answer.get('summary', ''))[:800], 'will': lists('will'), 'wont': lists('wont'),
        'risk': answer.get('risk') if answer.get('risk') in ('low', 'medium', 'high') else 'medium',
        'estimate': answer.get('estimate') if answer.get('estimate') in ('small', 'medium', 'large') else 'medium',
        'reason': str(answer.get('reason', ''))[:600], 'cost': spend(data),
    }
    Path(out).write_text(json.dumps(result, indent=2), encoding='utf-8')


def cost(agent: str, out: str, label: str) -> None:
    path = Path(out)
    report = json.loads(path.read_text(encoding='utf-8')) if path.exists() else {'runs': {}}
    report['runs'][label] = spend(agent_result(agent))
    report['totalUsd'] = round(sum(r['usd'] for r in report['runs'].values()), 4)
    path.write_text(json.dumps(report, indent=2), encoding='utf-8')


def review(agent: str, out: str) -> None:
    verdict = answer_json(str(agent_result(agent).get('result') or ''))
    result = {'approve': verdict.get('approve') is True, 'summary': str(verdict.get('summary', ''))[:800],
              'findings': [f for f in verdict.get('findings', []) if isinstance(f, dict)][:20]}
    Path(out).write_text(json.dumps(result, indent=2), encoding='utf-8')
    if not result['approve']:
        report = Path(out).with_name('report.json')
        report.write_text(json.dumps({'stage': 'review', 'message': 'The security review rejected the change: '
                                      + result['summary']}), encoding='utf-8')
        raise SystemExit('The review did not approve the change.')


def stage(report: str, name: str) -> None:
    Path(report).write_text(json.dumps({'stage': name, 'message': ''}), encoding='utf-8')


def features(stack_sha: str) -> None:
    """The stack's features with their commits on this branch, then the new one (when an agent built it)."""
    env = os.environ
    stack = json.loads(env.get('STACK') or '[]')
    picked = subprocess.run(['git', 'rev-list', '--reverse', f"{env['BASE_SHA']}..{stack_sha}"], check=True,
                            capture_output=True, text=True, encoding='utf-8').stdout.split()
    if len(picked) != len(stack):
        raise SystemExit(f'Expected {len(stack)} feature commits on the branch, found {len(picked)}.')
    out = [dict(item, commit=commit) for item, commit in zip(stack, picked)]
    if env.get('AGENT') == 'true':
        head = subprocess.run(['git', 'rev-parse', 'HEAD'], check=True, capture_output=True, text=True, encoding='utf-8').stdout.strip()
        out.append({'id': env['ID'], 'title': env.get('TITLE') or env['ID'], 'commit': head,
                    'request': env.get('REQUEST', '')[:4000]})
    print(json.dumps(out, indent=2))


def money(value: float) -> str:
    return f'${value:,.2f}'


def notes(folder: str) -> None:
    out = Path(folder)
    layer = json.loads((out/'layer.json').read_text(encoding='utf-8'))
    lines = [f"Personal feature layer **{layer['id']}** for Gradara {layer['base']}, built by the workshop pipeline.", '',
             'Features in this layer:']
    for feature in layer.get('features', []):
        lines.append(f"- **{feature.get('title') or feature['id']}** (`{feature['commit'][:12]}`)")
        if feature.get('request'):
            lines.append('  > ' + feature['request'].replace('\n', '\n  > ')[:1500])
    if (out/'review-verdict.json').exists():
        verdict = json.loads((out/'review-verdict.json').read_text(encoding='utf-8'))
        lines += ['', f"Security review: {'approved' if verdict['approve'] else 'rejected'}. {verdict['summary']}"]
    if (out/'cost.json').exists():
        report = json.loads((out/'cost.json').read_text(encoding='utf-8'))
        lines += ['', f"Model spend: {money(report.get('totalUsd', 0))}."]
    lines += ['', 'Checked: path rules, Core CI, documentation, and loading into the released app\'s service. '
              'Signed with the workshop key. Install it from Settings → Personal features in Gradara '
              f"{layer['base']}. It is personal until the maintainer reviews it; it is not part of Gradara."]
    print('\n'.join(lines))


def summary(folder: str) -> None:
    out = Path(folder)
    lines = ['## Workshop report', '']
    report = json.loads((out/'report.json').read_text(encoding='utf-8')) if (out/'report.json').exists() else {}
    lines.append(f"Stage: **{report.get('stage', 'unknown')}** {report.get('message', '')}")
    if (out/'cost.json').exists():
        cost_report = json.loads((out/'cost.json').read_text(encoding='utf-8'))
        lines += ['', '| Run | Outcome | Turns | Input tokens | Output tokens | Cache read | Cache write | Cost |',
                  '| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: |']
        for label, run in cost_report.get('runs', {}).items():
            lines.append(f"| {label} | {run['outcome']} | {run['turns']} | {run['inputTokens']:,} | {run['outputTokens']:,} | "
                         f"{run['cacheReadTokens']:,} | {run['cacheWriteTokens']:,} | {money(run['usd'])} |")
        lines.append(f"| **Total** | | | | | | | **{money(cost_report.get('totalUsd', 0))}** |")
    else:
        lines += ['', 'No model was used.']
    print('\n'.join(lines))


COMMANDS = {'scope': scope, 'cost': cost, 'review': review, 'stage': stage, 'features': features, 'notes': notes,
            'summary': summary}

if __name__ == '__main__':
    if len(sys.argv) < 2 or sys.argv[1] not in COMMANDS:
        raise SystemExit(__doc__)
    COMMANDS[sys.argv[1]](*sys.argv[2:])
