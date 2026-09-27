# SPDX-License-Identifier: Apache-2.0
"""The block design contract, enforced on generated definitions.

The prompt asks for short names and sensible terminal sides; this module makes
it true. Deterministic fixes are applied silently (terminal sides, instance
suffixes). What only the author can fix (a long name, a symbol that is really
an equation) is returned as a problem so the generator revises the block.
See docs/blocks/DESIGN.md and docs/blocks/AGENT_BLOCK_GUIDE.md.
"""
from __future__ import annotations

import re

from .models import Definition

MAX_NAME_WORDS = 4
MAX_NAME_CHARS = 28
MAX_SYMBOL_CHARS = 12
MAX_CAPTION_CHARS = 8
INSTANCE_SUFFIX = re.compile(r'\s*(?:\d+|#\d+|\(\d+\))$')


def _sides(definition: Definition, existing: Definition | None) -> None:
    kept = {p.id: p for p in existing.ports} if existing else {}
    physical = [p for p in definition.ports if p.direction == 'physical']
    signal_block = not physical
    feedback_used = False
    for port in definition.ports:
        if port.id in kept:
            # A revision never moves a terminal: wires and layouts depend on it.
            port.side, port.offset = kept[port.id].side, kept[port.id].offset
            continue
        if port.direction == 'output' and (signal_block or port.side in (None, 'left')):
            port.side = 'right'
        elif port.direction == 'input':
            if signal_block and port.side == 'bottom' and not feedback_used and len(definition.ports) > 2:
                feedback_used = True  # one measured/feedback input may enter from below
            elif signal_block or port.side in (None, 'right'):
                port.side = 'left'
    fresh = [p for p in physical if p.id not in kept]
    if len(physical) == 2 and len(fresh) == 2 and physical[0].domain == physical[1].domain:
        a, b = physical
        opposite = {('left', 'right'), ('right', 'left'), ('top', 'bottom'), ('bottom', 'top')}
        if (a.side, b.side) not in opposite:
            # A two-terminal element reads left to right, like a resistor.
            a.side, b.side = 'left', 'right'
    for port in fresh:
        port.side = port.side or 'left'


def house_style(definition: Definition, existing: Definition | None = None) -> tuple[Definition, list[str]]:
    """Return the definition with deterministic fixes and the problems left for its author."""
    definition = definition.model_copy(deep=True)
    definition.name = INSTANCE_SUFFIX.sub('', definition.name.strip()) or definition.name.strip()
    definition.symbol = definition.symbol.strip()
    for port in definition.ports:
        port.name = port.name.strip()
    _sides(definition, existing)

    problems = []
    if existing is None:
        words = definition.name.split()
        if len(words) > MAX_NAME_WORDS or len(definition.name) > MAX_NAME_CHARS:
            problems.append(f'The name "{definition.name}" is too long for the diagram: use 1–3 words '
                            f'(at most {MAX_NAME_CHARS} characters). Put detail in the description.')
    if len(definition.symbol) > MAX_SYMBOL_CHARS:
        problems.append(f'The symbol "{definition.symbol}" is too long: use compact notation of at most '
                        f'{MAX_SYMBOL_CHARS} characters (ideally 1–6), not an equation or the name.')
    if definition.symbol and definition.symbol.lower() == definition.name.lower() and len(definition.symbol) > 6:
        problems.append('The symbol repeats the name; use compact engineering notation instead.')
    long = [p.name for p in definition.ports if len(p.name) > MAX_CAPTION_CHARS and p.id not in
            {q.id for q in (existing.ports if existing else [])}]
    if long:
        problems.append('Terminal captions must be short (1–5 characters, e.g. ref, meas, θe, shaft): '
                        + ', '.join(f'"{name}"' for name in long) + '. Keep detail in the description.')
    return Definition.model_validate(definition.model_dump()), problems
