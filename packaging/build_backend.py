# SPDX-License-Identifier: Apache-2.0
"""Freeze the local service with PyInstaller into build/backend/gradara-backend/."""
from __future__ import annotations

import shutil
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent


def main() -> None:
    out = ROOT/'build'
    shutil.rmtree(out/'backend', ignore_errors=True)
    command = [
        sys.executable, '-m', 'PyInstaller', str(ROOT/'packaging'/'backend_entry.py'),
        '--name', 'gradara-backend', '--onedir', '--noconfirm', '--clean',
        '--distpath', str(out/'backend'), '--workpath', str(out/'pyinstaller'), '--specpath', str(out),
        '--paths', str(ROOT),
        '--hidden-import', 'server.app',
        '--collect-submodules', 'server',
        '--collect-submodules', 'uvicorn',
        '--collect-submodules', 'keyring',
        '--copy-metadata', 'keyring',
        '--exclude-module', 'tkinter',
        '--exclude-module', 'pytest',
    ]
    if sys.platform == 'darwin':
        command += ['--osx-bundle-identifier', 'us.virtu-services.gradara.backend']
    subprocess.run(command, cwd=ROOT, check=True)
    exe = out/'backend'/'gradara-backend'/('gradara-backend.exe' if sys.platform == 'win32' else 'gradara-backend')
    if not exe.exists():
        raise SystemExit(f'PyInstaller did not produce {exe}')
    print(f'Built {exe}')


if __name__ == '__main__':
    main()
