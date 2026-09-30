# SPDX-License-Identifier: Apache-2.0
"""Archive an engine bundle as a workflow artifact and record its checksum.

    python packaging/engine/pack_bundle.py --dir build/engine --name linux-x64 --out dist-engine

Writes dist-engine/gradara-engine-<version>-<name>.tar.(xz|gz) and
dist-engine/<name>.json ({"file", "sha256", "size"}). The macOS VM image is
already compressed (squashfs), so it is only gzipped.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import tarfile
from pathlib import Path


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument('--dir', required=True, type=Path)
    parser.add_argument('--name', required=True)
    parser.add_argument('--out', required=True, type=Path)
    args = parser.parse_args()
    manifest = json.loads((args.dir/'manifest.json').read_text(encoding='utf-8'))
    compression = 'gz' if manifest.get('platform') == 'macos' else 'xz'
    args.out.mkdir(parents=True, exist_ok=True)
    archive = args.out/f"gradara-engine-{manifest['version']}-{args.name}.tar.{compression}"
    options = {'preset': 6} if compression == 'xz' else {'compresslevel': 6}
    with tarfile.open(archive, f'w:{compression}', encoding='utf-8', **options) as tar:
        for path in sorted(args.dir.rglob('*')):
            if path.is_symlink():
                raise SystemExit(f'Engine bundles must not contain symlinks: {path}')
            tar.add(path, arcname=path.relative_to(args.dir).as_posix(), recursive=False)
    digest = hashlib.sha256()
    with open(archive, 'rb') as f:
        for block in iter(lambda: f.read(1 << 22), b''):
            digest.update(block)
    info = {'file': archive.name, 'sha256': digest.hexdigest(), 'size': archive.stat().st_size}
    (args.out/f'{args.name}.json').write_text(json.dumps(info), encoding='utf-8')
    print(json.dumps(info))


if __name__ == '__main__':
    main()
