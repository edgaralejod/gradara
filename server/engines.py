# SPDX-License-Identifier: Apache-2.0
"""OpenModelica execution backends.

Interchangeable ways to run the same generated model:

* ``bundled``: the engine that ships inside the desktop installers
  (``resources/engine``). On Windows and Linux it is a trimmed OpenModelica
  tree with the Modelica Standard Library preinstalled, run like a native
  install. On macOS it is a small Linux VM (vfkit on Apple's Virtualization
  framework) that runs the same commands on the shared data folder.
* ``native``: an OpenModelica installation on the host (the official Windows
  installer, OpenModelica's Linux packages), driven by a generated ``.mos``
  script.
* ``docker``: the pinned ``gradara-engine`` image (OpenModelica 1.27.0 and
  MSL 4.1.0), with no network, dropped capabilities, and resource limits.

Definitions are screened by ``safety.py`` before any backend runs. ``auto``
uses the bundled engine when the app has one, and otherwise prefers a ready
native install, then a ready Docker image.
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
import tempfile
import time
from dataclasses import dataclass, field
from pathlib import Path

from . import settings
from .paths import DATA, LOGS, RESOURCES, ROOT
from .processes import spawn_options, terminate_tree
from .runtime import IMAGE, LEGACY_IMAGE, colima_profile, docker_argv, docker_context
from .solver import simulate_expression

MSL_VERSION = '4.1.0'
# The version the bundled engine ships and the one results are validated with.
OM_VERSION = '1.27.1'
# The Docker image still carries the version it was published with.
DOCKER_OM_VERSION = '1.27.0'
REGISTRY_IMAGE = os.environ.get('GRADARA_ENGINE_IMAGE', 'ghcr.io/edgaralejod/gradara-engine:1.27.0')
SEMAPHORE = asyncio.Semaphore(2)
TIMEOUT = 120


class EngineError(RuntimeError):
    pass


class EngineTimeout(EngineError):
    """A run that exceeded the execution limit: the model's or its settings' problem, not the engine's."""


def _no_error_dialogs() -> None:
    """On Windows, make a missing DLL or a crash end the process with an error code.

    By default Windows shows a dialog and waits for someone to close it, which
    would leave a simulation hanging until its timeout. Child processes (omc,
    make, gcc, the compiled model) inherit this error mode.
    """
    if os.name != 'nt':
        return
    try:
        import ctypes
        SEM_FAILCRITICALERRORS, SEM_NOGPFAULTERRORBOX, SEM_NOOPENFILEERRORBOX = 0x0001, 0x0002, 0x8000
        ctypes.windll.kernel32.SetErrorMode(SEM_FAILCRITICALERRORS | SEM_NOGPFAULTERRORBOX | SEM_NOOPENFILEERRORBOX)  # type: ignore[attr-defined]
    except Exception:
        pass


_no_error_dialogs()


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
        # The runtime may have changed (OrbStack started, Colima profile created).
        docker_context.cache_clear()

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
        return EngineStatus('docker', True, f'OpenModelica {DOCKER_OM_VERSION} (container)', version=DOCKER_OM_VERSION)

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
        (folder/'request.json').write_text(json.dumps(config), encoding='utf-8')
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
                raise EngineTimeout(timeout_message()) from exc
            raise
        (folder/'engine.log').write_bytes(output)
        report = folder/'engine.json'
        if not report.exists():
            raise EngineError(output.decode(errors='replace')[-5000:] or 'The numerical engine could not start.')
        data = json.loads(report.read_text(encoding='utf-8'))
        data.setdefault('engine', f'OpenModelica {DOCKER_OM_VERSION}')
        return data

    async def compile_c(self, folder: Path, source: str) -> tuple[int, str]:
        return await _run([*docker_argv(), 'run', '--rm', '--network=none', '--cap-drop=ALL',
                           '--security-opt=no-new-privileges', '--memory=512m', '--pids-limit=64',
                           '-v', f'{folder}:/work', '-w', '/work', IMAGE, 'gcc', '-std=c11', '-Wall',
                           '-Wextra', '-Werror', '-c', source, '-o', Path(source).stem + '.o'], 45)

    async def run_c(self, folder: Path, sources: list[str]) -> tuple[int, str]:
        """Compile `sources` into a host program and run it once in `folder` (software-in-the-loop check)."""
        script = 'gcc -std=c11 -O1 -o sil ' + ' '.join(sources) + ' -lm && ./sil'
        return await _run([*docker_argv(), 'run', '--rm', '--network=none', '--cap-drop=ALL',
                           '--security-opt=no-new-privileges', '--memory=512m', '--pids-limit=64',
                           '-v', f'{folder}:/work', '-w', '/work', IMAGE, 'sh', '-c', script], 90)


def timeout_message() -> str:
    return f'The simulation did not finish within the {TIMEOUT}-second limit.'


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


def _mos_path(path: Path | str) -> str:
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
    # Lines added before a simulation script (the bundled Linux engine and the
    # macOS VM compile with gcc; OpenModelica's Linux default is clang).
    COMPILER_SETUP = ''

    def __init__(self):
        self._library_ready: dict[str, bool] = {}
        self._versions: dict[str, str] = {}
        self._library_checked: dict[str, float] = {}
        self._library_locks: dict[str, tuple[asyncio.AbstractEventLoop, asyncio.Lock]] = {}

    def omc(self) -> Path | None:
        candidates = _om_candidates()
        return candidates[0] if candidates else None

    def environment(self, omc: Path) -> dict:
        env = dict(os.environ)
        home = omc.parent.parent
        if os.name == 'nt' and not env.get('OPENMODELICAHOME'):
            env['OPENMODELICAHOME'] = str(home)
        return env

    async def command(self, argv: list[str], timeout: float, cwd: Path | None = None) -> tuple[int, str]:
        """Run one engine command (omc, gcc, a compiled program) where the engine lives."""
        omc = self.omc()
        env = self.environment(omc) if omc is not None else None
        return await _run([str(a) for a in argv], timeout, cwd=cwd, env=env)

    def engine_path(self, path: Path) -> str:
        """`path` as the engine sees it (the macOS VM mounts the data folder elsewhere)."""
        return str(path)

    async def version(self, omc: Path) -> str:
        cached = self._versions.get(str(omc))
        if cached:
            return cached
        try:
            code, output = await self.command([str(omc), '--version'], 20)
        except asyncio.TimeoutError:
            return ''
        match = re.search(r'v?(\d+\.\d+\.\d+)', output)
        version = match.group(1) if code == 0 and match else ''
        if version:
            self._versions[str(omc)] = version
        return version

    async def script(self, omc: Path, folder: Path, body: str, timeout: float) -> tuple[int, str]:
        script = folder/'gradara.mos'
        script.write_text(body, encoding='utf-8')
        return await self.command([str(omc), script.name], timeout, cwd=folder)

    def _library_lock(self, key: str) -> asyncio.Lock:
        # One lock per event loop (a lock is bound to the loop that first waits on it).
        loop = asyncio.get_running_loop()
        held = self._library_locks.get(key)
        if held is None or held[0] is not loop:
            held = self._library_locks[key] = (loop, asyncio.Lock())
        return held[1]

    async def library_ready(self, omc: Path) -> bool:
        key = str(omc)
        if self._library_ready.get(key):
            return True
        # Loading MSL takes seconds. Callers that arrive while a check runs (the
        # app's engine poll and a run request after the macOS VM boots, say) wait
        # for its answer instead of reading the check as failed; a check that did
        # fail is not repeated on every health poll for a minute.
        async with self._library_lock(key):
            if self._library_ready.get(key):
                return True
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
            *([self.COMPILER_SETUP] if self.COMPILER_SETUP else []),
            f'cd("{_mos_path(self.engine_path(folder))}");',
            f'gLoad := loadModel(Modelica, {{"{MSL_VERSION}"}});',
            'writeFile("om_load.txt", String(gLoad));',
            'writeFile("om_load_errors.txt", getErrorString());',
            'gFile := loadFile("model.mo");',
            'writeFile("om_file.txt", String(gFile));',
            'writeFile("om_file_errors.txt", getErrorString());',
        ]
        if config.get('checkOnly'):
            target = {'component': 'Gradara.Component', 'system': 'Gradara.System'}[config.get('checkTarget', 'component')]
            lines += [f'gCheck := checkModel({target});',
                      'writeFile("om_check.txt", gCheck);',
                      'writeFile("om_check_errors.txt", getErrorString());']
        else:
            lines += [f'gRes := {config.get("simulate") or simulate_expression(float(config["duration"]), None)};',
                      # Read the compiler's errors first: later calls can clear them.
                      'gErrors := getErrorString();',
                      'gRes;',
                      'writeFile("om_result.txt", gRes.resultFile);',
                      'writeFile("om_messages.txt", gRes.messages);',
                      'writeFile("om_sim_errors.txt", gErrors);']
        return '\n'.join(lines) + '\n'

    async def execute(self, folder: Path, config: dict, name: str) -> dict:
        omc = self.omc()
        if omc is None:
            raise EngineError('OpenModelica is not installed. ' + install_hint())
        (folder/'request.json').write_text(json.dumps(config), encoding='utf-8')
        try:
            code, output = await self.script(omc, folder, self._script_for(folder, config), TIMEOUT)
        except asyncio.TimeoutError as exc:
            raise EngineTimeout(timeout_message()) from exc
        (folder/'engine.log').write_text(output, encoding='utf-8')
        report = parse_native(folder, config, output)
        report['engine'] = f'OpenModelica {await self.version(omc) or "(native)"}'
        (folder/'engine.json').write_text(json.dumps(report), encoding='utf-8')
        # A library that will not load is an engine problem; anything later is the model's own
        # failure, reported like the Docker backend's so diagnostics can explain it.
        if report.get('error') and _read(folder, 'om_load.txt') != 'true':
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
        return await self.command([compiler, '-std=c11', '-Wall', '-Wextra', '-Werror', '-c', source, '-o',
                                   Path(source).stem + '.o'], 45, cwd=folder)

    def program_name(self) -> str:
        return 'sil.exe' if os.name == 'nt' else 'sil'

    async def run_c(self, folder: Path, sources: list[str]) -> tuple[int, str]:
        compiler = self.gcc()
        if compiler is None:
            return 127, 'No C compiler was found for the verification. Install a C compiler (gcc or clang).'
        program = folder/self.program_name()
        code, output = await self.command([compiler, '-std=c11', '-O1', '-o', program.name, *sources, '-lm'], 60, cwd=folder)
        if code:
            return code, output
        return await self.command([self.engine_path(program)], 60, cwd=folder)


def _read(folder: Path, name: str) -> str:
    try:
        return (folder/name).read_text(errors='replace', encoding='utf-8').strip()
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



# -------------------------------------------------------------------- bundled

def bundle_root() -> Path | None:
    """The engine shipped with the app (`resources/engine`), if this build has one."""
    configured = os.environ.get('GRADARA_ENGINE_BUNDLE')
    candidates = [Path(configured)] if configured else []
    # Installed apps: resources/engine beside resources/app-resources (GRADARA_RESOURCES).
    if os.environ.get('GRADARA_RESOURCES'):
        candidates.append(RESOURCES.parent/'engine')
    for candidate in candidates:
        if (candidate/'manifest.json').is_file():
            return candidate
    return None


def bundle_manifest(root: Path) -> dict:
    try:
        return json.loads((root/'manifest.json').read_text(encoding='utf-8'))
    except (OSError, ValueError):
        return {}


class BundledBackend(NativeBackend):
    """The OpenModelica tree inside the Windows and Linux installers."""
    name = 'bundled'

    def __init__(self, root: Path):
        super().__init__()
        self.root = root
        self.manifest = bundle_manifest(root)
        # OpenModelica defaults to clang (Windows: MSYS2's, Linux: the system's); the
        # bundle carries gcc on Windows, and the .deb depends on gcc on Linux.
        self.COMPILER_SETUP = 'setCompiler("gcc");' if os.name == 'nt' else 'setCompiler("gcc"); setCXXCompiler("g++");'

    def omc(self) -> Path | None:
        path = self.root/'bin'/('omc.exe' if os.name == 'nt' else 'omc')
        return path if path.exists() else None

    def library_dir(self) -> Path:
        return self.root/self.manifest.get('library', 'lib/omlibrary')

    def environment(self, omc: Path) -> dict:
        env = dict(os.environ)
        env['OPENMODELICAHOME'] = str(self.root)
        # Only the bundled library, so another OpenModelica's packages never change results.
        env['OPENMODELICALIBRARY'] = str(self.library_dir())
        path = [self.root/'bin']
        if os.name == 'nt':
            # gcc's helper programs load their DLLs from the toolchain's bin folder.
            path.append(self.root/'tools'/'msys'/'ucrt64'/'bin')
        env['PATH'] = os.pathsep.join([*map(str, path), env.get('PATH', '')])
        if sys.platform.startswith('linux'):
            libs = str(self.root/self.manifest.get('libraries', 'lib'))
            env['LD_LIBRARY_PATH'] = libs + (os.pathsep + env['LD_LIBRARY_PATH'] if env.get('LD_LIBRARY_PATH') else '')
        # A user's OMDEV points Compile.bat at another toolchain.
        env.pop('OMDEV', None)
        return env

    def gcc(self) -> str | None:
        if os.name == 'nt':
            candidate = self.root/'tools'/'msys'/'ucrt64'/'bin'/'gcc.exe'
            return str(candidate) if candidate.exists() else None
        return shutil.which('gcc') or shutil.which('cc')

    async def status(self) -> EngineStatus:
        omc = self.omc()
        if omc is None:
            return EngineStatus('bundled', False, 'The built-in engine is incomplete',
                                'Reinstall Gradara to restore it.', [])
        if os.name != 'nt' and self.gcc() is None:
            return EngineStatus('bundled', False, 'A C compiler is needed',
                                'OpenModelica compiles each model to a program with gcc. Install it '
                                '(on Debian or Ubuntu: sudo apt install gcc), then check again.', ['install-gcc'])
        version = await self.version(omc)
        if not version:
            return EngineStatus('bundled', False, 'The built-in engine could not start',
                                f'{omc} did not report a version. Reinstall Gradara, or see the service log.', [])
        if not await self.library_ready(omc):
            return EngineStatus('bundled', False, 'The built-in engine could not load its library',
                                f'Modelica Standard Library {MSL_VERSION} did not load. Reinstall Gradara.', [], version)
        return EngineStatus('bundled', True, f'OpenModelica {version} (built in)', version=version)

    async def prepare(self, progress) -> None:
        # Nothing to download: report what is wrong instead.
        self._library_checked.clear()
        status = await self.status()
        if not status.ready:
            raise EngineError(f'{status.label}. {status.detail}')


# Tests only: reach the guest agent over TCP (the guest image run under Docker with
# GRADARA_AGENT_TCP and the data folder mounted at /data) instead of booting a VM.
TEST_AGENT = os.environ.get('GRADARA_ENGINE_VM_TCP', '')


class EngineVM:
    """The macOS engine VM: vfkit boots a Linux kernel and a read-only root
    filesystem, shares the data folder over virtio-fs, and exposes the guest's
    command agent (vsock) as a Unix socket."""

    # Seconds; a Mac boots it in a few, nested-virtualization CI runners take far longer.
    BOOT_TIMEOUT = 240

    def __init__(self, root: Path, manifest: dict):
        self.root = root
        self.manifest = manifest
        self.process: asyncio.subprocess.Process | None = None
        self._lock: tuple[asyncio.AbstractEventLoop, asyncio.Lock] | None = None
        self.error = ''
        self.boot_seconds: float | None = None
        self.shared = DATA.resolve()

    # Characters vfkit passes through unchanged in a socketURL. The data folder
    # normally fails this ("~/Library/Application Support/..."): vfkit
    # percent-encodes the space and then binds to the encoded path, which does
    # not exist, so the app never reaches the agent.
    SAFE_SOCKET_PATH = re.compile(r'^[A-Za-z0-9_./-]+$')

    def runtime_dir(self) -> Path:
        folder = DATA/'engine-vm'
        socket = str(folder/'agent.sock')
        # macOS limits Unix socket paths to 104 bytes.
        if len(socket) > 100 or not self.SAFE_SOCKET_PATH.match(socket):
            folder = Path(tempfile.gettempdir())/f'gradara-{os.getuid()}'
        folder.mkdir(parents=True, exist_ok=True)
        return folder

    @property
    def socket_path(self) -> Path:
        return self.runtime_dir()/'agent.sock'

    def argv(self) -> list[str]:
        memory = int(os.environ.get('GRADARA_ENGINE_VM_MEMORY', '3072'))
        cpus = max(1, min(4, os.cpu_count() or 2))
        cmdline = 'console=hvc0 root=/dev/vda rootfstype=squashfs ro init=/sbin/gradara-init quiet'
        kernel = self.root/self.manifest.get('kernel', 'kernel')
        # vfkit requires an initrd; the image ships an empty one (the kernel mounts the root itself).
        initrd = self.root/self.manifest.get('initrd', 'initrd')
        rootfs = self.root/self.manifest.get('rootfs', 'rootfs.img')
        port = int(self.manifest.get('agentPort', 1024))
        LOGS.mkdir(parents=True, exist_ok=True)
        return [str(self.root/self.manifest.get('vfkit', 'vfkit')), '--cpus', str(cpus), '--memory', str(memory),
                '--bootloader', f'linux,kernel={kernel},initrd={initrd},cmdline="{cmdline}"',
                '--device', f'virtio-blk,path={rootfs},readonly',
                '--device', f'virtio-fs,sharedDir={self.shared},mountTag=data',
                '--device', f'virtio-vsock,port={port},socketURL={self.socket_path},connect',
                '--device', f'virtio-serial,logFilePath={LOGS/"engine-vm-console.log"}',
                '--device', 'virtio-rng']

    def running(self) -> bool:
        return self.process is not None and self.process.returncode is None

    async def request(self, payload: dict, timeout: float) -> dict:
        limit = 32 * 1024 * 1024
        if TEST_AGENT:
            host, port = TEST_AGENT.rsplit(':', 1)
            opening = asyncio.open_connection(host, int(port), limit=limit)
        else:
            opening = asyncio.open_unix_connection(str(self.socket_path), limit=limit)
        reader, writer = await asyncio.wait_for(opening, 5)
        try:
            writer.write((json.dumps(payload) + '\n').encode())
            await writer.drain()
            line = await asyncio.wait_for(reader.readline(), timeout)
        finally:
            # Closing the connection early tells the agent to stop the command.
            writer.close()
            try:
                await writer.wait_closed()
            except OSError:
                pass
        if not line:
            raise ConnectionError('The engine VM closed the connection.')
        return json.loads(line)

    async def ping(self) -> bool:
        try:
            return bool((await self.request({'ping': True, 'time': time.time()}, 3)).get('ok'))
        except (OSError, ValueError, ConnectionError, asyncio.TimeoutError):
            return False

    def _stop_stale(self) -> None:
        pidfile = self.runtime_dir()/'vfkit.pid'
        try:
            pid = int(pidfile.read_text(encoding='utf-8'))
        except (OSError, ValueError):
            return
        try:
            command = subprocess.run(['ps', '-p', str(pid), '-o', 'comm='], capture_output=True, text=True, encoding='utf-8', errors='replace').stdout
            if 'vfkit' in command:
                os.kill(pid, 9)
        except OSError:
            pass
        pidfile.unlink(missing_ok=True)

    async def _start(self) -> None:
        self._stop_stale()
        self.socket_path.unlink(missing_ok=True)
        LOGS.mkdir(parents=True, exist_ok=True)
        log = open(LOGS/'engine-vm.log', 'ab')
        started = time.monotonic()
        # Same process group as the service: quitting the app stops the VM too.
        self.process = await asyncio.create_subprocess_exec(*self.argv(), stdout=log, stderr=log,
                                                            stdin=asyncio.subprocess.DEVNULL)
        log.close()
        (self.runtime_dir()/'vfkit.pid').write_text(str(self.process.pid), encoding='utf-8')
        _stop_at_exit(self.process.pid)
        while time.monotonic() - started < self.BOOT_TIMEOUT:
            if self.process.returncode is not None:
                raise EngineError('The engine VM stopped while starting. ' + self._log_tail())
            if self.socket_path.exists() and await self.ping():
                self.boot_seconds = round(time.monotonic() - started, 1)
                return
            await asyncio.sleep(0.25)
        await self.stop()
        raise EngineError(f'The engine VM did not start within {self.BOOT_TIMEOUT} seconds. ' + self._log_tail())

    def _log_tail(self) -> str:
        """The informative end of the VM logs (vfkit prints its whole usage text on errors)."""
        usage = re.compile(r'^(Usage:|Flags:|\s+-\w?,? ?--|\s+--|\s*vfkit \[flags\])')
        parts = []
        for name in ('engine-vm.log', 'engine-vm-console.log'):
            try:
                text = (LOGS/name).read_text(encoding='utf-8', errors='replace')
            except OSError:
                continue
            lines = [line for line in text.splitlines() if line.strip() and not usage.match(line)]
            errors = [line for line in lines if 'error' in line.lower()]
            tail = '\n'.join(dict.fromkeys((errors or lines)[-6:]))
            if tail:
                parts.append(f'{name}: {tail[-1200:]}')
        return '\n'.join(parts)

    def lock(self) -> asyncio.Lock:
        # One lock per event loop (a lock is bound to the loop that first waits on it).
        loop = asyncio.get_running_loop()
        if self._lock is None or self._lock[0] is not loop:
            self._lock = (loop, asyncio.Lock())
        return self._lock[1]

    async def ensure(self) -> None:
        async with self.lock():
            if TEST_AGENT:
                if not await self.ping():
                    raise EngineError(f'No engine agent answers at {TEST_AGENT}.')
                return
            if self.running() and await self.ping():
                return
            if self.running():
                await self.stop()
            try:
                await self._start()
                self.error = ''
            except EngineError as exc:
                self.error = str(exc)
                raise

    async def run(self, argv: list[str], cwd: str, timeout: float) -> tuple[int, str]:
        await self.ensure()
        payload = {'argv': argv, 'cwd': cwd, 'timeout': timeout, 'time': time.time()}
        try:
            reply = await self.request(payload, timeout + 15)
        except asyncio.TimeoutError:
            raise
        except (OSError, ConnectionError, ValueError) as exc:
            raise EngineError(f'The engine VM did not answer: {exc}') from exc
        if reply.get('timedOut'):
            raise asyncio.TimeoutError()
        return int(reply.get('code', 1)), str(reply.get('output', ''))

    async def stop(self) -> None:
        # Killed outright: the guest has no ACPI power handling, so vfkit's polite stop
        # only waits out a timeout. Nothing is lost: the root filesystem is read-only
        # and every write to the data folder already went to the Mac's disk.
        process, self.process = self.process, None
        if process is None or process.returncode is not None:
            return
        process.kill()
        await process.wait()
        (self.runtime_dir()/'vfkit.pid').unlink(missing_ok=True)


def _stop_at_exit(pid: int) -> None:
    """Stop vfkit if the service exits without its normal shutdown."""
    import atexit
    import signal

    def stop():
        try:
            os.kill(pid, signal.SIGKILL)
        except OSError:
            pass
    atexit.register(stop)


class VmBackend(NativeBackend):
    """OpenModelica inside the macOS engine VM, driven exactly like a native install."""
    name = 'bundled'
    # The VM has 3 GiB: compiling a large model (buck) on all four CPUs at once
    # has exhausted it ("virtual memory exhausted"), so cap the parallel build.
    COMPILER_SETUP = 'setCompiler("gcc"); setCXXCompiler("g++"); setCommandLineOptions("-n=2");'

    def __init__(self, root: Path):
        super().__init__()
        self.root = root
        self.manifest = bundle_manifest(root)
        self.vm = EngineVM(root, self.manifest)

    def omc(self) -> str | None:  # a path inside the VM
        files = [self.manifest.get(k, d) for k, d in (('vfkit', 'vfkit'), ('kernel', 'kernel'), ('initrd', 'initrd'),
                                                       ('rootfs', 'rootfs.img'))]
        return self.manifest.get('omc', '/usr/bin/omc') if all((self.root/f).exists() for f in files) else None

    def gcc(self) -> str | None:
        return self.manifest.get('gcc', '/usr/bin/gcc')

    def program_name(self) -> str:
        return 'sil'

    def engine_path(self, path: Path) -> str:
        try:
            relative = Path(path).resolve().relative_to(self.vm.shared)
        except ValueError as exc:
            raise EngineError(f'{path} is outside the data folder the engine VM can see.') from exc
        return '/data/' + relative.as_posix() if relative.parts else '/data'

    # gcc inside the VM occasionally dies with a segfault that does not repeat (seen
    # under nested virtualization on CI Macs). A crashed compiler is not a model error,
    # so the same command runs again; make rebuilds only what did not finish.
    COMPILER_CRASH = 'internal compiler error'
    COMPILER_RETRIES = 2

    async def command(self, argv: list[str], timeout: float, cwd: Path | None = None) -> tuple[int, str]:
        argv = [str(a) for a in argv]
        where = self.engine_path(cwd) if cwd else '/tmp'
        for attempt in range(self.COMPILER_RETRIES + 1):
            code, output = await self.vm.run(argv, where, timeout)
            if self.COMPILER_CRASH not in output or attempt == self.COMPILER_RETRIES:
                return code, output
            print(f'gradara: the compiler crashed in the engine VM; running {Path(argv[0]).name} again',
                  file=sys.stderr, flush=True)
        return code, output

    async def status(self) -> EngineStatus:
        omc = self.omc()
        if omc is None:
            return EngineStatus('bundled', False, 'The built-in engine is incomplete', 'Reinstall Gradara to restore it.', [])
        release = platform_release()
        if release and release < (13,):
            return EngineStatus('bundled', False, 'macOS 13 or newer is required',
                                'The built-in engine runs in a small virtual machine that needs macOS 13 (Ventura) or newer.', [])
        try:
            await self.vm.ensure()
        except EngineError as exc:
            return EngineStatus('bundled', False, 'The built-in engine could not start',
                                str(exc)[:1500] + ' Logs: Help → Open Logs.', ['prepare'])
        version = await self.version(omc)
        if not version or not await self.library_ready(omc):
            return EngineStatus('bundled', False, 'The built-in engine is not responding',
                                'Choose Check again. If it persists, restart Gradara.', ['prepare'], version)
        return EngineStatus('bundled', True, f'OpenModelica {version} (built in)', version=version)

    async def prepare(self, progress) -> None:
        progress('Starting the built-in engine…')
        await self.vm.stop()
        self._library_checked.clear()
        self._library_ready.clear()
        await self.vm.ensure()
        status = await self.status()
        if not status.ready:
            raise EngineError(f'{status.label}. {status.detail}')


def platform_release() -> tuple[int, ...] | None:
    if sys.platform != 'darwin':
        return None
    import platform
    try:
        return tuple(int(part) for part in platform.mac_ver()[0].split('.')[:2] if part)
    except ValueError:
        return None


def make_bundled() -> BundledBackend | VmBackend | None:
    root = bundle_root()
    if root is None:
        return None
    if bundle_manifest(root).get('platform') == 'macos':
        return VmBackend(root) if sys.platform == 'darwin' or TEST_AGENT else None
    return BundledBackend(root)

# ------------------------------------------------------------------ selection

DOCKER = DockerBackend()
NATIVE = NativeBackend()
BUNDLED = make_bundled()
BACKENDS = {'docker': DOCKER, 'native': NATIVE, **({'bundled': BUNDLED} if BUNDLED else {})}


def preference() -> str:
    choice = os.environ.get('GRADARA_ENGINE') or settings.load().get('engine') or 'auto'
    return choice if choice in {'auto', 'bundled', 'native', 'docker'} else 'auto'


def platform_default() -> str:
    """The backend a new user should use on this OS."""
    if BUNDLED is not None:
        return 'bundled'
    return 'docker' if sys.platform == 'darwin' else 'native'


async def select() -> NativeBackend | DockerBackend:
    choice = preference()
    if choice != 'auto' and choice in BACKENDS:
        return BACKENDS[choice]
    if BUNDLED is not None:
        return BUNDLED
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
        if BUNDLED is not None:
            BUNDLED._library_checked.clear()
        DOCKER.forget()
    backend = await select()
    current = await backend.status()
    return {'preference': preference(), 'platform': sys.platform, 'recommended': platform_default(),
            'bundled': BUNDLED is not None, **current.as_dict()}


async def available() -> bool:
    return await (await select()).available()


async def execute(folder: Path, config: dict, name: str) -> dict:
    folder.mkdir(parents=True, exist_ok=True)
    backend = await select()
    async with SEMAPHORE:
        return await backend.execute(folder, config, name)


async def compile_c(folder: Path, source: str) -> tuple[int, str]:
    return await (await select()).compile_c(folder, source)


async def run_c(folder: Path, sources: list[str]) -> tuple[int, str]:
    return await (await select()).run_c(folder, sources)


async def prepare(progress=lambda message: None) -> dict:
    backend = await select()
    try:
        await backend.prepare(progress)
    finally:
        DOCKER.forget()
    return await status()


async def shutdown() -> None:
    """Stop the macOS engine VM, if one is running (service shutdown)."""
    if isinstance(BUNDLED, VmBackend):
        await BUNDLED.vm.stop()


__all__ = ['EngineError', 'execute', 'available', 'status', 'prepare', 'compile_c', 'run_c', 'select', 'shutdown',
           'DOCKER', 'NATIVE', 'BUNDLED', 'ROOT', 'subprocess']
