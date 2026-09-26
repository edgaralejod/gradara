#!/usr/bin/env python3
"""Warn when a change touches code without touching the docs that describe it.

The code-to-docs map is the table between the doc-map markers in AGENTS.md, so
agents and this check read the same source. Entries are repository paths: a
path ending in / matches everything under it, and * patterns use fnmatch.

    python3 scripts/check-doc-drift.py origin/main          # compare HEAD with a base
    python3 scripts/check-doc-drift.py --files a.py b.md    # check an explicit file list

Advisory by default: prints GitHub warning annotations and exits 0. Pass
--strict to exit 1 when a mapped area changed without any of its docs.
"""
from __future__ import annotations

import argparse
import fnmatch
import re
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
MAP = re.compile(r'<!-- doc-map:start -->(.*?)<!-- doc-map:end -->', re.S)


def load_map() -> list[tuple[list[str], list[str]]]:
    match = MAP.search((ROOT/'AGENTS.md').read_text(encoding='utf-8'))
    if not match:
        raise SystemExit('AGENTS.md has no doc-map table between the doc-map markers.')
    rows = []
    for line in match.group(1).splitlines():
        cells = [cell.strip() for cell in line.strip().strip('|').split('|')]
        if len(cells) != 2 or not cells[0].startswith('`'):
            continue
        code, docs = (re.findall(r'`([^`]+)`', cell) for cell in cells)
        rows.append((code, docs))
    if not rows:
        raise SystemExit('The doc-map table in AGENTS.md has no rows.')
    return rows


def matches(path: str, pattern: str) -> bool:
    if pattern.endswith('/'):
        return path.startswith(pattern)
    if any(ch in pattern for ch in '*?['):
        return fnmatch.fnmatch(path, pattern)
    return path == pattern


def changed_files(base: str) -> list[str]:
    out = subprocess.check_output(['git', 'diff', '--name-only', f'{base}...HEAD'], cwd=ROOT)
    return [line for line in out.decode().splitlines() if line]


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument('base', nargs='?', help='Git ref to compare with (for example origin/main)')
    parser.add_argument('--files', nargs='*', help='Explicit list of changed files instead of a git diff')
    parser.add_argument('--strict', action='store_true', help='Exit 1 when docs look stale')
    args = parser.parse_args()
    if args.files is None and not args.base:
        parser.error('pass a base ref or --files')

    changed = args.files if args.files is not None else changed_files(args.base)
    drift = []
    for code, docs in load_map():
        touched = sorted({path for path in changed for pattern in code if matches(path, pattern)})
        if touched and not any(matches(path, doc) for path in changed for doc in docs):
            drift.append((touched, docs))

    for touched, docs in drift:
        message = (f"Changed {', '.join(touched[:4])}{' and more' if len(touched) > 4 else ''} "
                   f"without updating {', '.join(docs)}. Update them, or say in the pull request "
                   f"why no documentation change is needed.")
        print(f'::warning title=Documentation may be stale::{message}')
    print(f'Checked {len(changed)} changed files against the AGENTS.md doc map; '
          f'{len(drift)} area(s) changed without their docs.')
    return 1 if drift and args.strict else 0


if __name__ == '__main__':
    sys.exit(main())
