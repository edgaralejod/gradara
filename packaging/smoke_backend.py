# SPDX-License-Identifier: Apache-2.0
"""Start the frozen local service and exercise a few endpoints (CI smoke test)."""
from __future__ import annotations

import json
import os
import shutil
import socket
import subprocess
import sys
import tempfile
import time
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
EXE = ROOT/'build'/'backend'/'gradara-backend'/('gradara-backend.exe' if os.name == 'nt' else 'gradara-backend')


def free_port() -> int:
    with socket.socket() as s:
        s.bind(('127.0.0.1', 0))
        return s.getsockname()[1]


def call(port: int, path: str, body: dict | None = None) -> dict:
    request = urllib.request.Request(f'http://127.0.0.1:{port}/api{path}', method='POST' if body is not None else 'GET',
                                     data=json.dumps(body).encode() if body is not None else None,
                                     headers={'Content-Type': 'application/json', 'X-Gradara-Client': 'smoke'})
    with urllib.request.urlopen(request, timeout=10) as response:
        return json.loads(response.read())


def main() -> None:
    work = Path(tempfile.mkdtemp(prefix='gradara-smoke-'))
    resources = work/'resources'
    (resources/'models').mkdir(parents=True)
    shutil.copytree(ROOT/'models'/'examples', resources/'models'/'examples')
    port = free_port()
    env = dict(os.environ, GRADARA_DATA_DIR=str(work/'data'), GRADARA_RESOURCES=str(resources),
               GRADARA_STATIC_DIR=str(ROOT/'dist-desktop'/'web'), GRADARA_CREDENTIAL_STORE='file')
    process = subprocess.Popen([str(EXE), '--port', str(port)], env=env)
    try:
        deadline = time.monotonic() + 60
        while True:
            try:
                call(port, '/ai')
                break
            except Exception:
                if process.poll() is not None or time.monotonic() > deadline:
                    raise SystemExit('The bundled service did not start.')
                time.sleep(0.5)
        created = call(port, '/models', {'name': 'Smoke DC', 'template': 'dc'})
        assert created['project']['blocks'], 'example model has blocks'
        engine = call(port, '/engine')
        print('engine:', engine['backend'], engine['label'])
        with urllib.request.urlopen(f'http://127.0.0.1:{port}/', timeout=10) as page:
            assert b'<div id="root">' in page.read(), 'workbench is served'
        print('Bundled service smoke test passed.')
    finally:
        process.terminate()
        try:
            process.wait(timeout=15)
        except subprocess.TimeoutExpired:
            process.kill()
        shutil.rmtree(work, ignore_errors=True)


if __name__ == '__main__':
    main()
