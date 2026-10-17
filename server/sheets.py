# SPDX-License-Identifier: Apache-2.0
"""The sheet an AI edit works on: the top level, or the inside of a subsystem.

This is the server mirror of `scopeView`, `writeScope`, and `syncInstances` in
lib/gradara/hierarchy.ts. A sheet is named by a path of subsystem instance IDs from the
top level, as the workbench's hierarchy bar names it; the path leads to the definition
the innermost instance shows (its active variant). Edits to that definition change every
instance of it, as editing inside a subsystem does in the workbench.

`sheet_view` gives the inside as an ordinary (unvalidated) Project whose blocks, wires,
junctions, and nets are the definition's, so the edit operations apply to it unchanged;
`write_sheet` puts it back, and `sync_instances` brings every instance's ports up to date
with its definition's port blocks, dropping wires to ports that are gone or retyped.
"""
from __future__ import annotations

from .hierarchy import instance_ports, union_ports, variant_refs
from .models import BOUNDARY_KINDS, Boundary, Project, Subsystem

MAX_DEPTH = 20
KIND_ORDER = ('inport', 'outport', 'connport')


def subsystem_at(project: Project, path: list[str]) -> str | None:
    """The definition ID the sheet at `path` shows; None for the top level. Raises ValueError when the path is stale."""
    if not path:
        return None
    if len(path) > MAX_DEPTH:
        raise ValueError('The subsystem path is too deep.')
    by_id = {s.id: s for s in project.subsystems or []}
    sheet, ref = project, None
    for ident in path:
        block = next((b for b in sheet.blocks if b.id == ident), None)
        sub = block.definition.subsystem if block is not None else None
        if sub is None or sub.ref not in by_id:
            raise ValueError('The subsystem that was open is no longer in the model. Open it again and ask again.')
        ref = sub.ref
        sheet = by_id[ref]
    return ref


def sheet_name(project: Project, path: list[str]) -> str:
    """The name of the innermost instance on `path`, as the hierarchy bar shows it."""
    sheet, name = project, ''
    by_id = {s.id: s for s in project.subsystems or []}
    for ident in path:
        block = next(b for b in sheet.blocks if b.id == ident)
        name = block.definition.name
        sheet = by_id[block.definition.subsystem.ref]
    return name


def copies(project: Project, ref: str) -> int:
    """How many instance blocks, on any sheet, can show the definition `ref`."""
    return sum(1 for sheet in [project, *(project.subsystems or [])] for b in sheet.blocks
               if ref in variant_refs(b.definition))


def sheet_view(project: Project, ref: str) -> Project:
    """The inside of `ref` as a Project (not validated: its port blocks would not pass on a top level)."""
    doc = project.model_copy(deep=True)
    sub = next(s for s in doc.subsystems or [] if s.id == ref)
    return doc.model_copy(update=dict(blocks=sub.blocks, wires=sub.wires, junctions=sub.junctions or [],
                                      nets=sub.nets, annotations=[]))


def write_sheet(project: Project, ref: str, view: Project) -> Project:
    """`project` with the inside of `ref` replaced by `view`'s sheet, and `view`'s model-wide fields
    (stop time, new subsystem definitions) kept. The top level stays `project`'s."""
    doc = project.model_copy(deep=True)
    subsystems = []
    for sub in view.subsystems or []:
        if sub.id == ref:
            sub = sub.model_copy(update=dict(blocks=view.blocks, wires=view.wires, junctions=view.junctions,
                                             nets=view.nets))
            renumber_boundaries(sub)
        subsystems.append(sub)
    return doc.model_copy(update=dict(duration=view.duration, simulation=view.simulation, subsystems=subsystems,
                                      version=2))


def renumber_boundaries(sub: Subsystem) -> None:
    """Canonical port numbers: inputs, then outputs, then terminals, each numbered from 1 (renumberBoundaries)."""
    pills = sorted((b for b in sub.blocks if b.definition.kind in BOUNDARY_KINDS and b.definition.boundary is not None),
                   key=lambda b: (b.definition.boundary.order, b.position.y, b.id))
    index = 0
    for kind in KIND_ORDER:
        for number, pill in enumerate(p for p in pills if p.definition.kind == kind):
            pill.definition.boundary = Boundary(order=index, side=pill.definition.boundary.side)
            if kind != 'connport':
                pill.definition.symbol = str(number + 1)
            index += 1


def sync_instances(project: Project) -> Project:
    """Every instance shows its definition's ports; wires to ports that are gone or retyped are removed."""
    doc = project.model_copy(deep=True)
    by_id = {s.id: s for s in doc.subsystems or []}
    for sheet in [doc, *(doc.subsystems or [])]:
        dropped: set[tuple[str, str]] = set()
        for block in sheet.blocks:
            definition = block.definition
            if definition.subsystem is None or definition.subsystem.ref not in by_id:
                continue
            before = {p.id: p for p in definition.ports}
            ports = []
            for port in union_ports(by_id, definition):
                old = before.get(port.id)
                if old is not None and (old.direction, old.domain) != (port.direction, port.domain):
                    dropped.add((block.id, port.id))
                # Where the port sits on the block is the block's own presentation; keep it.
                if old is not None and old.side is not None:
                    port = port.model_copy(update=dict(side=old.side, offset=old.offset))
                ports.append(port)
            kept = {p.id for p in ports}
            dropped |= {(block.id, i) for i in before if i not in kept}
            identity = lambda p: (p.id, p.name, p.direction, p.domain, p.width, p.elements)
            if [identity(p) for p in ports] == [identity(p) for p in definition.ports]:
                continue
            definition.ports = ports
            outputs = {p.id for p in ports if p.direction == 'output'}
            if block.logged:
                block.logged = [i for i in block.logged if i in outputs]
            if block.terminated:
                block.terminated = [i for i in block.terminated if i in outputs]
        if not dropped:
            continue
        gone = {w.id for w in sheet.wires if (w.source, w.sourceHandle) in dropped or (w.target, w.targetHandle) in dropped}
        sheet.wires = [w for w in sheet.wires if w.id not in gone]
        if sheet.nets is not None:
            for net in sheet.nets:
                net.wireIds = [i for i in net.wireIds if i not in gone]
                if net.label is not None and net.label.wireId in gone:
                    net.label = None
            sheet.nets = [n for n in sheet.nets if n.wireIds]
    return doc


__all__ = ['copies', 'instance_ports', 'renumber_boundaries', 'sheet_name', 'sheet_view', 'subsystem_at',
           'sync_instances', 'write_sheet']
