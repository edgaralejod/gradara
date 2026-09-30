# SPDX-License-Identifier: Apache-2.0
"""Build the Windows engine bundle (run on a Windows machine, as CI does).

Downloads the official OpenModelica installer, checks it against the published
MD5, installs it silently, copies the parts Gradara needs (trim_windows.py),
installs the Modelica Standard Library into the bundle, provides the MSL C
library omc loads while building models (compiled from the MSL sources when
the installation has no DLL of it), and checks that the trimmed omc can
evaluate it, so the result needs nothing else.

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


def bundle_env(out: Path, home: Path) -> dict:
    env = dict(os.environ, OPENMODELICAHOME=str(out), OPENMODELICALIBRARY=str(out/'lib'/'omlibrary'),
               HOME=str(home), APPDATA=str(home), USERPROFILE=str(home))
    env['PATH'] = os.pathsep.join([str(out/'bin'), str(out/'tools'/'msys'/'ucrt64'/'bin'), env.get('PATH', '')])
    env.pop('OMDEV', None)
    return env


def ensure_external_c(out: Path) -> None:
    """omc evaluates MSL functions such as Modelica.Utilities.Strings.substring while
    it builds a model, by loading ModelicaExternalC.dll from bin/. When the
    installation has none, compile it from the MSL's own C sources with the bundle's
    gcc, against the runtime DLL that provides ModelicaError and friends."""
    target = out/'bin'/'libModelicaExternalC.dll'
    if target.exists() or (out/'bin'/'ModelicaExternalC.dll').exists():
        return
    sources = next(iter(sorted((out/'lib'/'omlibrary').glob('Modelica */Resources/C-Sources'))), None)
    if sources is None:
        raise SystemExit('The MSL C sources are missing; cannot build ModelicaExternalC.dll.')
    files = [str(sources/f) for f in ('ModelicaFFT.c', 'ModelicaInternal.c', 'ModelicaRandom.c',
                                      'ModelicaStrings.c', 'win32_dirent.c')]
    gcc = out/'tools'/'msys'/'ucrt64'/'bin'/'gcc.exe'
    home = Path(tempfile.mkdtemp(prefix='gradara-ffi-'))
    # OpenModelica's runtime DLL has every ModelicaUtilities function but this one
    # (MSL 4.1 uses it in ModelicaInternal.c), so the library carries its own.
    shim = home/'duplicate_string.c'
    shim.write_text('#include <string.h>\n#include "ModelicaUtilities.h"\n'
                    'char* ModelicaDuplicateStringWithErrorReturn(const char* source) {\n'
                    '  char* copy = ModelicaAllocateStringWithErrorReturn(strlen(source));\n'
                    '  if (copy != NULL) strcpy(copy, source);\n  return copy;\n}\n', encoding='utf-8')
    files.append(str(shim))
    result = subprocess.run([str(gcc), '-shared', '-O2', '-o', str(target), *files, f'-I{sources}',
                             str(out/'bin'/'libOpenModelicaRuntimeC.dll')], env=bundle_env(out, home),
                            capture_output=True, text=True, encoding='utf-8', errors='replace')
    print('Compiled ModelicaExternalC.dll from the MSL sources', result.stdout, result.stderr, flush=True)
    if result.returncode or not target.exists():
        raise SystemExit('ModelicaExternalC.dll could not be compiled.')


def check_external_c(out: Path) -> None:
    """The trimmed omc must evaluate an MSL external function while flattening."""
    home = Path(tempfile.mkdtemp(prefix='gradara-check-'))
    (home/'check.mos').write_text(
        'loadModel(Modelica); getErrorString();\n'
        'loadString("model C parameter Integer n = Modelica.Utilities.Strings.length('
        'Modelica.Utilities.Strings.substring(\\"hello\\", 1, 2)); Real x[n] = fill(1, n); end C;"); getErrorString();\n'
        'instantiateModel(C); getErrorString();\n', encoding='utf-8')
    result = subprocess.run([str(out/'bin'/'omc.exe'), 'check.mos'], cwd=home, env=bundle_env(out, home),
                            capture_output=True, text=True, encoding='utf-8', errors='replace', timeout=600)
    print(result.stdout[-3000:], result.stderr[-2000:], flush=True)
    if 'x[2]' not in result.stdout:
        raise SystemExit('The trimmed omc could not evaluate an MSL external function (ModelicaExternalC).')
    print('The trimmed omc evaluates MSL external functions.', flush=True)


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
    print(subprocess.run([str(omc_full), '--version'], capture_output=True, text=True, encoding='utf-8', errors='replace').stdout.strip(), flush=True)

    out = args.out.resolve()
    subprocess.run([sys.executable, str(HERE/'trim_windows.py'), '--om', str(args.install), '--out', str(out)], check=True)

    # MSL, installed by the full installation's omc (its downloader needs the CA
    # certificates the trimmed copy leaves out) into a private home, then copied
    # into the bundle. The engine tests later load it with the trimmed omc.
    home = Path(tempfile.mkdtemp(prefix='gradara-msl-'))
    env = dict(os.environ, OPENMODELICAHOME=str(args.install), HOME=str(home), APPDATA=str(home), USERPROFILE=str(home))
    env.pop('OPENMODELICALIBRARY', None)
    script = home/'install.mos'
    script.write_text(f'installPackage(Modelica, "{MSL_VERSION}", exactMatch=true);\ngetErrorString();\n', encoding='utf-8')
    result = subprocess.run([str(omc_full), str(script)], cwd=home, env=env, capture_output=True, text=True,
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
    ensure_external_c(out)
    check_external_c(out)

    usage = (HERE/'OSMC-USAGE-MODE.txt').read_text(encoding='utf-8').replace('<version>', OM_VERSION)
    (out/'OSMC-USAGE-MODE.txt').write_text(usage, encoding='utf-8')
    if not (out/'OSMC-License.txt').exists():
        found = next(iter(sorted(args.install.rglob('OSMC-License.txt'))), None)
        if found:
            shutil.copy2(found, out/'OSMC-License.txt')
        else:
            download(f'https://raw.githubusercontent.com/OpenModelica/OpenModelica/v{OM_VERSION}/OSMC-License.txt',
                     out/'OSMC-License.txt')
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
