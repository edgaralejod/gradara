# SPDX-License-Identifier: Apache-2.0
"""Launch an installed Gradara app in self-test mode and check the result.

The app starts its bundled service, loads the workbench, creates a model,
writes a JSON report, and quits. This script then confirms the report passed
and that no service process was left running.

    python packaging/installer_selftest.py --exe "/Applications/Gradara.app/Contents/MacOS/Gradara"
    xvfb-run -a python packaging/installer_selftest.py --exe /opt/Gradara/gradara
    python packaging/installer_selftest.py --exe "$LOCALAPPDATA/Programs/Gradara/Gradara.exe"

Extra arguments after `--` go to the app (for example `-- --no-sandbox`).
"""
from __future__ import annotations

import argparse
import json
import os
import signal
import subprocess
import sys
import tempfile
import time
from pathlib import Path

WINDOWS = os.name == 'nt'
SERVICE = 'gradara-backend.exe' if WINDOWS else 'gradara-backend'


def pid_alive(pid: int) -> bool:
    if WINDOWS:
        out = subprocess.run(['tasklist', '/FI', f'PID eq {pid}', '/NH'], capture_output=True, text=True).stdout
        return str(pid) in out
    try:
        os.kill(pid, 0)
    except ProcessLookupError:
        return False
    except PermissionError:
        return True
    # A zombie still answers kill(0); treat it as gone.
    try:
        state = Path(f'/proc/{pid}/stat').read_text().split(')')[-1].split()[0]
        return state != 'Z'
    except OSError:
        return True


def running_services() -> list[str]:
    if WINDOWS:
        out = subprocess.run(['tasklist', '/FI', f'IMAGENAME eq {SERVICE}', '/NH'], capture_output=True, text=True).stdout
        return [line for line in out.splitlines() if SERVICE.lower() in line.lower()]
    out = subprocess.run(['ps', '-axo', 'pid=,stat=,comm='], capture_output=True, text=True).stdout
    found = []
    for line in out.splitlines():
        parts = line.split(None, 2)
        if len(parts) < 3:
            continue
        pid, state, command = parts
        # Match the executable name only (Linux truncates comm to 15 characters);
        # exited processes waiting to be reaped (state Z) are not running.
        if Path(command.strip()).name.startswith(SERVICE[:15]) and not state.startswith('Z'):
            found.append(f'{pid} {command.strip()}')
    return found


def kill_tree(process: subprocess.Popen) -> None:
    if WINDOWS:
        subprocess.run(['taskkill', '/PID', str(process.pid), '/T', '/F'], capture_output=True)
    else:
        try:
            os.killpg(process.pid, signal.SIGKILL)
        except OSError:
            process.kill()


def show_service_log(report: dict) -> None:
    user_data = report.get('userData')
    if not user_data:
        return
    log = Path(user_data)/'logs'/'service.log'
    if log.exists():
        print(f'--- last lines of {log} ---')
        print('\n'.join(log.read_text(errors='replace').splitlines()[-60:]))


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument('--exe', required=True, help='Path to the installed Gradara executable')
    parser.add_argument('--timeout', type=int, default=300)
    parser.add_argument('--report', help='Where to keep the JSON report (default: a temporary file)')
    parser.add_argument('app_args', nargs='*')
    args = parser.parse_args()

    exe = Path(args.exe)
    if not exe.exists():
        print(f'FAIL: {exe} does not exist.')
        return 1
    report_path = Path(args.report) if args.report else Path(tempfile.mkdtemp(prefix='gradara-selftest-'))/'report.json'
    report_path.unlink(missing_ok=True)
    env = dict(os.environ, GRADARA_SELF_TEST_REPORT=str(report_path), GRADARA_DISABLE_UPDATES='1',
               GRADARA_CREDENTIAL_STORE='file', ELECTRON_ENABLE_LOGGING='1')

    print(f'Launching {exe}')
    started = time.monotonic()
    process = subprocess.Popen([str(exe), *args.app_args], env=env, start_new_session=not WINDOWS)
    try:
        code = process.wait(timeout=args.timeout)
    except subprocess.TimeoutExpired:
        kill_tree(process)
        print(f'FAIL: the app did not finish its self-test within {args.timeout} seconds.')
        return 1
    print(f'App exited with code {code} after {time.monotonic() - started:.1f}s')

    if not report_path.exists():
        print('FAIL: the app exited without writing a self-test report.')
        return 1
    report = json.loads(report_path.read_text())
    print(json.dumps(report, indent=2))
    if not report.get('ok'):
        show_service_log(report)
        print(f"FAIL: self-test reported: {report.get('error', 'unknown error')}")
        return 1

    pid = report.get('backendPid')
    deadline = time.monotonic() + 20
    while ((pid and pid_alive(pid)) or running_services()) and time.monotonic() < deadline:
        time.sleep(0.5)
    if pid and pid_alive(pid):
        print(f'FAIL: the local service (pid {pid}) is still running after the app quit.')
        return 1
    leftovers = running_services()
    if leftovers:
        print('FAIL: service processes still running:\n' + '\n'.join(leftovers))
        return 1
    print('PASS: installed app started its service, rendered the workbench, created a model, and shut down cleanly.')
    return 0


if __name__ == '__main__':
    sys.exit(main())
