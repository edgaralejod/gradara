"""Write the license texts of every third-party package the desktop app ships.

MIT, BSD, ISC, and Apache licenses require their notices to travel with the
binaries. This collects them from the installed dependencies, so it always matches
the build:

- npm packages the workbench and desktop shell depend on at run time (every
  non-dev entry of `package-lock.json` and `desktop/package-lock.json`), and
- Python packages the bundled local service imports (the dependency closure of
  `server/requirements.txt` in the running interpreter).

Run it after `npm ci` and the pip install, from the repository root:
`python packaging/third_party_licenses.py`. The result, `build/legal/THIRD_PARTY_LICENSES.txt`,
is copied into every installer's `legal/` folder. Electron and Chromium ship their
own license files inside the Electron runtime.
"""
from __future__ import annotations

import json
import re
import sys
from importlib import metadata
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT/'build'/'legal'/'THIRD_PARTY_LICENSES.txt'
LICENSE_NAMES = re.compile(r'^(licen[cs]e|copying|notice)([.-].*)?$', re.I)
RULE = '=' * 78


def read(path: Path) -> str:
    return path.read_text(encoding='utf-8', errors='replace').strip()


def license_files(folder: Path) -> list[Path]:
    if not folder.is_dir():
        return []
    return sorted(p for p in folder.iterdir() if p.is_file() and LICENSE_NAMES.match(p.name))


def npm_entries(lockfile: Path) -> list[tuple[str, str, str, list[Path]]]:
    """(name, version, license, license files) for every run-time package in a lockfile."""
    if not lockfile.exists():
        return []
    packages = json.loads(lockfile.read_text(encoding='utf-8')).get('packages', {})
    out = []
    for path, entry in packages.items():
        if not path or entry.get('dev') or entry.get('link'):
            continue
        name = entry.get('name') or path.rsplit('node_modules/', 1)[-1]
        folder = lockfile.parent/path
        if not folder.exists():
            continue  # an optional platform package this machine did not install
        declared = entry.get('license')
        if not declared and (folder/'package.json').exists():
            declared = json.loads((folder/'package.json').read_text(encoding='utf-8')).get('license')
        out.append((name, entry.get('version', ''), str(declared or 'see files'), license_files(folder)))
    return out


def requirement_names(path: Path) -> list[str]:
    names = []
    for line in path.read_text(encoding='utf-8').splitlines():
        line = line.split('#', 1)[0].strip()
        if line and not line.startswith('-'):
            names.append(re.split(r'[\s<>=!~\[;]', line, maxsplit=1)[0])
    return names


def canonical(name: str) -> str:
    return re.sub(r'[-_.]+', '-', name).lower()


def python_closure(roots: list[str]) -> list[metadata.Distribution]:
    seen: dict[str, metadata.Distribution] = {}
    stack = list(roots)
    while stack:
        name = canonical(stack.pop())
        if name in seen:
            continue
        try:
            dist = metadata.distribution(name)
        except metadata.PackageNotFoundError:
            continue
        seen[name] = dist
        for requirement in dist.requires or []:
            if 'extra ==' in requirement:
                continue
            stack.append(re.split(r'[\s<>=!~\[;(]', requirement, maxsplit=1)[0])
    return sorted(seen.values(), key=lambda d: canonical(d.metadata['Name']))


def python_license_texts(dist: metadata.Distribution) -> list[tuple[str, str]]:
    texts = []
    for file in dist.files or []:
        parts = [p.lower() for p in file.parts]
        if 'licenses' in parts or LICENSE_NAMES.match(file.name):
            located = Path(dist.locate_file(file))
            if located.is_file() and located.suffix not in {'.py', '.pyc'}:
                texts.append((file.name, read(located)))
    return texts


def python_license_name(dist: metadata.Distribution) -> str:
    meta = dist.metadata
    expression = meta.get('License-Expression')
    if expression:
        return expression
    classifiers = [c.split('::')[-1].strip() for c in meta.get_all('Classifier') or []
                   if c.startswith('License ::')]
    if classifiers:
        return ', '.join(classifiers)
    declared = (meta.get('License') or '').strip()
    return declared.splitlines()[0][:80] if declared else 'see files'


def main() -> int:
    sections = [
        'Gradara third-party licenses',
        '',
        'Gradara includes the open-source packages listed below. Each is followed by',
        'the license text it ships with. Gradara itself is licensed under Apache-2.0;',
        'see LICENSE and NOTICE next to this file, and THIRD_PARTY_NOTICES.md for the',
        'components that are downloaded rather than shipped (OpenModelica, the Modelica',
        'Standard Library).',
        '',
    ]
    missing = []
    npm = npm_entries(ROOT/'package-lock.json') + npm_entries(ROOT/'desktop'/'package-lock.json')
    unique = {}
    for entry in npm:
        unique.setdefault((entry[0], entry[1]), entry)
    sections += [RULE, f'npm packages ({len(unique)})', RULE, '']
    for name, version, declared, files in sorted(unique.values()):
        sections.append(f'--- {name} {version} ({declared})')
        if files:
            sections += [read(f) for f in files]
        else:
            missing.append(f'npm {name}')
            sections.append(f'No license file is included in the package. Declared license: {declared}.')
        sections.append('')
    dists = python_closure(requirement_names(ROOT/'server'/'requirements.txt'))
    sections += [RULE, f'Python packages ({len(dists)})', RULE, '']
    for dist in dists:
        name, version = dist.metadata['Name'], dist.version
        declared = python_license_name(dist)
        sections.append(f'--- {name} {version} ({declared})')
        texts = python_license_texts(dist)
        if texts:
            sections += [text for _, text in texts]
        else:
            missing.append(f'python {name}')
            sections.append(f'No license file is included in the package. Declared license: {declared}.')
        sections.append('')
    # The bundled service carries the Python runtime itself (PyInstaller).
    runtime = [Path(sys.base_prefix)/'LICENSE.txt',
               Path(sys.base_prefix)/'lib'/f'python{sys.version_info.major}.{sys.version_info.minor}'/'LICENSE.txt']
    found = next((p for p in runtime if p.is_file()), None)
    sections += [RULE, 'Python runtime', RULE, '',
                 f'--- CPython {sys.version.split()[0]} (PSF-2.0)',
                 read(found) if found else 'Python Software Foundation License Version 2; see https://docs.python.org/3/license.html.',
                 '']
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text('\n'.join(sections) + '\n', encoding='utf-8')
    print(f'{OUT.relative_to(ROOT)}: {len(unique)} npm and {len(dists)} Python packages'
          f'{f"; {len(missing)} without a license file" if missing else ""}')
    return 0


if __name__ == '__main__':
    sys.exit(main())
