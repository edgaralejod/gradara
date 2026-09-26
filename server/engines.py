# SPDX-License-Identifier: Apache-2.0
"""OpenModelica execution backends.

Two interchangeable ways to run the same generated model:

* ``docker``: the pinned ``gradara-engine`` image (OpenModelica 1.27.0 and
  MSL 4.1.0), with no network, dropped capabilities, and resource limits.
* ``native``: an OpenModelica installation on the host (the official Windows
  installer, OpenModelica's Linux packages), driven by a generated ``.mos``
  script. Definitions are screened by ``safety.py`` before either backend runs.

``auto`` prefers a ready native install, then a ready Docker image, so an
installed desktop app works without Docker wherever OpenModelica exists.
"""
from __future__ import annotations

import asyncio
import glob
import json
import os
import re
import shutil
import subprocess
import sys
import time
from dataclasses import dataclass, field
from pathlib import Path

from . import settings
from .paths import RESOURCES, ROOT
from .processes import spawn_options, terminate_tree
from .runtime import IMAGE, LEGACY_IMAGE, colima_profile, docker_argv, docker_context

MSL_VERSION = '4.1.0'
OM_VERSION = '1.27.0'
REGISTRY_IMAGE = os.environ.get('GRADARA_ENGINE_IMAGE', 'ghcr.io/edgaralejod/gradara-engine:1.27.0')
SEMAPHORE = asyncio.Semaphore(2)
TIMEOUT = 120


class EngineError(RuntimeError):
    pass


@dataclass
class EngineStatus:
    backend: str
    ready: bool
    label: str
    detail: str = ''
    actions: list[str] = field(default_factory=list)
    version: str = ''

    def as_dict(self) -> dict:
        return {'backend': self.backend, 'ready': self.ready, 'label': self.label,
                'detail': self.detail, 'actions': self.actions, 'version': self.version}


async def _run(argv: list[str], timeout: float, cwd: Path | None = None, env: dict | None = None) -> tuple[int, str]:
    try:
        process = await asyncio.create_subprocess_exec(
            *argv, cwd=cwd, env=env, stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.STDOUT, **spawn_options())
    except OSError as exc:
        return 127, str(exc)
    try:
        output, _ = await asyncio.wait_for(process.communicate(), timeout)
    except (asyncio.CancelledError, asyncio.TimeoutError):
        await terminate_tree(process)
        raise
    return process.returncode or 0, output.decode(errors='replace')


# --------------------------------------------------------------------- docker

class DockerBackend:
    name = 'docker'
    # Docker probes can each take seconds when the runtime is stopped or busy.
    # Status polls reuse a recent answer instead of repeating them.
    PROBE_TTL = 20.0

    def __init__(self):
        self._probe: tuple[float, str, bool] | None = None

    def forget(self) -> None:
        self._probe = None

    async def _image_present(self, tag: str) -> bool:
        try:
            code, _ = await _run([*docker_argv(), 'image', 'inspect', tag], 8)
            return code == 0
        except asyncio.TimeoutError:
            return False

    async def cli_present(self) -> bool:
        return shutil.which('docker') is not None

    async def _daemon(self) -> str:
        """'ready', 'stopped', or 'windows' (Docker Desktop set to Windows containers)."""
        try:
            code, output = await _run([*docker_argv(), 'info', '--format', '{{.OSType}}'], 8)
        except asyncio.TimeoutError:
            return 'stopped'
        if code != 0:
            return 'stopped'
        return 'windows' if output.strip().lower() == 'windows' else 'ready'

    async def _image(self) -> bool:
        if await self._image_present(IMAGE):
            return True
        if await self._image_present(LEGACY_IMAGE):
            code, _ = await _run([*docker_argv(), 'tag', LEGACY_IMAGE, IMAGE], 8)
            return code == 0
        return False

    async def probe(self) -> tuple[str, bool]:
        """Daemon state and whether the engine image is present, cached briefly."""
        if not await self.cli_present():
            return 'missing', False
        now = time.monotonic()
        if self._probe and now - self._probe[0] < self.PROBE_TTL:
            return self._probe[1], self._probe[2]
        daemon = await self._daemon()
        image = daemon == 'ready' and await self._image()
        self._probe = (time.monotonic(), daemon, image)
        return daemon, image

    async def daemon_ready(self) -> bool:
        return (await self.probe())[0] == 'ready'

    async def available(self) -> bool:
        daemon, image = await self.probe()
        return daemon == 'ready' and image

    async def status(self) -> EngineStatus:
        daemon, image = await self.probe()
        if daemon == 'missing':
            return EngineStatus('docker', False, 'Docker is not installed',
                                'Install a Docker-compatible runtime (Docker Desktop, OrbStack, or Colima).',
                                ['install-docker'])
        if daemon == 'windows':
            return EngineStatus('docker', False, 'Docker is set to Windows containers',
                                'Switch Docker Desktop to Linux containers, then check again.')
        if daemon != 'ready':
            actions = ['start-runtime'] if sys.platform == 'darwin' and shutil.which('colima') else []
            return EngineStatus('docker', False, 'Docker is not running',
                                'Start your container runtime, then check again.', actions)
        if not image:
            return EngineStatus('docker', False, 'Engine image not prepared',
                                'Gradara downloads the OpenModelica engine image once (about 1-2 GB).',
                                ['prepare'])
        return EngineStatus('docker', True, f'OpenModelica {OM_VERSION} (container)', version=OM_VERSION)

    async def start_runtime(self, progress) -> None:
        if sys.platform == 'darwin' and shutil.which('colima'):
            progress('Starting Colima…')
            code, output = await _run(['colima', 'start', '--profile', colima_profile(docker_context()),
                                       '--cpu', '4', '--memory', '4', '--disk', '30', '--vm-type', 'vz',
                                       '--mount-type', 'virtiofs', '--activate=false'], 600)
            if code:
                raise EngineError('Colima could not start: ' + output[-1500:])
        else:
            raise EngineError('Start Docker Desktop, OrbStack, or your container runtime, then check again.')

    async def prepare(self, progress) -> None:
        self.forget()
        if not await self.daemon_ready():
            await self.start_runtime(progress)
            self.forget()
        if await self.available():
            return
        progress('Downloading the OpenModelica engine image…')
        code, output = await _run([*docker_argv(), 'pull', REGISTRY_IMAGE], 3600)
        if code == 0:
            code, output = await _run([*docker_argv(), 'tag', REGISTRY_IMAGE, IMAGE], 30)
            if code == 0:
                return
        dockerfile = RESOURCES/'Dockerfile.engine'
        if not dockerfile.exists():
            raise EngineError('The engine image could not be downloaded: ' + output[-1500:])
        progress('Building the OpenModelica engine image (first run only)…')
        uid = str(os.getuid()) if hasattr(os, 'getuid') else '1000'
        code, output = await _run([*docker_argv(), 'build', '-f', str(dockerfile), '--build-arg',
                                   f'ENGINE_UID={uid}', '-t', IMAGE, str(dockerfile.parent)], 3600)
        if code:
            raise EngineError('The engine image could not be built: ' + output[-2000:])

    async def execute(self, folder: Path, config: dict, name: str) -> dict:
        (folder/'request.json').write_text(json.dumps(config))
        shutil.copyfile(RESOURCES/'server'/'engine_runner.py', folder/'runner.py')
        command = [*docker_argv(), 'run', '--rm', '--name', name, '--network=none', '--cap-drop=ALL',
                   '--security-opt=no-new-privileges', '--pids-limit=256', '--memory=2g', '--cpus=2',
                   '-v', f'{folder}:/work', '-w', '/work', IMAGE, 'python3', '/work/runner.py']
        process = await asyncio.create_subprocess_exec(*command, stdout=asyncio.subprocess.PIPE,
                                                       stderr=asyncio.subprocess.STDOUT, **spawn_options(False))
        try:
            output, _ = await asyncio.wait_for(process.communicate(), TIMEOUT)
        except (asyncio.CancelledError, asyncio.TimeoutError) as exc:
            cleanup = await asyncio.create_subprocess_exec(*docker_argv(), 'rm', '-f', name,
                                                           stdout=asyncio.subprocess.DEVNULL,
                                                           stderr=asyncio.subprocess.DEVNULL, **spawn_options(False))
            await cleanup.wait()
            if process.returncode is None:
                process.kill()
            await process.wait()
            if isinstance(exc, asyncio.TimeoutError):
                raise EngineError(timeout_message()) from exc
            raise
        (folder/'engine.log').write_bytes(output)
        report = folder/'engine.json'
        if not report.exists():
            raise EngineError(output.decode(errors='replace')[-5000:] or 'The numerical engine could not start.')
        data = json.loads(report.read_text())
        data.setdefault('engine', f'OpenModelica {OM_VERSION}')
        return data

    async def compile_c(self, folder: Path, source: str) -> tuple[int, str]:
        return await _run([*docker_argv(), 'run', '--rm', '--network=none', '--cap-drop=ALL',
                           '--security-opt=no-new-privileges', '--memory=512m', '--pids-limit=64',
                           '-v', f'{folder}:/work', '-w', '/work', IMAGE, 'gcc', '-std=c11', '-Wall',
                           '-Wextra', '-Werror', '-c', source, '-o', Path(source).stem + '.o'], 45)


def timeout_message() -> str:
    return ('OpenModelica exceeded the 120-second execution limit. Try a shorter duration or check '
            'stiff equations and initial conditions.')


# --------------------------------------------------------------------- native

def _om_candidates() -> list[Path]:
    exe = 'omc.exe' if os.name == 'nt' else 'omc'
    found: list[Path] = []
    if os.environ.get('GRADARA_OMC'):
        found.append(Path(os.environ['GRADARA_OMC']))
    if os.environ.get('OPENMODELICAHOME'):
        found.append(Path(os.environ['OPENMODELICAHOME'])/'bin'/exe)
    on_path = shutil.which('omc')
    if on_path:
        found.append(Path(on_path))
    if os.name == 'nt':
        roots = [os.environ.get('ProgramFiles', r'C:\Program Files'), os.environ.get('LOCALAPPDATA', '')]
        for root in roots:
            if root:
                found += [Path(p) for p in sorted(glob.glob(os.path.join(root, 'OpenModelica*', 'bin', exe)), reverse=True)]
    elif sys.platform == 'darwin':
        found += [Path('/opt/openmodelica/bin/omc'), Path('/opt/homebrew/bin/omc'), Path('/usr/local/bin/omc')]
    else:
        found += [Path('/usr/bin/omc'), Path('/usr/local/bin/omc')]
    seen, unique = set(), []
    for path in found:
        if path not in seen and path.exists():
            seen.add(path)
            unique.append(path)
    return unique


def _mos_path(path: Path) -> str:
    """A path usable inside a .mos string literal (forward slashes, no spaces on Windows)."""
    text = str(path)
    if os.name == 'nt' and ' ' in text:
        try:
            import ctypes
            buffer = ctypes.create_unicode_buffer(32768)
            if ctypes.windll.kernel32.GetShortPathNameW(text, buffer, len(buffer)):  # type: ignore[attr-defined]
                text = buffer.value
        except Exception:
            pass
    return text.replace('\\', '/').replace('"', '\\"')


RESULT_FIELD = re.compile(r'(\w+) = "((?:[^"\\]|\\.)*)"', re.S)


class NativeBackend:
    name = 'native'

    def __init__(self):
        self._library_ready: dict[str, bool] = {}
        self._versions: dict[str, str] = {}
        self._library_checked: dict[str, float] = {}

    def omc(self) -> Path | None:
        candidates = _om_candidates()
        return candidates[0] if candidates else None

    def environment(self, omc: Path) -> dict:
        env = dict(os.environ)
        home = omc.parent.parent
        if os.name == 'nt' and not env.get('OPENMODELICAHOME'):
            env['OPENMODELICAHOME'] = str(home)
        return env

    async def version(self, omc: Path) -> str:
        cached = self._versions.get(str(omc))
        if cached:
            return cached
        try:
            code, output = await _run([str(omc), '--version'], 20)
        except asyncio.TimeoutError:
            return ''
        match = re.search(r'v?(\d+\.\d+\.\d+)', output)
        version = match.group(1) if code == 0 and match else ''
        if version:
            self._versions[str(omc)] = version
        return version

    async def script(self, omc: Path, folder: Path, body: str, timeout: float) -> tuple[int, str]:
        script = folder/'gradara.mos'
        script.write_text(body)
        return await _run([str(omc), script.name], timeout, cwd=folder, env=self.environment(omc))

    async def library_ready(self, omc: Path) -> bool:
        key = str(omc)
        if self._library_ready.get(key):
            return True
        # Loading MSL takes seconds; do not repeat a failed check on every health poll.
        checked = self._library_checked.get(key)
        if checked is not None and time.monotonic() - checked < 60:
            return False
        self._library_checked[key] = time.monotonic()
        from .paths import DATA
        folder = DATA/'engine-check'
        folder.mkdir(parents=True, exist_ok=True)
        try:
            _, output = await self.script(omc, folder, f'loadModel(Modelica, {{"{MSL_VERSION}"}});\ngetErrorString();\n', 90)
        except asyncio.TimeoutError:
            return False
        ready = output.lstrip().startswith('true')
        self._library_ready[key] = ready
        return ready

    async def available(self) -> bool:
        omc = self.omc()
        return bool(omc) and await self.library_ready(omc)

    async def status(self) -> EngineStatus:
        omc = self.omc()
        if omc is None:
            return EngineStatus('native', False, 'OpenModelica is not installed', install_hint(), ['install-openmodelica'])
        version = await self.version(omc)
        if not version:
            return EngineStatus('native', False, 'OpenModelica could not start', f'{omc} did not report a version.', ['install-openmodelica'])
        if not await self.library_ready(omc):
            return EngineStatus('native', False, f'Modelica Standard Library {MSL_VERSION} is missing',
                                'Gradara installs it once through OpenModelica (network required).', ['prepare'], version)
        detail = '' if version.startswith('1.27') else f'Gradara is validated with OpenModelica {OM_VERSION}.'
        return EngineStatus('native', True, f'OpenModelica {version}', detail, version=version)

    async def prepare(self, progress) -> None:
        omc = self.omc()
        if omc is None:
            raise EngineError('Install OpenModelica first. ' + install_hint())
        from .paths import DATA
        folder = DATA/'engine-check'
        folder.mkdir(parents=True, exist_ok=True)
        progress(f'Installing Modelica Standard Library {MSL_VERSION}…')
        code, output = await self.script(
            omc, folder, f'installPackage(Modelica, "{MSL_VERSION}", exactMatch=true);\ngetErrorString();\n', 1800)
        self._library_ready.pop(str(omc), None)
        self._library_checked.pop(str(omc), None)
        if code or not output.lstrip().startswith('true') or not await self.library_ready(omc):
            raise EngineError('OpenModelica could not install the Modelica Standard Library: ' + output[-1500:])

    def _script_for(self, folder: Path, config: dict) -> str:
        lines = [
            f'cd("{_mos_path(folder)}");',
            f'gLoad := loadModel(Modelica, {{"{MSL_VERSION}"}});',
            'writeFile("om_load.txt", String(gLoad));',
            'writeFile("om_load_errors.txt", getErrorString());',
            'gFile := loadFile("model.mo");',
            'writeFile("om_file.txt", String(gFile));',
            'writeFile("om_file_errors.txt", getErrorString());',
        ]
        if config.get('checkOnly'):
            lines += ['gCheck := checkModel(Gradara.Component);',
                      'writeFile("om_check.txt", gCheck);',
                      'writeFile("om_check_errors.txt", getErrorString());']
        else:
            lines += [f'gRes := simulate(Gradara.System, startTime=0, stopTime={float(config["duration"])!r}, '
                      'numberOfIntervals=6000, tolerance=1e-6, method="dassl", outputFormat="csv", '
                      'fileNamePrefix="simulation");',
                      'gRes;',
                      'writeFile("om_result.txt", gRes.resultFile);',
                      'writeFile("om_messages.txt", gRes.messages);',
                      'writeFile("om_sim_errors.txt", getErrorString());']
        return '\n'.join(lines) + '\n'

    async def execute(self, folder: Path, config: dict, name: str) -> dict:
        omc = self.omc()
        if omc is None:
            raise EngineError('OpenModelica is not installed. ' + install_hint())
        (folder/'request.json').write_text(json.dumps(config))
        try:
            code, output = await self.script(omc, folder, self._script_for(folder, config), TIMEOUT)
        except asyncio.TimeoutError as exc:
            raise EngineError(timeout_message()) from exc
        (folder/'engine.log').write_text(output)
        report = parse_native(folder, config, output)
        report['engine'] = f'OpenModelica {await self.version(omc) or "(native)"}'
        (folder/'engine.json').write_text(json.dumps(report))
        if report.get('error'):
            raise EngineError(report['error'])
        return report

    def gcc(self) -> str | None:
        omc = self.omc()
        if os.name == 'nt' and omc is not None:
            home = omc.parent.parent
            for candidate in ('tools/msys/ucrt64/bin/gcc.exe', 'tools/msys/mingw64/bin/gcc.exe'):
                if (home/candidate).exists():
                    return str(home/candidate)
        return shutil.which('gcc') or shutil.which('cc')

    async def compile_c(self, folder: Path, source: str) -> tuple[int, str]:
        compiler = self.gcc()
        if compiler is None:
            return 127, 'No C compiler was found for the compile check. Install a C compiler (gcc or clang).'
        return await _run([compiler, '-std=c11', '-Wall', '-Wextra', '-Werror', '-c', source, '-o',
                           Path(source).stem + '.o'], 45, cwd=folder)


def _read(folder: Path, name: str) -> str:
    try:
        return (folder/name).read_text(errors='replace').strip()
    except OSError:
        return ''


def parse_native(folder: Path, config: dict, output: str) -> dict:
    """Build the same report shape the container runner writes."""
    def fail(*parts: str) -> dict:
        log = _read(folder, 'simulation.log')
        text = '\n'.join(dict.fromkeys(p for p in [*parts, log[-8000:]] if p))
        return {'error': text or 'OpenModelica did not complete the simulation. Check equations, initial conditions, and input connections.'}

    if _read(folder, 'om_load.txt') != 'true':
        return fail(_read(folder, 'om_load_errors.txt') or f'Modelica Standard Library {MSL_VERSION} could not be loaded.', output[-3000:])
    if _read(folder, 'om_file.txt') != 'true':
        return fail(_read(folder, 'om_file_errors.txt') or 'The generated model could not be parsed.')
    if config.get('checkOnly'):
        value, error = _read(folder, 'om_check.txt'), _read(folder, 'om_check_errors.txt')
        if not value or 'Error:' in error:
            return {'error': error or 'The component did not pass compilation checks.'}
        return {'checked': True, 'message': value}
    result_file, messages = _read(folder, 'om_result.txt'), _read(folder, 'om_messages.txt')
    if not result_file:
        # Older omc builds may not expose record fields to writeFile; parse the echoed record.
        fields = dict(RESULT_FIELD.findall(output))
        result_file, messages = fields.get('resultFile', ''), messages or fields.get('messages', '')
    errors = _read(folder, 'om_sim_errors.txt')
    if not result_file or 'The simulation finished successfully.' not in messages:
        return fail(errors, messages)
    return {'result': {'resultFile': result_file, 'messages': messages}, 'diagnostics': errors}


def install_hint() -> str:
    if os.name == 'nt':
        return 'Download and run the official OpenModelica installer for Windows, then return to Gradara.'
    if sys.platform == 'darwin':
        return 'OpenModelica does not publish macOS builds; use the container engine on macOS.'
    return ('Install OpenModelica from its Linux packages (see openmodelica.org/download/download-linux), '
            'or use the container engine.')


# ------------------------------------------------------------------ selection

DOCKER = DockerBackend()
NATIVE = NativeBackend()
BACKENDS = {'docker': DOCKER, 'native': NATIVE}


def preference() -> str:
    choice = os.environ.get('GRADARA_ENGINE') or settings.load().get('engine') or 'auto'
    return choice if choice in {'auto', 'native', 'docker'} else 'auto'


def platform_default() -> str:
    """The backend a new user should set up on this OS."""
    return 'docker' if sys.platform == 'darwin' else 'native'


async def select() -> DockerBackend | NativeBackend:
    choice = preference()
    if choice != 'auto':
        return BACKENDS[choice]
    if NATIVE.omc() is not None and await NATIVE.available():
        return NATIVE
    if await DOCKER.cli_present() and await DOCKER.available():
        return DOCKER
    if NATIVE.omc() is not None:
        return NATIVE
    if await DOCKER.cli_present():
        return DOCKER
    return BACKENDS[platform_default()]


async def status(refresh: bool = False) -> dict:
    if refresh:
        NATIVE._library_checked.clear()
        DOCKER.forget()
    backend = await select()
    current = await backend.status()
    return {'preference': preference(), 'platform': sys.platform, 'recommended': platform_default(),
            **current.as_dict()}


async def available() -> bool:
    return await (await select()).available()


async def execute(folder: Path, config: dict, name: str) -> dict:
    folder.mkdir(parents=True, exist_ok=True)
    backend = await select()
    async with SEMAPHORE:
        return await backend.execute(folder, config, name)


async def compile_c(folder: Path, source: str) -> tuple[int, str]:
    return await (await select()).compile_c(folder, source)


async def prepare(progress=lambda message: None) -> dict:
    backend = await select()
    try:
        await backend.prepare(progress)
    finally:
        DOCKER.forget()
    return await status()


__all__ = ['EngineError', 'execute', 'available', 'status', 'prepare', 'compile_c', 'select',
           'DOCKER', 'NATIVE', 'ROOT', 'subprocess']
