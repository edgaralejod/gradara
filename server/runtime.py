"""Docker image and context names. Legacy Flux identifiers remain aliases."""
from __future__ import annotations

import os
import platform
import subprocess
from functools import cache

IMAGE = 'gradara-engine:1.27.0'
LEGACY_IMAGE = 'flux-engine:1.27.0'


def _explicit_context() -> str | None:
    if 'GRADARA_DOCKER_CONTEXT' in os.environ:
        return os.environ['GRADARA_DOCKER_CONTEXT']
    if 'FLUX_DOCKER_CONTEXT' in os.environ:
        return os.environ['FLUX_DOCKER_CONTEXT']
    return None


def _context_exists(name: str) -> bool:
    try:
        result = subprocess.run(
            ['docker', 'context', 'inspect', name],
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
            timeout=4,
        )
        return result.returncode == 0
    except (OSError, subprocess.TimeoutExpired):
        return False


@cache
def docker_context() -> str:
    explicit = _explicit_context()
    if explicit is not None:
        return explicit
    if platform.system() != 'Darwin':
        return ''
    for name in ('colima-gradara', 'colima-flux'):
        if _context_exists(name):
            return name
    return 'colima-gradara'


def docker_argv() -> list[str]:
    context = docker_context()
    return ['docker'] + (['--context', context] if context else [])


def colima_profile(context: str) -> str:
    if context.startswith('colima-'):
        return context.removeprefix('colima-')
    return 'gradara'
