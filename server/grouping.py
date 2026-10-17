# SPDX-License-Identifier: Apache-2.0
"""Group top-level blocks into a new subsystem, as the workbench's ⌘G does.

This is the server mirror of `groupIntoSubsystem` in lib/gradara/hierarchy.ts, used
by the AI edit path (`group_into_subsystem` in model_edit.py). The grouped blocks keep
their IDs and positions; every net the selection edge cuts becomes one port: a signal
net driven inside becomes an output, one driven outside an input, and a physical net a
terminal of its domain. Cut wires keep their IDs outside (so their nets keep name,
label, and logged state) and get a new wire inside. Identifiers are deterministic so a
plan can refer to the result: instance `b_<alias>`, definition `s_<alias>`, ports
`p_<alias>_<port>`, inner wires `w_<alias>_<n>`.

Positions here are an approximation of the workbench's (port pills a short run outside
the selection, level with the port they join); the client re-places pills and tidies
the result when the proposal is applied.
"""
from __future__ import annotations

import math
import re

from pydantic import ValidationError

from .hierarchy import instance_ports
from .models import (BOUNDARY_KINDS, CAUSAL_DOMAINS, Block, Boundary, Definition, Net, Port, Position,
                     Project, Size, Subsystem, Wire)

GAP = 96
GRID = 8
KIND_ORDER = ('inport', 'outport', 'connport')
GENERIC_PORT_NAMES = {'u', 'y', 'in', 'out'}
MAX_GROUPED = 200


def _snap(value: float) -> float:
    return round(value / GRID) * GRID


def _port_id_text(name: str, fallback: str) -> str:
    """The identifier part of a port ID: the port name in [A-Za-z0-9_], or its domain for a symbol like −."""
    text = re.sub(r'[^A-Za-z0-9_]+', '_', name).strip('_')
    return text or fallback


def _unique(taken: set[str], base: str, joiner: str = '') -> str:
    ident, n = base, 1
    while ident in taken:
        n += 1
        ident = f'{base}{joiner}{n}'
    taken.add(ident)
    return ident


def _size(block: Block) -> tuple[float, float]:
    if block.size is not None:
        return block.size.width, block.size.height
    physical = [p for p in block.definition.ports if p.direction == 'physical']
    if physical and not any(p.direction != 'physical' for p in block.definition.ports):
        return 80, 48
    return 128, 96


def _pill_size(name: str) -> tuple[float, float]:
    return min(176, _snap(56 + len(name) * 8)), 32


def _port_side(port: Port) -> str:
    if port.side:
        return port.side
    return 'right' if port.direction == 'output' else 'left'


def _port_point(block: Block, port_id: str) -> tuple[float, float, str] | None:
    """Roughly where a port sits: the workbench's shared port geometry, approximated."""
    port = next((p for p in block.definition.ports if p.id == port_id), None)
    if port is None:
        return None
    width, height = _size(block)
    side = _port_side(port)
    same = [p for p in block.definition.ports if _port_side(p) == side]
    fraction = port.offset / 100 if port.offset is not None else (same.index(port) + 1) / (len(same) + 1)
    x, y = block.position.x, block.position.y
    if side == 'left':
        return x, y + fraction * height, side
    if side == 'right':
        return x + width, y + fraction * height, side
    if side == 'top':
        return x + fraction * width, y, side
    return x + fraction * width, y + height, side


def _boundary_definition(kind: str, name: str, domain: str, order: int, inner: Port | None, side: str | None = None) -> Definition:
    extra = {'width': inner.width, 'elements': inner.elements} if inner is not None and inner.width else {}
    if kind == 'inport':
        port = Port(id='y', name=name, direction='output', domain=domain, side='right', **extra)
    elif kind == 'outport':
        port = Port(id='u', name=name, direction='input', domain=domain, side='left', **extra)
    else:
        port = Port(id='p', name=name, direction='physical', domain=domain, side='left' if side == 'right' else 'right')
    description = (f'Physical {domain} terminal of the subsystem.' if kind == 'connport'
                   else f'Subsystem {"input" if kind == "inport" else "output"}.')
    return Definition(kind=kind, name=name, description=description, domain=domain,
                      symbol='⊙' if kind == 'connport' else str(order + 1), ports=[port], parameters=[],
                      equations='', category='routing', boundary=Boundary(order=order, side=side))


def boundary_definition(kind: str, name: str, domain: str, order: int) -> Definition:
    """A subsystem port block's definition (inport, outport, or connport), as lib/gradara/port-blocks.ts makes it."""
    return _boundary_definition(kind, name, domain, order, None)


def _instance_definition(subsystem: Subsystem, name: str) -> Definition:
    ports = instance_ports(subsystem)
    physical = next((p for p in ports if p.direction == 'physical'), None)
    if physical is not None:
        domain = physical.domain
    elif any(p.domain == 'boolean' for p in ports) and not any(p.domain == 'signal' for p in ports):
        domain = 'boolean'
    else:
        domain = 'signal'
    inside = len([b for b in subsystem.blocks if b.definition.boundary is None])
    return Definition(kind='subsystem', name=name[:100], description=f'Subsystem {subsystem.name}: {inside} blocks inside.',
                      domain=domain, symbol=subsystem.name[:24], ports=ports, parameters=[], equations='',
                      category='routing', subsystem={'ref': subsystem.id})


def next_subsystem_name(project: Project) -> str:
    """`Subsystem N` for the first N no block of the document is called (as the workbench names groups)."""
    names = {b.definition.name for sheet in [project, *(project.subsystems or [])] for b in sheet.blocks}
    n = 1
    while f'Subsystem {n}' in names:
        n += 1
    return f'Subsystem {n}'


def group(project: Project, block_ids: list[str], alias: str, name: str,
          validate: bool = True) -> tuple[Project, str]:
    """`project` with the top-level blocks `block_ids` replaced by one instance of a new subsystem.

    Returns the edited project and the instance's ID. Raises ValueError with a readable
    reason when the selection cannot be grouped. `project` may be the inside of a subsystem
    as server/sheets.py `sheet_view` makes it; the result is then not validated here
    (`validate=False`), since its port blocks belong inside, and is checked once written back.
    """
    if len(block_ids) != len(set(block_ids)):
        raise ValueError('A block is listed twice in the group.')
    if not 2 <= len(block_ids) <= MAX_GROUPED:
        raise ValueError(f'A group needs 2 to {MAX_GROUPED} blocks.')
    by_id = {b.id: b for b in project.blocks}
    inner_ids: set[str] = set()
    nested = {b.id for s in project.subsystems or [] for b in s.blocks}
    for ident in block_ids:
        block = by_id.get(ident)
        if block is None:
            if ident in nested:
                raise ValueError(f'"{ident}" is inside a subsystem; the AI groups top-level blocks only.')
            raise ValueError(f'Unknown block "{ident}" to group.')
        if block.definition.kind in BOUNDARY_KINDS and block.definition.boundary is not None:
            raise ValueError(f'{block.definition.name} is a subsystem port; it cannot be grouped.')
        inner_ids.add(ident)
    taken_blocks = set(by_id) | {j.id for j in project.junctions}
    instance_id = f'b_{alias}'
    subsystem_id = f's_{alias}'
    if instance_id in taken_blocks:
        raise ValueError(f'The alias "{alias}" clashes with an existing block ID.')
    if any(s.id == subsystem_id for s in project.subsystems or []):
        raise ValueError(f'The alias "{alias}" clashes with an existing subsystem.')

    # Tags reach down only: a Goto moved inside is lost to a From left outside.
    for block in project.blocks:
        if block.id in inner_ids and block.definition.kind == 'goto' and block.definition.tag:
            tag = block.definition.tag
            outside = [b for b in project.blocks if b.id not in inner_ids and b.definition.kind == 'from'
                       and b.definition.tag == tag]
            if outside:
                raise ValueError(f'The Goto [{tag}] ({block.definition.name}) feeds From blocks outside the group '
                                 f'({", ".join(b.definition.name for b in outside)}). Tags reach down only: group the '
                                 'From too, or leave the Goto outside.')

    junction_ids = {j.id for j in project.junctions}
    ports = {(b.id, p.id): p for b in project.blocks for p in b.definition.ports}

    def key(ident: str, handle: str) -> str:
        return f'j:{ident}' if ident in junction_ids else f'{ident}.{handle}'

    def block_of(k: str) -> str | None:
        return None if k.startswith('j:') else k[:k.rindex('.')]

    def port_of(k: str) -> Port | None:
        if k.startswith('j:'):
            return None
        ident = block_of(k)
        return ports.get((ident, k[len(ident) + 1:]))

    # Connected components over every endpoint, junction nodes included (net_components drops them).
    adjacency: dict[str, set[str]] = {}
    for wire in project.wires:
        a, b = key(wire.source, wire.sourceHandle), key(wire.target, wire.targetHandle)
        adjacency.setdefault(a, set()).add(b)
        adjacency.setdefault(b, set()).add(a)
    component_of: dict[str, tuple[str, ...]] = {}
    for seed in sorted(adjacency):
        if seed in component_of:
            continue
        seen, stack = [], [seed]
        while stack:
            current = stack.pop()
            if current in seen:
                continue
            seen.append(current)
            stack.extend(adjacency[current] - set(seen))
        component = tuple(sorted(seen))
        for k in component:
            component_of[k] = component
    # A junction moves inside when every block on its net is inside.
    inside_junctions = set()
    for j in junction_ids:
        blocks_on = [block_of(k) for k in component_of.get(f'j:{j}', ()) if not k.startswith('j:')]
        if blocks_on and all(b in inner_ids for b in blocks_on):
            inside_junctions.add(j)

    def is_inside(ident: str) -> bool:
        return ident in inner_ids or ident in inside_junctions

    nets_by_wire = {w: n for n in project.nets or [] for w in n.wireIds}
    boundaries: dict[tuple[str, ...], dict] = {}
    names: set[str] = set()
    port_ids: set[str] = set()
    order = 0

    def boundary_for(component: tuple[str, ...], inside_key: str, wire_id: str) -> dict:
        nonlocal order
        existing = boundaries.get(component)
        if existing is not None:
            return existing
        component_ports = [(block_of(k), port_of(k)) for k in component if not k.startswith('j:')]
        component_ports = [(b, p) for b, p in component_ports if p is not None]
        domain = component_ports[0][1].domain if component_ports else 'signal'
        if domain == 'physicalBus':
            raise ValueError('Grouping across a physical bus line is not supported yet. Group the blocks on one side of '
                             'the bus, or leave the bus line and its blocks out.')
        driver = next(((b, p) for b, p in component_ports if p.direction == 'output'), None)
        if domain not in CAUSAL_DOMAINS:
            kind = 'connport'
        elif driver is not None and driver[0] in inner_ids:
            kind = 'outport'
        else:
            kind = 'inport'
        net = nets_by_wire.get(wire_id)
        inside_port = port_of(inside_key)
        if net is not None and net.name:
            base = net.name
        elif inside_port is not None and inside_port.name not in GENERIC_PORT_NAMES and kind != 'connport':
            base = inside_port.name
        elif kind == 'inport':
            base = 'in'
        elif kind == 'outport':
            base = 'out'
        else:
            base = inside_port.name if inside_port is not None and inside_port.name else domain
        port_name = _unique(names, base.strip() or 'port')
        ident = _unique(port_ids, f'p_{alias}_{_port_id_text(port_name, domain)}', '_')
        definition = _boundary_definition(kind, port_name, domain, order, inside_port)
        order += 1
        width, height = _pill_size(port_name)
        entry = dict(block=Block(id=ident, definition=definition, position=Position(x=0, y=0),
                                 size=Size(width=width, height=height)),
                     handle=definition.ports[0].id, direction=BOUNDARY_KINDS[kind], kind=kind)
        boundaries[component] = entry
        return entry

    inner_wires: list[Wire] = []
    outer_wires: list[Wire] = []
    inner_for: dict[str, str] = {}    # cut wire ID outside → its new wire inside
    seen_inner: set[tuple] = set()
    seen_outer: set[tuple] = set()
    outer_ids: set[str] = set()
    wire_count = 0
    for wire in project.wires:
        a, b = is_inside(wire.source), is_inside(wire.target)
        if a and b:
            inner_wires.append(wire)
            continue
        if not a and not b:
            outer_wires.append(wire)
            outer_ids.add(wire.id)
            continue
        in_id, in_handle, out_id, out_handle = ((wire.source, wire.sourceHandle, wire.target, wire.targetHandle) if a
                                                else (wire.target, wire.targetHandle, wire.source, wire.sourceHandle))
        inside_key = key(in_id, in_handle)
        boundary = boundary_for(component_of[inside_key], inside_key, wire.id)
        port_block: Block = boundary['block']
        inner_key = (port_block.id, inside_key)
        if inner_key not in seen_inner:
            seen_inner.add(inner_key)
            wire_count += 1
            inner_id = f'w_{alias}_{wire_count}'
            inner_for[wire.id] = inner_id
            # Signal wires run from the driver to the consumer; a terminal wire starts at the port.
            if boundary['direction'] in ('input', 'physical'):
                inner_wires.append(Wire(id=inner_id, source=port_block.id, sourceHandle=boundary['handle'],
                                        target=in_id, targetHandle=in_handle))
            else:
                inner_wires.append(Wire(id=inner_id, source=in_id, sourceHandle=in_handle,
                                        target=port_block.id, targetHandle=boundary['handle']))
        outer_key = (port_block.id, key(out_id, out_handle))
        if outer_key not in seen_outer:
            seen_outer.add(outer_key)
            outer_id = wire.id
            if outer_id in outer_ids:
                wire_count += 1
                outer_id = f'w_{alias}_{wire_count}'
            outer_ids.add(outer_id)
            if boundary['direction'] == 'input':
                outer_wires.append(Wire(id=outer_id, source=out_id, sourceHandle=out_handle,
                                        target=instance_id, targetHandle=port_block.id))
            else:
                outer_wires.append(Wire(id=outer_id, source=instance_id, sourceHandle=port_block.id,
                                        target=out_id, targetHandle=out_handle))

    inner_blocks = [b for b in project.blocks if b.id in inner_ids]
    left = min(b.position.x for b in inner_blocks)
    top = min(b.position.y for b in inner_blocks)
    right = max(b.position.x + _size(b)[0] for b in inner_blocks)
    bottom = max(b.position.y + _size(b)[1] for b in inner_blocks)
    # Port pills sit outside the grouped blocks, level with the port they join, and apart from each other.
    placed: dict[str, list[Block]] = {'left': [], 'right': []}
    for entry in boundaries.values():
        pill: Block = entry['block']
        wire = next(w for w in inner_wires if pill.id in (w.source, w.target))
        other_id, handle = (wire.target, wire.targetHandle) if wire.source == pill.id else (wire.source, wire.sourceHandle)
        other = by_id.get(other_id)
        point = _port_point(other, handle) if other is not None else None
        width, height = pill.size.width, pill.size.height
        on_right = entry['direction'] == 'output' or (entry['direction'] == 'physical' and point is not None and point[2] == 'right')
        x = right + GAP if on_right else left - GAP - width
        y = (point[1] if point is not None else top) - height / 2
        pill.position = Position(x=_snap(x), y=_snap(y))
        if entry['kind'] == 'connport' and on_right:
            pill.definition = _boundary_definition('connport', pill.definition.name, pill.definition.domain,
                                                   pill.definition.boundary.order, None, 'right')
        placed['right' if on_right else 'left'].append(pill)
    for column in placed.values():
        column.sort(key=lambda p: (p.position.y, p.id))
        floor = -math.inf
        for pill in column:
            if pill.position.y < floor:
                pill.position = Position(x=pill.position.x, y=floor)
            floor = pill.position.y + pill.size.height + GRID * 2

    # Canonical port numbers: inputs, outputs, then terminals, each numbered from 1.
    sorted_pills = sorted((e['block'] for e in boundaries.values()),
                          key=lambda b: (b.definition.boundary.order, b.position.y, b.id))
    index = 0
    for kind in KIND_ORDER:
        for number, pill in enumerate(p for p in sorted_pills if p.definition.kind == kind):
            pill.definition.boundary = Boundary(order=index, side=pill.definition.boundary.side)
            if kind != 'connport':
                pill.definition.symbol = str(number + 1)
            index += 1

    inner_wire_ids = {w.id for w in inner_wires}
    outer_wire_ids = {w.id for w in outer_wires}

    def endpoints(wires: list[Wire], ids: list[str]) -> set[str]:
        by_wire = {w.id: w for w in wires}
        return {k for i in ids for w in [by_wire[i]] for k in (key(w.source, w.sourceHandle), key(w.target, w.targetHandle))}

    def copy_net(net: Net, wires: list[Wire], ids: list[str], inside: bool) -> Net:
        ends = endpoints(wires, ids)
        by_wire = {w.id: w for w in wires}
        anchor = net.anchor if net.anchor in ends else key(by_wire[ids[0]].source, by_wire[ids[0]].sourceHandle)
        label = net.label if net.label is not None and net.label.wireId in ids else None
        return Net(id=net.id, name=net.name, aliases=list(net.aliases), anchor=anchor, wireIds=ids, label=label,
                   hidden=net.hidden, showName=net.showName, logged=False if inside else net.logged)

    inner_nets = outer_nets = None
    if project.nets is not None:
        inner_nets, outer_nets = [], []
        for net in project.nets:
            inside_ids = [inner_for.get(w, w) for w in net.wireIds]
            inside_ids = [w for w in inside_ids if w in inner_wire_ids]
            if inside_ids:
                inner_nets.append(copy_net(net, inner_wires, inside_ids, True))
            outside_ids = [w for w in net.wireIds if w in outer_wire_ids]
            if outside_ids:
                outer_nets.append(copy_net(net, outer_wires, outside_ids, False))

    subsystem = Subsystem(id=subsystem_id, name=name, blocks=[*inner_blocks, *sorted_pills], wires=inner_wires,
                          junctions=[j for j in project.junctions if j.id in inside_junctions], nets=inner_nets)
    definition = _instance_definition(subsystem, name)
    est_width, est_height = 176, 96
    instance = Block(id=instance_id, definition=definition,
                     position=Position(x=_snap((left + right) / 2 - est_width / 2),
                                       y=_snap((top + bottom) / 2 - est_height / 2)))
    edited = project.model_copy(update=dict(
        version=2,
        blocks=[*(b for b in project.blocks if b.id not in inner_ids), instance],
        wires=outer_wires,
        junctions=[j for j in project.junctions if j.id not in inside_junctions],
        nets=outer_nets,
        subsystems=[*(project.subsystems or []), subsystem]))
    if not validate:
        return edited, instance_id
    try:
        result = Project.model_validate(edited.model_dump())
    except ValidationError as exc:
        raise ValueError('The grouped model is not valid: ' + '; '.join(e['msg'] for e in exc.errors()[:3])) from exc
    return result, instance_id
