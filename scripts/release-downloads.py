#!/usr/bin/env python3
"""Print how often each release's installers have been downloaded.

GitHub counts every download of a release asset, including the ones that
arrive through the website's `releases/latest/download/…` links and the
in-app updater, so no tracking on gradara.app is needed to see whether people
install Gradara. The counts are running totals per file; GitHub keeps no
history, so run this now and then (or in a scheduled job) and keep the output
if you want a time series. Draft releases are left out.

    python3 scripts/release-downloads.py            # every published release
    python3 scripts/release-downloads.py --latest   # the latest release only
    python3 scripts/release-downloads.py --json     # machine-readable

Unauthenticated requests are limited to 60 an hour; set GITHUB_TOKEN to raise
the limit (any token with public-repository read access will do).
"""
from __future__ import annotations

import argparse
import json
import os
import sys
import urllib.request

REPO = 'edgaralejod/gradara'
# Installers, in the order of docs/INSTALL.md; update metadata and blockmaps are
# downloaded by the updater and are summed separately.
INSTALLERS = ('Gradara-win-x64.exe', 'Gradara-mac-arm64.dmg', 'Gradara-mac-x64.dmg',
              'Gradara-linux-amd64.deb', 'Gradara-linux-x86_64.AppImage')
UPDATES = ('Gradara-mac-arm64.zip', 'Gradara-mac-x64.zip')


def fetch(url: str):
    headers = {'Accept': 'application/vnd.github+json', 'User-Agent': 'gradara-release-downloads'}
    token = os.environ.get('GITHUB_TOKEN')
    if token:
        headers['Authorization'] = f'Bearer {token}'
    with urllib.request.urlopen(urllib.request.Request(url, headers=headers), timeout=30) as response:
        return json.load(response)


def releases(latest_only: bool) -> list[dict]:
    if latest_only:
        return [fetch(f'https://api.github.com/repos/{REPO}/releases/latest')]
    found = fetch(f'https://api.github.com/repos/{REPO}/releases?per_page=100')
    return [r for r in found if not r.get('draft')]


def summarize(release: dict) -> dict:
    counts = {a['name']: a['download_count'] for a in release.get('assets', [])}
    return {
        'tag': release['tag_name'],
        'published': (release.get('published_at') or '')[:10],
        'installers': {name: counts.get(name, 0) for name in INSTALLERS if name in counts},
        'updates': sum(counts.get(name, 0) for name in UPDATES),
        'metadata': sum(v for k, v in counts.items() if k.endswith('.yml')),
    }


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument('--latest', action='store_true', help='the latest release only')
    parser.add_argument('--json', action='store_true', help='print JSON instead of a table')
    args = parser.parse_args()
    try:
        rows = [summarize(r) for r in releases(args.latest)]
    except OSError as exc:
        print(f'Could not read the releases: {exc}', file=sys.stderr)
        return 1
    if args.json:
        json.dump(rows, sys.stdout, indent=2)
        print()
        return 0
    names = [n for n in INSTALLERS if any(n in r['installers'] for r in rows)]
    short = {n: n.replace('Gradara-', '').rsplit('.', 1)[0] for n in names}
    header = ['release', 'published', *short.values(), 'installers', 'mac zip (updates)', 'update checks']
    table = []
    for r in rows:
        total = sum(r['installers'].values())
        table.append([r['tag'], r['published'], *[str(r['installers'].get(n, '')) for n in names],
                      str(total), str(r['updates']), str(r['metadata'])])
    widths = [max(len(x) for x in col) for col in zip(header, *table)]
    for line in (header, *table):
        print('  '.join(x.ljust(w) for x, w in zip(line, widths)).rstrip())
    print()
    print('Installer downloads include the website buttons (releases/latest/download/…). '
          '"update checks" counts fetches of latest*.yml, mostly installed apps looking for an update.')
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
