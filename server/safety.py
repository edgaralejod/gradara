# SPDX-License-Identifier: Apache-2.0
"""Reject Modelica constructs that could reach outside the simulation.

Docker runs isolate the compiler with no network and no host file access. The
native OpenModelica backend runs as the user, so editable definition text must
not be able to call external C, run shell commands, or touch files. Definitions
come from users, imported model files, and AI generations; all are checked here
before any source reaches a compiler, regardless of backend.
"""
from __future__ import annotations

import re

from .models import Definition, Project

FORBIDDEN = [
    (re.compile(r'\bexternal\b'), 'external functions'),
    (re.compile(r'\bModelica\s*\.\s*Utilities\b'), 'Modelica.Utilities (files, streams, and system commands)'),
    (re.compile(r'\bModelicaInternal\w*'), 'internal runtime functions'),
    (re.compile(r'\bModelicaServices\b'), 'tool services'),
    (re.compile(r'\bannotation\b'), 'annotations'),
    (re.compile(r'\bimport\b'), 'imports'),
    (re.compile(r'\bfunction\b'), 'function definitions'),
    (re.compile(r'\b(?:model|block|package|connector|record|class)\b'), 'nested class definitions'),
    (re.compile(r'\bloadResource\b|\bsystem\s*\('), 'system access'),
    (re.compile(r'"'), 'string literals'),
]


class UnsafeDefinition(ValueError):
    pass


def check_definition(definition: Definition, label: str | None = None) -> None:
    where = label or definition.name
    for field in ('declarations', 'equations'):
        text = getattr(definition, field) or ''
        # Comments cannot execute, but strip them so a forbidden word in a
        # comment is not reported and cannot hide an unterminated construct.
        code = re.sub(r'//[^\n]*|/\*.*?\*/', ' ', text, flags=re.S)
        for pattern, reason in FORBIDDEN:
            if pattern.search(code):
                raise UnsafeDefinition(
                    f'{where}: {field} use {reason}, which Gradara does not allow in block equations. '
                    'Remove that construct and describe the behavior with equations instead.')


def check_project(project: Project) -> None:
    from .hierarchy import all_blocks
    for block in all_blocks(project):
        check_definition(block.definition, block.definition.name)
