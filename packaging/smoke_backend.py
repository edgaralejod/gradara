# SPDX-License-Identifier: Apache-2.0
"""Start the frozen local service and exercise a few endpoints (CI smoke test).

When build/engine holds a Windows or Linux engine bundle, the service is pointed
at it and must simulate the DC motor and verify its controller's generated C.
(The macOS bundle is a VM image; the installed-app test covers it.)
"""
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


def call(port: int, path: str, body: dict | None = None, timeout: float = 10) -> dict:
    request = urllib.request.Request(f'http://127.0.0.1:{port}/api{path}', method='POST' if body is not None else 'GET',
                                     data=json.dumps(body).encode() if body is not None else None,
                                     headers={'Content-Type': 'application/json', 'X-Gradara-Client': 'smoke'})
    with urllib.request.urlopen(request, timeout=timeout) as response:
        return json.loads(response.read())


def main() -> None:
    work = Path(tempfile.mkdtemp(prefix='gradara-smoke-'))
    resources = work/'resources'
    (resources/'models').mkdir(parents=True)
    shutil.copytree(ROOT/'models'/'examples', resources/'models'/'examples')
    port = free_port()
    env = dict(os.environ, GRADARA_DATA_DIR=str(work/'data'), GRADARA_RESOURCES=str(resources),
               GRADARA_STATIC_DIR=str(ROOT/'dist-desktop'/'web'), GRADARA_CREDENTIAL_STORE='file')
    bundle = ROOT/'build'/'engine'
    manifest = json.loads((bundle/'manifest.json').read_text(encoding='utf-8')) if (bundle/'manifest.json').exists() else {}
    simulate = manifest.get('platform') in {'windows', 'linux'}
    if simulate:
        env['GRADARA_ENGINE_BUNDLE'] = str(bundle)
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
        engine = call(port, '/engine', timeout=120)
        print('engine:', engine['backend'], engine['label'])
        if simulate:
            simulate_and_verify(port, engine, created['project'])
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


def simulate_and_verify(port: int, engine: dict, project: dict) -> None:
    if engine['backend'] != 'bundled' or not engine['ready']:
        raise SystemExit(f"The bundled engine is not ready: {engine['label']}. {engine.get('detail', '')}")
    started = time.monotonic()
    job = call(port, '/runs', project)
    while job['status'] not in {'complete', 'failed', 'cancelled'}:
        if time.monotonic() - started > 600:
            raise SystemExit('The simulation did not finish within 10 minutes.')
        time.sleep(1)
        job = call(port, f"/jobs/{job['id']}")
    if job['status'] != 'complete':
        raise SystemExit(f"Simulation {job['status']}: {job.get('error')}")
    result = job['result']
    print(f"simulated in {time.monotonic() - started:.1f}s on {result['engine']}: {result['samples']} samples, "
          f"{len(result['series'])} signals")
    report = call(port, '/codegen/verify', {'project': project, 'blockIds': ['controller'], 'runId': result['id']}, timeout=300)
    if not report.get('ok'):
        raise SystemExit(f'Generated C did not verify: {json.dumps(report)[:1500]}')
    print(f"generated C compiled and matched the run over {report.get('steps')} steps")


if __name__ == '__main__':
    main()
