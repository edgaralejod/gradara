# SPDX-License-Identifier: Apache-2.0
"""Build the Windows engine bundle (run on a Windows machine, as CI does).

Downloads the official OpenModelica installer, checks it against the published
MD5, installs it silently, copies the parts Gradara needs (trim_windows.py),
and installs the Modelica Standard Library into the bundle with the bundle's
own omc, so the result needs nothing else.

    python packaging/engine/build_windows.py --out build\\engine [--install C:\\OM] [--keep-install]
"""
from __future__ import annotations

import argparse
import hashlib
import json
import os
import shutil
import subprocess
import sys
import tempfile
import urllib.request
from pathlib import Path

HERE = Path(__file__).resolve().parent
OM_VERSION = os.environ.get('OM_VERSION', '1.27.1')
MSL_VERSION = os.environ.get('MSL_VERSION', '4.1.0')
BASE = 'https://build.openmodelica.org/omc/builds/windows/releases/{minor}/{patch}/64bit/OpenModelica-v{version}-64bit.exe'


def download(url: str, target: Path) -> None:
    print('Downloading', url, flush=True)
    with urllib.request.urlopen(url, timeout=120) as response, open(target, 'wb') as out:
        shutil.copyfileobj(response, out, 1 << 22)


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument('--out', required=True, type=Path)
    parser.add_argument('--install', type=Path, default=Path(r'C:\OpenModelicaFull'))
    parser.add_argument('--installer', type=Path, help='an already downloaded installer')
    args = parser.parse_args()
    major, minor, patch = OM_VERSION.split('.')
    url = BASE.format(minor=f'{major}.{minor}', patch=patch, version=OM_VERSION)
    installer = args.installer or Path(tempfile.gettempdir())/Path(url).name
    if not installer.exists():
        download(url, installer)
    expected = urllib.request.urlopen(url + '.md5sum', timeout=60).read().decode().split()[0].lower()
    digest = hashlib.md5()
    with open(installer, 'rb') as f:
        for block in iter(lambda: f.read(1 << 22), b''):
            digest.update(block)
    if digest.hexdigest() != expected:
        raise SystemExit(f'Installer checksum mismatch: {digest.hexdigest()} != {expected}')
    print('Installer checksum OK', flush=True)

    if not (args.install/'bin'/'omc.exe').exists():
        print('Installing OpenModelica silently into', args.install, flush=True)
        # NSIS: /D must be the last argument and is not quoted.
        subprocess.run([str(installer), '/S', f'/D={args.install}'], check=True)
    omc_full = args.install/'bin'/'omc.exe'
    if not omc_full.exists():
        raise SystemExit(f'The installer did not produce {omc_full}')
    print(subprocess.run([str(omc_full), '--version'], capture_output=True, text=True).stdout.strip(), flush=True)

    out = args.out.resolve()
    subprocess.run([sys.executable, str(HERE/'trim_windows.py'), '--om', str(args.install), '--out', str(out)], check=True)

    # MSL, installed by the trimmed omc into a private home, then moved into the bundle.
    home = Path(tempfile.mkdtemp(prefix='gradara-msl-'))
    env = dict(os.environ, OPENMODELICAHOME=str(out), HOME=str(home), APPDATA=str(home), USERPROFILE=str(home))
    env.pop('OPENMODELICALIBRARY', None)
    env['PATH'] = os.pathsep.join([str(out/'bin'), str(out/'tools'/'msys'/'ucrt64'/'bin'), env.get('PATH', '')])
    script = home/'install.mos'
    script.write_text(f'installPackage(Modelica, "{MSL_VERSION}", exactMatch=true);\ngetErrorString();\n', encoding='utf-8')
    result = subprocess.run([str(out/'bin'/'omc.exe'), str(script)], cwd=home, env=env, capture_output=True, text=True,
                            encoding='utf-8', errors='replace')
    print(result.stdout, result.stderr, flush=True)
    installed = [p for p in home.rglob('Modelica ' + MSL_VERSION + '*') if p.is_dir() and (p/'package.mo').exists()]
    if not result.stdout.lstrip().startswith('true') or not installed:
        raise SystemExit('The Modelica Standard Library could not be installed.')
    source = installed[0].parent
    library = out/'lib'/'omlibrary'
    if library.exists():
        shutil.rmtree(library)
    shutil.copytree(source, library, ignore=shutil.ignore_patterns('index.json', 'index.mos'))
    print('Libraries:', sorted(p.name for p in library.iterdir()), flush=True)

    usage = (HERE/'OSMC-USAGE-MODE.txt').read_text(encoding='utf-8').replace('<version>', OM_VERSION)
    (out/'OSMC-USAGE-MODE.txt').write_text(usage, encoding='utf-8')
    if not (out/'OSMC-License.txt').exists():
        shutil.copy2(args.install/'OSMC-License.txt', out/'OSMC-License.txt')
    (out/'packages.txt').write_text(f'# OpenModelica {OM_VERSION} engine bundle for Windows x64, trimmed from the '
                                    f'official installer {Path(url).name} (MD5 {expected})\n'
                                    f'openmodelica {OM_VERSION}\nmodelica-standard-library {MSL_VERSION}\n',
                                    encoding='utf-8')
    (out/'manifest.json').write_text(json.dumps({
        'engine': 'openmodelica', 'version': OM_VERSION, 'msl': MSL_VERSION, 'platform': 'windows', 'arch': 'x64',
        'omc': 'bin/omc.exe', 'library': 'lib/omlibrary', 'compiler': 'tools/msys/ucrt64/bin/gcc.exe'}, indent=1),
        encoding='utf-8')
    size = sum(p.stat().st_size for p in out.rglob('*') if p.is_file())
    print(f'Windows engine bundle: {out} ({size / 1e6:.0f} MB)', flush=True)


if __name__ == '__main__':
    main()
