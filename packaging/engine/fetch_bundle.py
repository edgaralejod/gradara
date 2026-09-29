# SPDX-License-Identifier: Apache-2.0
"""Put this platform's engine bundle into build/engine for the installer build.

    python packaging/engine/fetch_bundle.py --name linux-x64 [--out build/engine] [--from DIR]

Downloads the archive named in packaging/engine/bundles.json from the engine
release (a GitHub prerelease that is never marked latest), checks its SHA-256,
and unpacks it. --from takes the archives from a local folder instead (for
example the artifacts of an Engine bundles run), still checking the checksum
when bundles.json lists one. On macOS the universal vfkit is thinned to the
bundle's architecture.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import shutil
import subprocess
import sys
import tarfile
import urllib.request
from pathlib import Path

HERE = Path(__file__).resolve().parent
ROOT = HERE.parent.parent


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with open(path, 'rb') as f:
        for block in iter(lambda: f.read(1 << 22), b''):
            digest.update(block)
    return digest.hexdigest()


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument('--name', required=True, help='windows-x64, linux-x64, macos-arm64, or macos-x64')
    parser.add_argument('--out', type=Path, default=ROOT/'build'/'engine')
    parser.add_argument('--from', dest='source', type=Path, help='a folder holding the archive (and <name>.json)')
    args = parser.parse_args()
    pins = json.loads((HERE/'bundles.json').read_text(encoding='utf-8'))
    pin = pins['assets'].get(args.name, {})
    cache = ROOT/'build'/'engine-download'
    cache.mkdir(parents=True, exist_ok=True)
    if args.source:
        local = json.loads((args.source/f'{args.name}.json').read_text(encoding='utf-8'))
        archive = args.source/local['file']
        expected = pin.get('sha256') if pin.get('file') == local['file'] else local['sha256']
    else:
        if not pin:
            raise SystemExit(f'packaging/engine/bundles.json has no engine for {args.name}.')
        archive = cache/pin['file']
        expected = pin['sha256']
        if not archive.exists() or sha256(archive) != expected:
            url = f"https://github.com/{pins['repository']}/releases/download/{pins['release']}/{pin['file']}"
            print('Downloading', url, flush=True)
            with urllib.request.urlopen(url, timeout=300) as response, open(archive, 'wb') as out:
                shutil.copyfileobj(response, out, 1 << 22)
    actual = sha256(archive)
    if expected and actual != expected:
        raise SystemExit(f'{archive.name}: checksum {actual} does not match {expected}.')
    if args.out.exists():
        shutil.rmtree(args.out)
    args.out.mkdir(parents=True)
    with tarfile.open(archive, 'r:*') as tar:
        tar.extractall(args.out, filter='data') if sys.version_info >= (3, 12) else tar.extractall(args.out)
    manifest = json.loads((args.out/'manifest.json').read_text(encoding='utf-8'))
    vfkit = args.out/manifest.get('vfkit', 'vfkit')
    if manifest.get('platform') == 'macos' and sys.platform == 'darwin' and shutil.which('lipo'):
        arch = {'arm64': 'arm64', 'amd64': 'x86_64'}[manifest['arch']]
        subprocess.run(['lipo', str(vfkit), '-thin', arch, '-output', str(vfkit) + '.thin'], check=True)
        Path(str(vfkit) + '.thin').replace(vfkit)
        vfkit.chmod(0o755)
    print(f"Engine: OpenModelica {manifest['version']} for {manifest['platform']} {manifest['arch']} in {args.out}")


if __name__ == '__main__':
    main()
