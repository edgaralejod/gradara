# SPDX-License-Identifier: Apache-2.0
"""Library blocks that are instances of Modelica Standard Library classes.

A wrapper names an MSL class, maps block parameters onto its modifiers, and maps
block ports onto its connectors. Only classes in `msl_index.json` (built by
`scripts/msl-index.py` from MSL 4.1.0) are accepted, and every modifier and
connector is checked against that index before any source is emitted.
"""
from __future__ import annotations

import json
import re
from functools import lru_cache
from pathlib import Path

from .models import Definition

INDEX_PATH = Path(__file__).with_name('msl_index.json')
IDENT = re.compile(r'\b[A-Za-z_][A-Za-z0-9_]*\b')
LITERALS = {'true', 'false'}
FUNCTIONS = {'sqrt', 'sin', 'cos', 'tan', 'exp', 'log', 'abs', 'min', 'max', 'fill'}


@lru_cache(maxsize=1)
def index() -> dict:
    return json.loads(INDEX_PATH.read_text())['classes']


def connector(definition: Definition, port_id: str) -> str:
    """The MSL connector a block port maps to (the port ID unless renamed)."""
    wrapper = definition.modelica
    return wrapper.ports.get(port_id, port_id) if wrapper else port_id


def check(definition: Definition) -> None:
    """Raise ValueError when a wrapper does not match its MSL class."""
    wrapper = definition.modelica
    if wrapper is None:
        return
    info = index().get(wrapper.class_)
    if info is None:
        raise ValueError(f'{definition.name}: {wrapper.class_} is not an available library class.')
    parameters = {p.id for p in definition.parameters}
    for name, expression in wrapper.modifiers.items():
        if name.split('.')[0] not in info['parameters']:
            raise ValueError(f'{definition.name}: {wrapper.class_} has no parameter {name}.')
        for ident in IDENT.findall(expression):
            if ident not in parameters and ident not in LITERALS and ident not in FUNCTIONS and not ident.isdigit() \
                    and not re.fullmatch(r'\d*e\d*', ident):
                raise ValueError(f'{definition.name}: modifier {name} refers to unknown value {ident}.')
    connectors = info['connectors']
    for port in definition.ports:
        name = connector(definition, port.id)
        base, element = re.fullmatch(r'([A-Za-z_]\w*)(\[[1-9]\d?\])?', name).groups() if re.fullmatch(
            r'([A-Za-z_]\w*)(\[[1-9]\d?\])?', name) else (None, None)
        if base not in connectors:
            raise ValueError(f'{definition.name}: {wrapper.class_} has no connector {name}.')
        domain, direction, *flags = connectors[base]
        if ('array' in flags) != bool(element):
            raise ValueError(f'{definition.name}: connector {base} ' + (
                'is a vector; map the port to one element, such as ' + base + '[1].' if 'array' in flags
                else 'is not a vector.'))
        if domain != port.domain or direction != port.direction:
            raise ValueError(f'{definition.name}: port {port.id} must be a {direction} {domain} terminal.')
        if 'conditional' in flags and not any(key.startswith('use') for key in wrapper.modifiers):
            raise ValueError(f'{definition.name}: connector {name} is conditional; enable it with a use… modifier.')


def instance(definition: Definition, name: str) -> str:
    """One component declaration, with parameter values substituted into the modifiers."""
    check(definition)
    wrapper = definition.modelica
    values = {p.id: f'{p.value:.16g}' for p in definition.parameters}

    def value(expression: str) -> str:
        return IDENT.sub(lambda m: f'({values[m.group(0)]})' if m.group(0) in values else m.group(0), expression)

    return f'  {wrapper.class_} {name}' + modification(
        {key: value(expr) for key, expr in wrapper.modifiers.items()}) + ';'


def modification(values: dict[str, str]) -> str:
    """`(a=1, rec(b=2, c=3))` from flat keys, where `rec.b` modifies a record parameter."""
    if not values:
        return ''
    groups: dict[str, dict[str, str]] = {}
    plain = {}
    for key, expression in values.items():
        head, _, rest = key.partition('.')
        if rest:
            groups.setdefault(head, {})[rest] = expression
        else:
            plain[key] = expression
    parts = [f'{key}={expr}' for key, expr in sorted(plain.items())]
    parts += [f'{key}{modification(inner)}' for key, inner in sorted(groups.items())]
    return '(' + ', '.join(parts) + ')'

