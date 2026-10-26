# SPDX-License-Identifier: Apache-2.0
"""The Cloud Run image holds every file the gateway imports.

The Dockerfile copies only part of the repository. A module the gateway imports
but the image lacks passes every other test (they run from the full checkout)
and only fails when Cloud Run starts the container. So: copy exactly what the
Dockerfile copies into an empty folder and import the app there.
"""
from __future__ import annotations

import glob
import shlex
import shutil
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]


def copied_files() -> list[tuple[str, str]]:
    """(source, destination) pairs of the Dockerfile's COPY lines, relative to the build root."""
    pairs = []
    for line in (ROOT/'cloud'/'Dockerfile').read_text(encoding='utf-8').splitlines():
        if not line.startswith('COPY '):
            continue
        *sources, dest = shlex.split(line)[1:]
        for source in sources:
            for match in glob.glob(source, root_dir=ROOT):
                pairs.append((match, dest))
    return pairs


def test_the_image_files_import_the_gateway(tmp_path):
    for source, dest in copied_files():
        src = ROOT/source
        target = tmp_path/dest
        if src.is_dir():
            shutil.copytree(src, target, dirs_exist_ok=True, ignore=shutil.ignore_patterns('__pycache__'))
        else:
            if dest.endswith('/'):
                target = target/src.name
            target.parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(src, target)
    # -I: nothing from the checkout or the environment leaks onto the path; the image's WORKDIR is cloud/.
    run = subprocess.run([sys.executable, '-I', '-c', 'import sys; sys.path.insert(0, "."); import gateway.app'],
                         cwd=tmp_path/'cloud', capture_output=True, text=True, encoding='utf-8')
    assert run.returncode == 0, 'the image cannot import the gateway:\n' + run.stderr[-2000:]
