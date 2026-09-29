# SPDX-License-Identifier: Apache-2.0
"""Unpack an engine archive into build/engine for the installer build.

    python packaging/engine/fetch_bundle.py --name linux-x64 --from dist-engine [--out build/engine]

Takes gradara-engine-*.tar.* from the folder (an engine-<name> artifact of the
Engine bundles workflow, or pack_bundle.py output), checks the SHA-256 recorded
in <name>.json, and unpacks it. On macOS the universal vfkit is thinned to the
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
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with open(path, 'rb') as f:
        for block in iter(lambda: f.read(1 << 22), b''):
            digest.update(block)
    return digest.hexdigest()


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument('--name', required=True, help='windows-x64, linux-x64, macos-arm64, or macos-x64')
    parser.add_argument('--from', dest='source', type=Path, required=True, help='the folder holding the archive and <name>.json')
    parser.add_argument('--out', type=Path, default=ROOT/'build'/'engine')
    args = parser.parse_args()
    info = json.loads((args.source/f'{args.name}.json').read_text(encoding='utf-8'))
    archive = args.source/info['file']
    actual = sha256(archive)
    if actual != info['sha256']:
        raise SystemExit(f"{archive.name}: checksum {actual} does not match {info['sha256']}.")
    if args.out.exists():
        shutil.rmtree(args.out)
    args.out.mkdir(parents=True)
    with tarfile.open(archive, 'r:*', encoding='utf-8') as tar:
        if sys.version_info >= (3, 12):
            tar.extractall(args.out, filter='data')
        else:
            tar.extractall(args.out)
    manifest = json.loads((args.out/'manifest.json').read_text(encoding='utf-8'))
    vfkit = args.out/manifest.get('vfkit', 'vfkit')
    if manifest.get('platform') == 'macos' and sys.platform == 'darwin' and shutil.which('lipo'):
        arch = {'arm64': 'arm64', 'amd64': 'x86_64'}[manifest['arch']]
        thin = vfkit.with_name('vfkit.thin')
        subprocess.run(['lipo', str(vfkit), '-thin', arch, '-output', str(thin)], check=True)
        thin.replace(vfkit)
        vfkit.chmod(0o755)
    print(f"Engine: OpenModelica {manifest['version']} for {manifest['platform']} {manifest['arch']} in {args.out}")


if __name__ == '__main__':
    main()
