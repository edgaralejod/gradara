# SPDX-License-Identifier: Apache-2.0
"""Subsystems: a block whose inside is another diagram of the same document.

A subsystem definition is stored once in `Project.subsystems`; instance blocks
refer to it with `definition.subsystem.ref`. Boundary blocks inside the
definition (inport, outport, connport) become the instance's ports, keyed by the
boundary block's ID. This module checks that structure; `modelica.py` emits each
used definition as a nested Modelica model.
"""
from __future__ import annotations

from typing import TYPE_CHECKING, Iterator

from .models import BOUNDARY_KINDS, Port

if TYPE_CHECKING:
    from .models import Block, Diagram, Project, Subsystem


def boundary_blocks(diagram: 'Diagram') -> list['Block']:
    ports = [b for b in diagram.blocks if b.definition.kind in BOUNDARY_KINDS and b.definition.boundary is not None]
    return sorted(ports, key=lambda b: (b.definition.boundary.order, b.position.y, b.id))


def instance_ports(subsystem: 'Subsystem') -> list[Port]:
    """The ports an instance of `subsystem` exposes, in boundary order."""
    ports = []
    for block in boundary_blocks(subsystem):
        inner = block.definition.ports[0]
        ports.append(Port(id=block.id, name=block.definition.name, direction=BOUNDARY_KINDS[block.definition.kind],
                          domain=inner.domain, unit=inner.unit, side=block.definition.boundary.side))
    return ports


def variant_refs(definition) -> list[str]:
    """Every subsystem definition an instance can show: its variants' refs, or just its own."""
    sub = definition.subsystem
    if sub is None:
        return []
    refs = [sub.ref] + [v.ref for v in sub.variants or []]
    return list(dict.fromkeys(refs))


def union_ports(subsystems: dict, definition) -> list[Port]:
    """An instance's ports: the active inside's ports, then ports only other variants have."""
    ports: dict[str, Port] = {}
    for ref in variant_refs(definition):
        if ref in subsystems:
            for port in instance_ports(subsystems[ref]):
                ports.setdefault(port.id, port)
    return list(ports.values())


def missing_ports(subsystems: dict, block) -> list[Port]:
    """Instance ports the active inside does not have (idle when the variant marks them unused)."""
    definition = block.definition
    if definition.subsystem is None or definition.subsystem.ref not in subsystems:
        return []
    present = {p.id for p in instance_ports(subsystems[definition.subsystem.ref])}
    return [p for p in definition.ports if p.id not in present]


def diagrams(project: 'Project') -> Iterator[tuple[str | None, 'Diagram']]:
    yield None, project
    for subsystem in (project.subsystems or []):
        yield subsystem.id, subsystem


def active_diagrams(project: 'Project') -> Iterator[tuple[str | None, 'Diagram']]:
    """The top level and every definition reachable through active insides: what a run simulates."""
    by_id = {s.id: s for s in (project.subsystems or [])}
    yield None, project
    seen: set[str] = set()
    stack = [project]
    while stack:
        diagram = stack.pop()
        for block in diagram.blocks:
            ref = block.definition.subsystem.ref if block.definition.subsystem else None
            if ref in by_id and ref not in seen:
                seen.add(ref)
                yield ref, by_id[ref]
                stack.append(by_id[ref])


def check_hierarchy(project: 'Project') -> None:
    subsystems = {s.id: s for s in (project.subsystems or [])}
    if len(subsystems) != len(project.subsystems or []):
        raise ValueError('Subsystem identifiers must be unique.')
    if project.subsystems and project.version != 2:
        raise ValueError('Documents with subsystems use format version 2.')
    uses: dict[str, set[str]] = {sid: set() for sid in subsystems}
    for owner, diagram in diagrams(project):
        for block in diagram.blocks:
            definition = block.definition
            if definition.kind in BOUNDARY_KINDS and definition.boundary is not None:
                if owner is None:
                    raise ValueError('Subsystem ports belong inside a subsystem, not on the top level.')
                expected = {'inport': 'output', 'outport': 'input', 'connport': 'physical'}[definition.kind]
                if len(definition.ports) != 1 or definition.ports[0].direction != expected:
                    raise ValueError(f'Subsystem port {definition.name} must have a single {expected} terminal.')
            if definition.subsystem is None:
                continue
            ref = definition.subsystem.ref
            refs = variant_refs(definition)
            if any(r not in subsystems for r in refs):
                raise ValueError(f'{definition.name} refers to a missing subsystem.')
            if owner is not None:
                uses[owner].update(refs)
            expected = [(p.id, p.direction, p.domain) for p in union_ports(subsystems, definition)]
            actual = [(p.id, p.direction, p.domain) for p in definition.ports]
            if sorted(expected) != sorted(actual):
                raise ValueError(f'{definition.name} is out of date with its subsystem ports.')
            promoted = sorted(p.id for p in subsystems[ref].parameters)
            if sorted(p.id for p in definition.parameters) != promoted:
                raise ValueError(f'{definition.name} is out of date with its subsystem parameters.')
    for subsystem in (project.subsystems or []):
        inner = {b.id: b for b in subsystem.blocks}
        for parameter in subsystem.parameters:
            for target in parameter.targets:
                block = inner.get(target.blockId)
                if block is None or not any(p.id == target.parameterId for p in block.definition.parameters):
                    raise ValueError(f'{subsystem.name}.{parameter.name} sets a parameter that does not exist.')
    # A subsystem must not contain itself, directly or through others.
    state: dict[str, int] = {}

    def visit(sid: str):
        if state.get(sid) == 1:
            raise ValueError('A subsystem cannot contain itself.')
        if state.get(sid) == 2:
            return
        state[sid] = 1
        for child in uses[sid]:
            visit(child)
        state[sid] = 2

    for sid in subsystems:
        visit(sid)


def all_blocks(project: 'Project') -> Iterator['Block']:
    """Every block of every diagram once (for checks that do not depend on instances)."""
    for _, diagram in diagrams(project):
        yield from diagram.blocks


def instances(project: 'Project') -> Iterator[tuple[str, str, 'Block', str]]:
    """(variable prefix, readable prefix, block, top-level block ID) for every block instance reachable from the top.

    A block inside instance `drive` of a subsystem has variable prefix `drive.` and
    readable prefix `Drive › `; the top-level ID lets results select the instance.
    """
    by_id = {s.id: s for s in (project.subsystems or [])}

    def walk(diagram, prefix: str, label: str, top: str | None):
        for block in diagram.blocks:
            owner = top or block.id
            yield prefix, label, block, owner
            ref = block.definition.subsystem.ref if block.definition.subsystem else None
            if ref in by_id:
                yield from walk(by_id[ref], f'{prefix}{block.id}.', f'{label}{block.definition.name} › ', owner)
    yield from walk(project, '', '', None)


def with_variant(project: 'Project', sheet_id: str, block_id: str, variant_id: str) -> 'Project':
    """A copy of `project` with one instance switched to another variant (as the workbench switch does)."""
    from .models import Project as ProjectModel
    data = project.model_dump(exclude_none=True, by_alias=True)
    sheet = data if not sheet_id else next(s for s in data['subsystems'] if s['id'] == sheet_id)
    block = next(b for b in sheet['blocks'] if b['id'] == block_id)
    ref = block['definition']['subsystem']
    variant = next(v for v in ref['variants'] if v['id'] == variant_id)
    target = next(s for s in data['subsystems'] if s['id'] == variant['ref'])
    ref['ref'], ref['active'] = variant['ref'], variant['id']
    values = variant.get('values', {})
    block['definition']['parameters'] = [
        {k: v for k, v in p.items() if k != 'targets'} | {'value': values.get(p['id'], p['value'])}
        for p in target.get('parameters', [])]
    return ProjectModel.model_validate(data)


def variant_choices(project: 'Project') -> Iterator[tuple[str, 'Block']]:
    """(sheet ID or '', instance) for every instance with variants."""
    for owner, diagram in diagrams(project):
        for block in diagram.blocks:
            if block.definition.subsystem is not None and block.definition.subsystem.variants:
                yield owner or '', block
