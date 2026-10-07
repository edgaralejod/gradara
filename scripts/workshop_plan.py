#!/usr/bin/env python3
# SPDX-License-Identifier: Apache-2.0
"""Workshop: decide what to build (docs/architecture/LAYERS.md). Prints `builds=<json>` for GITHUB_OUTPUT.

A dispatched build or rebuild is one item. A published release rebuilds every
layer of the previous release on the new one, without an agent: a clean
rebuild costs nobody anything; one that does not apply is reported as needing
a port. Inputs come from the environment the workflow sets.
"""
from __future__ import annotations

import json
import os
import re
import subprocess
import sys

LAYER_ID = re.compile(r'^f-[a-z0-9][a-z0-9-]{2,60}$')
TAG = re.compile(r'^v\d+\.\d+\.\d+$')
LAYER_TAG = re.compile(r'^layer-(f-[a-z0-9][a-z0-9-]{2,60})-(v\d+\.\d+\.\d+)$')
COMMIT = re.compile(r'^[0-9a-f]{40}$')


def gh(*args: str) -> str:
    return subprocess.run(['gh', *args], check=True, capture_output=True, text=True, encoding='utf-8').stdout


def fail(message: str) -> None:
    print(f'::error::{message}', file=sys.stderr)
    sys.exit(1)


def version(tag: str) -> tuple[int, ...]:
    return tuple(int(p) for p in tag.lstrip('v').split('.'))


def stack_from(raw: str) -> list[dict]:
    try:
        items = json.loads(raw or '[]')
    except ValueError:
        fail('The stack is not valid JSON.')
    if not isinstance(items, list) or len(items) > 20:
        fail('The stack must be a list of at most 20 features.')
    out = []
    for item in items:
        if not (isinstance(item, dict) and LAYER_ID.match(str(item.get('id', ''))) and COMMIT.match(str(item.get('commit', '')))):
            fail(f'A stack entry is malformed: {item!r}')
        out.append({'id': item['id'], 'title': str(item.get('title', ''))[:120], 'commit': item['commit'],
                    'request': str(item.get('request', ''))[:4000]})
    return out


def latest_release(repo: str) -> str:
    return json.loads(gh('release', 'view', '--repo', repo, '--json', 'tagName'))['tagName']


def releases(repo: str) -> list[dict]:
    pages = gh('api', f'repos/{repo}/releases?per_page=100', '--paginate', '--jq', '.[] | {tag_name, prerelease, draft}')
    return [json.loads(line) for line in pages.splitlines() if line.strip()]


def ports(repo: str, new_tag: str) -> list[dict]:
    """Every layer whose newest build is for an older release, rebuilt on `new_tag`."""
    newest: dict[str, str] = {}
    for release in releases(repo):
        match = LAYER_TAG.match(release['tag_name'])
        if match and not release['draft']:
            layer, base = match.groups()
            if layer not in newest or version(base) > version(newest[layer]):
                newest[layer] = base
    items = []
    for layer, base in sorted(newest.items()):
        if version(base) >= version(new_tag):
            continue
        manifest = json.loads(gh('release', 'download', f'layer-{layer}-{base}', '--repo', repo, '--pattern', 'layer.json',
                                 '--output', '-'))
        items.append({'id': layer, 'base': new_tag, 'agent': False, 'request': '', 'budget': '0',
                      'title': (manifest.get('features') or [{}])[-1].get('title', layer),
                      'stack': stack_from(json.dumps(manifest.get('features', [])))})
    return items


def main() -> None:
    env = os.environ
    repo = env['GITHUB_REPOSITORY']
    if env.get('EVENT') == 'release':
        tag = env.get('RELEASE_TAG', '')
        builds = [] if env.get('PRERELEASE') == 'true' or not TAG.match(tag) else ports(repo, tag)
    else:
        mode = env.get('MODE', '')
        layer = env.get('REQUEST_ID', '')
        if not LAYER_ID.match(layer):
            fail('The layer ID must look like f-speed-plot (lowercase letters, digits and dashes).')
        base = env.get('BASE') or latest_release(repo)
        if not TAG.match(base):
            fail(f'{base} is not a release tag.')
        stack = stack_from(env.get('STACK', '[]'))
        if mode == 'build':
            request = env.get('REQUEST', '').strip()
            if len(request) < 10:
                fail('The request is too short to build from.')
            try:
                budget = float(env.get('BUDGET') or '5')
            except ValueError:
                fail('The budget must be a number of US dollars.')
            if not 0.5 <= budget <= 50:
                fail('The budget must be between 0.50 and 50 US dollars.')
            builds = [{'id': layer, 'base': base, 'agent': True, 'request': request[:8000],
                       'title': (env.get('TITLE') or request.splitlines()[0])[:120], 'budget': f'{budget:.2f}', 'stack': stack}]
        elif mode == 'rebuild':
            if not stack:
                fail('A rebuild needs the features to keep.')
            builds = [{'id': layer, 'base': base, 'agent': False, 'request': '', 'budget': '0',
                       'title': env.get('TITLE') or stack[-1]['title'], 'stack': stack}]
        else:
            fail(f'Unknown mode {mode}.')
    print('builds=' + json.dumps(builds, separators=(',', ':')))


if __name__ == '__main__':
    main()
