# SPDX-License-Identifier: Apache-2.0
"""Units of signals in results.

A port's unit is what its block fixes (a speed sensor reads rad/s, a controlled
voltage source takes V): `lib/gradara/port-units.json`, applied to the library
in the workbench and here to documents saved before those units existed. The
rest of a diagram's signals have no unit of their own, so `signal_units`
infers them from the wiring: a wire carries one quantity, and blocks that do
not change a quantity (sum, saturation, low-pass filter, switch, subsystem
boundaries) pass its unit through, as do a controller's setpoint and
measurement. A signal that could be two different quantities keeps no unit
rather than a wrong one.
"""
from __future__ import annotations

import json
from functools import lru_cache

from .hierarchy import BOUNDARY_KINDS
from .models import Block, Definition, Diagram, Port, Project
from .paths import ROOT

# Every signal port of the block carries the same quantity.
SAME_UNIT_KINDS = frozenset({'sum', 'subtract', 'saturation', 'filter', 'secondOrder', 'rateLimiter', 'unitDelay',
                             'zoh', 'deadzone', 'delay', 'min', 'max', 'abs', 'unaryMinus', 'triggeredSampler'})
# Only these ports share a unit (a switch's selector, a controller's output, do not).
SAME_UNIT_PORTS = {'switch2': ('u1', 'u3', 'y'), 'manualSwitch': ('u1', 'u2', 'y'), 'logicSwitch': ('u1', 'u3', 'y'),
                   'pi': ('reference', 'measured'), 'discretePID': ('reference', 'measured'),
                   'onOffController': ('reference', 'u')}


@lru_cache(maxsize=1)
def port_units() -> dict[str, dict[str, str]]:
    try:
        table = json.loads((ROOT/'lib'/'gradara'/'port-units.json').read_text(encoding='utf-8'))
    except OSError:
        return {}
    return {kind: ports for kind, ports in table.items() if isinstance(ports, dict)}


def declared_unit(definition: Definition, port: Port) -> str:
    """The unit the document or the library gives a port."""
    return port.unit or port_units().get(definition.kind, {}).get(port.id, '')


class _Union:
    def __init__(self):
        self.parent: dict[str, str] = {}

    def find(self, key: str) -> str:
        self.parent.setdefault(key, key)
        while self.parent[key] != key:
            self.parent[key] = self.parent[self.parent[key]]
            key = self.parent[key]
        return key

    def join(self, a: str, b: str) -> None:
        self.parent[self.find(a)] = self.find(b)


def signal_units(project: Project) -> dict[str, str]:
    """Unit of every signal port reachable from the top, keyed `prefix + block id + '.' + port id`.

    `prefix` is the instance prefix `hierarchy.instances` gives (`drive.` for a
    block inside instance `drive`). Ports whose unit is unknown are absent.
    """
    by_id = {s.id: s for s in (project.subsystems or [])}
    groups = _Union()
    declared: dict[str, str] = {}

    def walk(diagram: Diagram, prefix: str) -> None:
        blocks = {b.id: b for b in diagram.blocks}
        for block in diagram.blocks:
            d = block.definition
            keys = {p.id: f'{prefix}{block.id}.{p.id}' for p in d.ports if p.domain == 'signal' and not p.width}
            for p in d.ports:
                if p.id in keys and declared_unit(d, p):
                    declared[keys[p.id]] = declared_unit(d, p)
            shared = list(keys.values()) if d.kind in SAME_UNIT_KINDS else \
                [keys[i] for i in SAME_UNIT_PORTS.get(d.kind, ()) if i in keys]
            for a, b in zip(shared, shared[1:]):
                groups.join(a, b)
            ref = d.subsystem.ref if d.subsystem else None
            if ref in by_id:
                inner_prefix = f'{prefix}{block.id}.'
                walk(by_id[ref], inner_prefix)
                # An instance port is the boundary block of the same ID inside.
                for boundary in by_id[ref].blocks:
                    if boundary.definition.kind in BOUNDARY_KINDS and boundary.definition.boundary is not None \
                            and boundary.id in keys and boundary.definition.ports:
                        inner = boundary.definition.ports[0]
                        if inner.domain == 'signal' and not inner.width:
                            groups.join(keys[boundary.id], f'{inner_prefix}{boundary.id}.{inner.id}')
        for w in diagram.wires:
            if w.source in blocks and w.target in blocks:
                s = next((p for p in blocks[w.source].definition.ports if p.id == w.sourceHandle), None)
                t = next((p for p in blocks[w.target].definition.ports if p.id == w.targetHandle), None)
                if s and t and s.domain == 'signal' and t.domain == 'signal' and not s.width and not t.width:
                    groups.join(f'{prefix}{w.source}.{w.sourceHandle}', f'{prefix}{w.target}.{w.targetHandle}')

    walk(project, '')
    units_of_group: dict[str, set[str]] = {}
    for key, unit in declared.items():
        units_of_group.setdefault(groups.find(key), set()).add(unit)
    result = dict(declared)
    for key in list(groups.parent):
        units = units_of_group.get(groups.find(key), set())
        if len(units) == 1 and key not in result:
            result[key] = next(iter(units))
    return result
