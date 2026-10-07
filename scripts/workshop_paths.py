#!/usr/bin/env python3
# SPDX-License-Identifier: Apache-2.0
"""Workshop gate: which files a personal feature may change (docs/architecture/LAYERS.md).

    python3 scripts/workshop_paths.py <base-ref> [<head-ref>]

Exits 1 and lists the offending paths when a change touches anything a layer
cannot carry: the shell, packaging, CI, the cloud service, the website,
dependency manifests, credential and safety modules, or license and privacy
files. Those changes can only ship in a release, through a pull request.
"""
from __future__ import annotations

import fnmatch
import json
import subprocess
import sys

ALLOWED = ['app/*', 'components/*', 'lib/*', 'server/*', 'models/examples/*', 'docs/*', 'tests/*',
           'scripts/*', 'public/*', 'ROADMAP.md', 'README.md']
# Checked first: these win over ALLOWED.
FORBIDDEN = [
    # Credentials, safety and the workshop's own client.
    'server/credentials.py', 'server/workshop.py', 'server/safety.py', 'server/processes.py', 'server/paths.py',
    'server/llm/*', 'server/requirements*.txt',
    # The pipeline's own rules and tools: the branch never runs a changed copy of them.
    'scripts/workshop_*', 'scripts/build-layer.cjs', 'scripts/check-*',
    # Shell, packaging, CI, cloud, website, build configuration and dependencies.
    'desktop/*', 'packaging/*', '.github/*', 'cloud/*', 'site/*', 'patches/*', 'vite*.ts', 'tsconfig.json',
    'package.json', 'package-lock.json',
    # Legal and promise documents.
    'LICENSE', 'LICENSES/*', 'NOTICE', 'SECURITY.md', 'THIRD_PARTY_NOTICES.md', 'docs/PRIVACY.md',
]


def verdict(path: str) -> str:
    if any(fnmatch.fnmatchcase(path, rule) for rule in FORBIDDEN):
        return 'forbidden'
    if any(fnmatch.fnmatchcase(path, rule) for rule in ALLOWED):
        return 'allowed'
    return 'forbidden'


def changed(base: str, head: str) -> list[str]:
    out = subprocess.run(['git', 'diff', '--name-only', '--no-renames', f'{base}..{head}'], check=True,
                         capture_output=True, text=True, encoding='utf-8').stdout
    return [line for line in out.splitlines() if line]


def main() -> None:
    base = sys.argv[1]
    head = sys.argv[2] if len(sys.argv) > 2 else 'HEAD'
    paths = changed(base, head)
    refused = [p for p in paths if verdict(p) == 'forbidden']
    print(json.dumps({'changed': paths, 'refused': refused}, indent=2))
    if not paths:
        print('The change is empty.', file=sys.stderr)
        sys.exit(1)
    if refused:
        print('A personal feature cannot change: ' + ', '.join(refused), file=sys.stderr)
        sys.exit(1)


if __name__ == '__main__':
    main()
