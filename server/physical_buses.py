# SPDX-License-Identifier: Apache-2.0
"""Physical buses: named physical connections of any domain in one line.

A Physical bus block (`physicalBus`) has one terminal per element, each named and of
any physical domain, and one bus terminal. Wired bus to bus, directly, through
junctions, or through a subsystem's physical bus port, the elements with the same
name on every bus block of one bus line become one node, as with Simscape Bus. A
physical connection has no direction, so one block both bundles and splits.

Nothing downstream knows about buses. `lower_physical_buses` turns a document into an
ordinary one: on every sheet, each bus line becomes one junction per element name;
the wires on a bus block's element terminals move to that junction; a subsystem's
physical bus port becomes one hidden terminal per element its inside uses, wired to
the junction above and below. Emission, code generation and the run see plain wires.
"""
from __future__ import annotations

import re

from .models import Block, Boundary, Definition, Junction, Port, Position, Project, Wire

KIND = 'physicalBus'
BUS = 'physicalBus'
BUS_PORT = 'bus'
NODE = 'node'
NAME = re.compile(r'^[A-Za-z][A-Za-z0-9_]{0,31}$')
LABELS = {'electrical': 'electrical', 'mechanical': 'rotational', 'translational': 'translational',
          'thermal': 'thermal', 'magnetic': 'magnetic', 'threePhase': '3-phase'}


def _sheets(project: Project) -> dict:
    return {None: project, **{s.id: s for s in (project.subsystems or [])}}


def is_bus_block(block: Block) -> bool:
    d = block.definition
    return d.kind == KIND and d.subsystem is None and d.boundary is None and not d.generated


def _elements(block: Block) -> list[Port]:
    return [p for p in block.definition.ports if p.id != BUS_PORT]


def _bus_ports(block: Block) -> list[Port]:
    return [p for p in block.definition.ports if p.domain == BUS]


def has_physical_buses(project: Project) -> bool:
    return any(any(p.domain == BUS for p in b.definition.ports)
               for sheet in _sheets(project).values() for b in sheet.blocks)


def hidden_id(boundary_id: str, name: str) -> str:
    """The terminal a subsystem's physical bus port becomes for one element."""
    return f'{boundary_id}__{name}'[:60]


def _bus_nets(sheet) -> list[set[tuple[str, str]]]:
    """Each bus line on a sheet: the (block or junction ID, handle) ends it joins."""
    blocks = {b.id: b for b in sheet.blocks}
    junctions = {j.id: j for j in sheet.junctions}

    def is_bus(end):
        ident, handle = end
        if ident in junctions:
            return junctions[ident].domain == BUS
        block = blocks.get(ident)
        port = next((p for p in block.definition.ports if p.id == handle), None) if block else None
        return port is not None and port.domain == BUS

    parent: dict = {}

    def find(x):
        parent.setdefault(x, x)
        while parent[x] != x:
            parent[x] = parent[parent[x]]
            x = parent[x]
        return x

    for w in sheet.wires:
        a = (w.source, NODE if w.source in junctions else w.sourceHandle)
        b = (w.target, NODE if w.target in junctions else w.targetHandle)
        if is_bus(a) or is_bus(b):
            parent[find(a)] = find(b)
    for block in sheet.blocks:
        for port in _bus_ports(block):
            find((block.id, port.id))
    groups: dict = {}
    for end in parent:
        groups.setdefault(find(end), set()).add(end)
    return sorted(groups.values(), key=lambda g: sorted(g))


class _Bundles:
    """What each subsystem's physical bus port carries, read from its inside."""

    def __init__(self, project: Project):
        self.sheets = _sheets(project)
        self.memo: dict = {}

    def contribution(self, sheet, end, path) -> list[tuple[str, str, str]]:
        """(name, domain, where) for one end of a bus line, `where` naming the block."""
        ident, handle = end
        block = next((b for b in sheet.blocks if b.id == ident), None)
        if block is None:
            return []
        if is_bus_block(block):
            return [(p.name, p.domain, block.id) for p in _elements(block)]
        ref = block.definition.subsystem.ref if block.definition.subsystem else None
        if ref is not None and ref in self.sheets and ref not in path:
            return [(n, d, block.id) for n, d in self.port(ref, handle, path + (ref,)).items()]
        return []

    def port(self, ref, boundary_id, path=()) -> dict[str, str]:
        """Element name → domain for the physical bus port `boundary_id` of subsystem `ref`."""
        key = (ref, boundary_id)
        if key in self.memo:
            return self.memo[key]
        self.memo[key] = {}
        sheet = self.sheets[ref]
        found: dict[str, str] = {}
        for net in _bus_nets(sheet):
            if not any(i == boundary_id for i, _ in net):
                continue
            for end in sorted(net):
                for name, domain, _ in self.contribution(sheet, end, path or (ref,)):
                    found.setdefault(name, domain)
        self.memo[key] = found
        return found


def physical_bus_problems(project: Project) -> list[dict]:
    """What keeps a physical bus from joining: a bus block without valid, unique element
    names, and one element name carried as two physical domains on one bus line. Each is
    {message, blockIds, sheet, hint}."""
    if not has_physical_buses(project):
        return []
    bundles = _Bundles(project)
    problems: list[dict] = []
    for sheet_id, sheet in bundles.sheets.items():
        for block in sheet.blocks:
            if not is_bus_block(block):
                continue
            names = [p.name for p in _elements(block)]
            bad = [n for n in names if not NAME.match(n)]
            # The same words as the editor (elementsError in lib/gradara/physical-bus.ts).
            problem = None
            if not names:
                problem = 'A physical bus needs at least one element.'
            elif bad:
                problem = f'“{bad[0]}” is not a valid name: a letter, then letters, digits, or _.'
            elif len(set(names)) != len(names):
                problem = f'Two elements are named {next(n for i, n in enumerate(names) if n in names[:i])}.'
            if problem:
                problems.append(dict(message=f'{block.definition.name}: {problem}', blockIds=[block.id], sheet=sheet_id,
                                     hint='Give each element its own name in the block’s properties.'))
        for net in _bus_nets(sheet):
            seen: dict[str, tuple[str, str]] = {}
            reported = set()
            for end in sorted(net):
                for name, domain, where in bundles.contribution(sheet, end, (sheet_id,)):
                    if name in seen and seen[name][0] != domain and name not in reported:
                        reported.add(name)
                        problems.append(dict(
                            message=f'The physical bus carries {name} as {LABELS.get(seen[name][0], seen[name][0])} '
                                    f'on one end and {LABELS.get(domain, domain)} on the other.',
                            blockIds=sorted({seen[name][1], where}), sheet=sheet_id,
                            hint='Elements with one name are joined, so they must be the same type; rename one.'))
                    seen.setdefault(name, (domain, where))
    return problems


def _unique(taken: set[str], base: str) -> str:
    ident, n = base, 1
    while ident in taken:
        n += 1
        ident = f'{base}_{n}'
    taken.add(ident)
    return ident


def lower_physical_buses(project: Project) -> Project:
    """The same model with every physical bus turned into junctions and hidden subsystem terminals."""
    if not has_physical_buses(project):
        return project
    bundles = _Bundles(project)
    # What every subsystem's bus ports carry, read before any sheet changes.
    for ref, sheet in bundles.sheets.items():
        if ref is None:
            continue
        for block in sheet.blocks:
            if block.definition.boundary is not None and any(p.domain == BUS for p in block.definition.ports):
                bundles.port(ref, block.id, (ref,))
    project = project.model_copy(deep=True)
    sheets = _sheets(project)

    for ref, sheet in sheets.items():
        blocks = {b.id: b for b in sheet.blocks}
        taken = {b.id for b in sheet.blocks} | {j.id for j in sheet.junctions} | {w.id for w in sheet.wires}
        wires = list(sheet.wires)
        junctions = list(sheet.junctions)
        new_blocks: list[Block] = []
        extra: dict[str, list[Port]] = {}
        drop_blocks: set[str] = set()
        drop_junctions: set[str] = set()
        drop_ports: dict[str, set[str]] = {}

        def wire(a, ah, b, bh):
            wires.append(Wire.model_construct(id=_unique(taken, 'pbus_w'), source=a, sourceHandle=ah,
                                              target=b, targetHandle=bh, waypoints=[], junctions=[]))

        for net in _bus_nets(sheet):
            ends = [e for e in sorted(net) if e[0] in blocks]
            drop_junctions |= {i for i, _ in net if i not in blocks}
            elements: dict[str, str] = {}
            for end in ends:
                block = blocks[end[0]]
                if block.definition.boundary is not None:
                    contributed = bundles.port(ref, block.id, (ref,)).items() if ref is not None else []
                else:
                    contributed = [(n, d) for n, d, _ in bundles.contribution(sheet, end, (ref,))]
                for name, domain in contributed:
                    elements.setdefault(name, domain)
            for name, domain in elements.items():
                anchor = blocks[ends[0][0]].position if ends else Position(x=0, y=0)
                node = _unique(taken, f'pbus_{name}')
                junctions.append(Junction.model_construct(id=node, position=anchor, domain=domain))
                for ident, handle in ends:
                    block = blocks[ident]
                    d = block.definition
                    if is_bus_block(block):
                        ports = {p.id for p in _elements(block) if p.name == name}
                        for i, w in enumerate(wires):
                            src = w.source == ident and w.sourceHandle in ports
                            dst = w.target == ident and w.targetHandle in ports
                            if src or dst:
                                w = w.model_copy()
                                if src:
                                    w.source, w.sourceHandle = node, NODE
                                if dst:
                                    w.target, w.targetHandle = node, NODE
                                wires[i] = w
                    elif d.subsystem is not None:
                        inside = bundles.port(d.subsystem.ref, handle, (d.subsystem.ref,))
                        if inside.get(name) is None:
                            continue
                        port_id = hidden_id(handle, name)
                        wire(node, NODE, ident, port_id)
                        extra.setdefault(ident, []).append(
                            Port(id=port_id, name=f'{name}', direction='physical', domain=inside[name], side='left'))
                    elif d.boundary is not None:
                        port_id = hidden_id(ident, name)
                        definition = Definition.model_construct(
                            kind='connport', name=f'{d.name}.{name}', description='Element of a physical bus port.',
                            domain=domain, symbol='', ports=[Port(id='p', name=name, direction='physical',
                                                                   domain=domain, side='right')],
                            parameters=[], equations='', declarations='', generated=False, controller=False,
                            category='', keywords=[], modelica=None, subsystem=None,
                            boundary=Boundary.model_construct(side=d.boundary.side,
                                                              order=d.boundary.order + (len(new_blocks) + 1) / 1000),
                            ctemplate=None, tag=None)
                        new_blocks.append(Block.model_construct(
                            id=port_id, definition=definition, position=block.position, size=None, labelOffset=None,
                            rotation=None, flip=None, terminated=None))
                        wire(port_id, 'p', node, NODE)
            for ident, handle in ends:
                block = blocks[ident]
                if is_bus_block(block) or block.definition.boundary is not None:
                    drop_blocks.add(ident)
                else:
                    drop_ports.setdefault(ident, set()).add(handle)

        # Bus wires and bus junctions go; what stays is plain physical wiring.
        def on_bus(end_id, handle):
            if end_id in drop_junctions or end_id in drop_blocks:
                return True
            return handle in drop_ports.get(end_id, set())

        wires = [w for w in wires if not (on_bus(w.source, w.sourceHandle) or on_bus(w.target, w.targetHandle))]
        kept = []
        for b in sheet.blocks:
            if b.id in drop_blocks:
                continue
            if b.id in drop_ports or b.id in extra:
                ports = [p for p in b.definition.ports if p.id not in drop_ports.get(b.id, set())]
                b = b.model_copy(update={'definition': b.definition.model_copy(
                    update={'ports': [*ports, *extra.get(b.id, [])]})})
            kept.append(b)
        sheet.blocks = kept + new_blocks
        sheet.wires = wires
        sheet.junctions = [j for j in junctions if j.id not in drop_junctions]
    return project
