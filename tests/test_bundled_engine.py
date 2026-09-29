# SPDX-License-Identifier: Apache-2.0
"""The engine bundled with the installers: discovery, environment, status, and
the macOS VM's command agent (run here over TCP, without a VM)."""
import asyncio
import json
import os
import socket
import stat
import subprocess
import sys
import textwrap
import time
from pathlib import Path

import pytest

from server import engines

POSIX = pytest.mark.skipif(os.name == 'nt', reason='stand-in tools are POSIX scripts; the agent runs in a Linux VM')
AGENT = Path(__file__).resolve().parent.parent/'packaging'/'engine'/'guest'/'agent.py'

FAKE_OMC = textwrap.dedent('''\
    #!{python}
    import os, pathlib, sys
    if sys.argv[1:] == ['--version']:
        print('OpenModelica v1.27.1'); sys.exit(0)
    script = pathlib.Path(sys.argv[1]).read_text()
    pathlib.Path('seen-env.txt').write_text(os.environ.get('OPENMODELICALIBRARY', '') + '\\n' + os.environ.get('OPENMODELICAHOME', ''))
    pathlib.Path('seen-script.mos').write_text(script)
    print('true')
''')


def make_bundle(root: Path, manifest: dict) -> Path:
    (root/'bin').mkdir(parents=True)
    (root/'lib'/'omlibrary').mkdir(parents=True)
    (root/'manifest.json').write_text(json.dumps(manifest), encoding='utf-8')
    return root


def test_bundle_is_found_beside_app_resources(tmp_path, monkeypatch):
    make_bundle(tmp_path/'engine', {'platform': 'linux'})
    monkeypatch.delenv('GRADARA_ENGINE_BUNDLE', raising=False)
    monkeypatch.setenv('GRADARA_RESOURCES', str(tmp_path/'app-resources'))
    monkeypatch.setattr(engines, 'RESOURCES', tmp_path/'app-resources')
    assert engines.bundle_root() == tmp_path/'engine'
    # Source checkouts (no GRADARA_RESOURCES) never pick up a sibling folder by accident.
    monkeypatch.delenv('GRADARA_RESOURCES')
    assert engines.bundle_root() is None
    monkeypatch.setenv('GRADARA_ENGINE_BUNDLE', str(tmp_path/'engine'))
    assert engines.bundle_root() == tmp_path/'engine'


def test_macos_bundle_is_ignored_elsewhere(tmp_path, monkeypatch):
    make_bundle(tmp_path/'engine', {'platform': 'macos'})
    monkeypatch.setenv('GRADARA_ENGINE_BUNDLE', str(tmp_path/'engine'))
    monkeypatch.setattr(engines, 'TEST_AGENT', '')
    monkeypatch.setattr(engines.sys, 'platform', 'linux')
    assert engines.make_bundled() is None
    monkeypatch.setattr(engines.sys, 'platform', 'darwin')
    assert isinstance(engines.make_bundled(), engines.VmBackend)


@POSIX
def test_bundled_backend_uses_only_its_own_library_and_gcc(tmp_path, monkeypatch):
    root = make_bundle(tmp_path/'engine', {'platform': 'linux', 'library': 'lib/omlibrary', 'libraries': 'lib/x/omc'})
    omc = root/'bin'/'omc'
    omc.write_text(FAKE_OMC.format(python=sys.executable), encoding='utf-8')
    omc.chmod(omc.stat().st_mode | stat.S_IEXEC)
    monkeypatch.setenv('OMDEV', '/somewhere/else')
    backend = engines.BundledBackend(root)
    env = backend.environment(omc)
    assert env['OPENMODELICAHOME'] == str(root)
    assert env['OPENMODELICALIBRARY'] == str(root/'lib'/'omlibrary')
    assert env['PATH'].split(os.pathsep)[0] == str(root/'bin')
    assert env['LD_LIBRARY_PATH'].split(os.pathsep)[0] == str(root/'lib'/'x'/'omc')
    assert 'OMDEV' not in env
    folder = tmp_path/'run'
    folder.mkdir()
    asyncio.run(backend.script(omc, folder, backend._script_for(folder, {'duration': 1.0}), 10))
    script = (folder/'seen-script.mos').read_text(encoding='utf-8')
    assert script.startswith('setCompiler("gcc")'), 'bundles compile with gcc, not clang'
    assert (folder/'seen-env.txt').read_text(encoding='utf-8').splitlines()[0] == str(root/'lib'/'omlibrary')


@POSIX
def test_bundled_status_asks_for_gcc_when_missing(tmp_path, monkeypatch):
    root = make_bundle(tmp_path/'engine', {'platform': 'linux'})
    (root/'bin'/'omc').write_text('', encoding='utf-8')
    backend = engines.BundledBackend(root)
    monkeypatch.setattr(engines.shutil, 'which', lambda name: None)
    status = asyncio.run(backend.status())
    assert not status.ready and status.actions == ['install-gcc']


def test_bundled_is_the_default_when_present(monkeypatch, tmp_path):
    root = make_bundle(tmp_path/'engine', {'platform': 'linux'})
    backend = engines.BundledBackend(root)
    monkeypatch.setattr(engines, 'BUNDLED', backend)
    monkeypatch.setitem(engines.BACKENDS, 'bundled', backend)
    monkeypatch.delenv('GRADARA_ENGINE', raising=False)
    monkeypatch.setattr(engines.settings, 'load', lambda: {})
    assert engines.platform_default() == 'bundled'
    assert asyncio.run(engines.select()) is backend
    monkeypatch.setattr(engines.settings, 'load', lambda: {'engine': 'docker'})
    assert asyncio.run(engines.select()) is engines.DOCKER


def test_vm_paths_map_the_data_folder(tmp_path, monkeypatch):
    root = make_bundle(tmp_path/'engine', {'platform': 'macos'})
    backend = engines.VmBackend(root)
    backend.vm.shared = (tmp_path/'data').resolve()
    (tmp_path/'data'/'runs'/'abc').mkdir(parents=True)
    assert backend.engine_path(tmp_path/'data'/'runs'/'abc') == '/data/runs/abc'
    assert backend.engine_path(tmp_path/'data') == '/data'
    with pytest.raises(engines.EngineError):
        backend.engine_path(tmp_path/'elsewhere')
    script = backend._script_for(tmp_path/'data'/'runs'/'abc', {'duration': 2.0})
    assert 'cd("/data/runs/abc");' in script and script.startswith('setCompiler("gcc")')
    argv = backend.vm.argv()
    assert ',initrd=' in argv[argv.index('--bootloader') + 1], 'vfkit refuses a Linux boot without an initrd'
    assert argv[argv.index('--device', argv.index('--bootloader')) + 1].endswith(',readonly')
    assert any(a.startswith('virtio-fs,sharedDir=') and a.endswith(',mountTag=data') for a in argv)
    assert any(a.startswith('virtio-vsock,port=1024,') and a.endswith(',connect') for a in argv)


# ------------------------------------------------------------------ agent

def free_port() -> int:
    with socket.socket() as s:
        s.bind(('127.0.0.1', 0))
        return s.getsockname()[1]


@pytest.fixture
def agent():
    if os.name == 'nt':
        pytest.skip('the agent runs in the Linux VM')
    port = free_port()
    process = subprocess.Popen([sys.executable, str(AGENT)], env=dict(os.environ, GRADARA_AGENT_TCP=str(port)),
                               stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, start_new_session=True)
    deadline = time.monotonic() + 10
    while time.monotonic() < deadline:
        try:
            socket.create_connection(('127.0.0.1', port), 0.2).close()
            break
        except OSError:
            time.sleep(0.05)
    yield f'127.0.0.1:{port}'
    process.kill()
    process.wait()


def vm_for(address, monkeypatch, tmp_path):
    monkeypatch.setattr(engines, 'TEST_AGENT', address)
    return engines.EngineVM(tmp_path, {})


def test_agent_runs_commands_and_reports_exit_codes(agent, monkeypatch, tmp_path):
    vm = vm_for(agent, monkeypatch, tmp_path)
    assert asyncio.run(vm.ping())
    code, output = asyncio.run(vm.run(['sh', '-c', 'echo "$OPENMODELICALIBRARY"; pwd; exit 3'], str(tmp_path), 10))
    assert code == 3
    assert output.splitlines() == ['/opt/modelica', str(tmp_path)]
    code, output = asyncio.run(vm.run(['no-such-program-xyz'], str(tmp_path), 10))
    assert code == 127


def test_agent_enforces_timeouts(agent, monkeypatch, tmp_path):
    vm = vm_for(agent, monkeypatch, tmp_path)
    started = time.monotonic()
    with pytest.raises(asyncio.TimeoutError):
        asyncio.run(vm.run(['sh', '-c', f'sleep 30; touch {tmp_path}/late'], str(tmp_path), 1))
    assert time.monotonic() - started < 10
    time.sleep(0.5)
    assert not (tmp_path/'late').exists()


def test_cancelling_a_run_stops_the_command(agent, monkeypatch, tmp_path):
    vm = vm_for(agent, monkeypatch, tmp_path)

    async def cancel_soon():
        task = asyncio.create_task(vm.run(['sh', '-c', f'sleep 3; touch {tmp_path}/late'], str(tmp_path), 60))
        await asyncio.sleep(0.5)
        task.cancel()
        with pytest.raises(asyncio.CancelledError):
            await task

    asyncio.run(cancel_soon())
    time.sleep(4)
    assert not (tmp_path/'late').exists(), 'closing the connection kills the command'


def test_vm_errors_leave_out_vfkit_usage(tmp_path, monkeypatch):
    monkeypatch.setattr(engines, 'LOGS', tmp_path)
    (tmp_path/'engine-vm.log').write_text(
        'time="x" level=info msg="Adding virtio-rng device"\n'
        'Error: Error Domain=VZErrorDomain Code=2 Description="Virtualization is not available on this hardware."\n'
        'Usage:\n  vfkit [flags]\nFlags:\n  -c, --cpus uint               number of virtual CPUs (default 1)\n'
        '      --gui                     display the contents\n', encoding='utf-8')
    tail = engines.EngineVM(tmp_path, {})._log_tail()
    assert 'Virtualization is not available on this hardware' in tail
    assert '--cpus' not in tail and 'Usage' not in tail
