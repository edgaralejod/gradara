#!/usr/bin/env python3
# SPDX-License-Identifier: Apache-2.0
"""npm audit at high severity, with a short list of accepted advisories that have no patched release.

Fails on any high or critical advisory in the installed dependency tree that is not
listed in ACCEPTED. An accepted advisory must have no fixed version upstream and a
reason it cannot reach users; remove it as soon as a patched release exists (the
script says so when npm no longer reports it). Run after `npm ci`:

    python3 scripts/check-audit.py
"""
import json
import subprocess
import sys

BLOCKING = {'high', 'critical'}

# GHSA ID -> why Gradara accepts it until a fix exists.
ACCEPTED = {
    'GHSA-vfj7-8cjw-p6xm': (
        'braces <= 3.0.3 (every release; no patched version as of 2026-10-07): stack exhaustion on deeply '
        'nested brace patterns. Reached only through fast-glob in build and component tooling (vinext, shadcn, '
        "ts-morph), which expands the repository's own glob patterns, never user input."
    ),
}


def main() -> int:
    run = subprocess.run('npm audit --json', shell=True, capture_output=True, text=True, encoding='utf-8')
    try:
        report = json.loads(run.stdout)
    except ValueError:
        print(run.stdout[-2000:], run.stderr[-2000:], sep='\n')
        print('npm audit did not return a report.', file=sys.stderr)
        return 1
    found: dict[str, dict] = {}
    for package, entry in report.get('vulnerabilities', {}).items():
        for advisory in entry.get('via', []):
            if isinstance(advisory, dict) and advisory.get('severity') in BLOCKING:
                ghsa = advisory.get('url', '').rsplit('/', 1)[-1]
                found.setdefault(ghsa, {'package': package, 'title': advisory.get('title', ''),
                                        'severity': advisory['severity'], 'range': advisory.get('range', '')})
    blocking = {ghsa: a for ghsa, a in found.items() if ghsa not in ACCEPTED}
    for ghsa in sorted(set(found) & set(ACCEPTED)):
        a = found[ghsa]
        print(f'accepted {ghsa} ({a["severity"]}, {a["package"]} {a["range"]}): {ACCEPTED[ghsa]}')
    for ghsa in sorted(set(ACCEPTED) - set(found)):
        print(f'{ghsa} is no longer reported; remove it from ACCEPTED in scripts/check-audit.py.')
    for ghsa, a in sorted(blocking.items()):
        print(f'{a["severity"]}: {a["package"]} {a["range"]}: {a["title"]} https://github.com/advisories/{ghsa}',
              file=sys.stderr)
    if blocking:
        print(f'{len(blocking)} high or critical advisories. Update or override the dependency; run `npm audit` for details.',
              file=sys.stderr)
        return 1
    print('No high or critical advisories outside the accepted list.')
    return 0


if __name__ == '__main__':
    sys.exit(main())
