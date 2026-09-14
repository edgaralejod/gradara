#!/usr/bin/env python3
"""Limited release hygiene checks. Reports locations, never suspected values."""
import argparse
import json
from pathlib import Path, PurePosixPath
import re
import subprocess
import sys
from urllib.parse import urlsplit

ROOT = Path(__file__).resolve().parent.parent
PRIVATE_DIRS = {'projects', '.runtime', '.venv', 'node_modules', 'outputs', 'work', '.wrangler'}
PATTERNS = {
    'private key': re.compile(r'-----BEGIN (?:RSA |EC |DSA |OPENSSH |ENCRYPTED )?PRIVATE KEY-----'),
    'provider token': re.compile(r'\b(?:sk-(?:proj-|svcacct-)?[A-Za-z0-9_-]{32,}|gh[pousr]_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{40,})\b'),
    'AWS access key': re.compile(r'\b(?:AKIA|ASIA)[A-Z0-9]{16}\b'),
    'private home path': re.compile(r'(?:/Users/|/home/)[A-Za-z0-9_.-]+/|[A-Za-z]:\\Users\\[A-Za-z0-9_.-]+\\'),
}


def git(*args):
    return subprocess.check_output(['git', *args], cwd=ROOT)


def forbidden(name):
    path = PurePosixPath(name)
    return (
        path.parts[0] in PRIVATE_DIRS
        or (path.name.startswith('.env') and path.name != '.env.example')
        or path.name in {'auth.json', '.npmrc', '.pypirc', '.DS_Store'}
        or path.suffix.lower() in {'.pem', '.key', '.p12', '.pfx'}
    )


def inspect_text(name, data, problems):
    if b'\0' in data:
        return
    text = data.decode('utf-8', errors='replace')
    for label, pattern in PATTERNS.items():
        for match in pattern.finditer(text):
            line = text.count('\n', 0, match.start()) + 1
            problems.add(f'{name}:{line}: possible {label}; review locally')


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--history', action='store_true', help='also inspect all reachable Git blobs and paths')
    parser.add_argument('--release', action='store_true', help='also require an original-code license and package metadata')
    args = parser.parse_args()
    problems = set()
    names = set(git('ls-files', '--cached', '--others', '--exclude-standard', '-z').decode().split('\0')) - {''}
    for name in names:
        path = ROOT / name
        if not path.exists():  # Deleted working-tree paths are not part of the proposed source payload.
            continue
        if forbidden(name):
            problems.add(f'{name}: local/private artifact is a repository candidate')
        if path.is_symlink():
            problems.add(f'{name}: review symlink target before distributing')
        elif path.is_file():
            inspect_text(name, path.read_bytes(), problems)

    lock = json.loads((ROOT / 'package-lock.json').read_text())
    for name, package in lock.get('packages', {}).items():
        resolved = package.get('resolved', '')
        if resolved:
            url = urlsplit(resolved)
            if url.username or url.password or url.scheme != 'https' or url.hostname != 'registry.npmjs.org':
                problems.add(f'package-lock.json: review non-public-registry resolution for {name}')

    blobs = set()
    if args.history:
        for revision in git('rev-list', '--all').decode().splitlines():
            for entry in git('ls-tree', '-r', '-z', revision).split(b'\0'):
                if not entry:
                    continue
                metadata, raw_name = entry.split(b'\t', 1)
                _mode, kind, oid = metadata.decode().split()
                name = raw_name.decode()
                if forbidden(name):
                    problems.add(f'history {revision[:8]}:{name}: local/private artifact')
                if kind == 'blob' and oid not in blobs:
                    blobs.add(oid)
                    inspect_text(f'history {revision[:8]}:{name}', git('cat-file', 'blob', oid), problems)

    if args.release:
        package = json.loads((ROOT / 'package.json').read_text())
        if package.get('license') not in {'Apache-2.0', 'MIT', 'AGPL-3.0-only', 'AGPL-3.0-or-later'}:
            problems.add('package.json: original-code license selection/metadata is pending')
        license_path = ROOT / 'LICENSE'
        if not license_path.is_file() or license_path.stat().st_size < 500:
            problems.add('LICENSE: complete original-code license text is missing')

    for problem in sorted(problems):
        print(problem, file=sys.stderr)
    print(f'Checked {len(names)} repository paths and {len(blobs)} historical blobs; {len(problems)} findings.')
    print('Limited pattern checks only; review provenance, binaries, dependencies, and release contents separately.')
    return bool(problems)


if __name__ == '__main__':
    sys.exit(main())
