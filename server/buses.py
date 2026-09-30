"""Signal buses on the server: the Modelica side of lib/gradara/buses.ts.

The editor derives every bus port's width and element names (`propagateBuses`);
the document stores them on the ports. Here they become array connectors, and
the bus blocks' equations are generated from the ports rather than taken from
the document. `bus_problems` refuses a document whose widths disagree, with the
same messages the editor shows.
"""
from .models import Definition, Port, flatten_connects

BUS_KINDS = {'mux', 'demux', 'busCreator', 'busSelector'}


def is_bus_block(definition: Definition) -> bool:
    return (definition.kind in BUS_KINDS and not definition.generated
            and definition.subsystem is None and definition.boundary is None)


def width(port: Port | None) -> int:
    return (port.width if port is not None else None) or 1


def element_names(port: Port | None) -> list[str]:
    w = width(port)
    if w == 1:
        return []
    if port.elements and len(port.elements) == w:
        return list(port.elements)
    return [f'signal{i + 1}' for i in range(w)]


def selected_indices(bus: Port | None, name: str) -> list[int]:
    """1-based positions of a Bus Selector output's signals in its input bus."""
    available = element_names(bus)
    if name in available:
        return [available.index(name) + 1]
    return [i + 1 for i, e in enumerate(available) if e.startswith(f'{name}.')]


def _inputs(d: Definition):
    return [p for p in d.ports if p.direction == 'input']


def _outputs(d: Definition):
    return [p for p in d.ports if p.direction == 'output']


def bus_equations(d: Definition) -> str:
    """A bus block's equations from its ports (the same text the editor stores)."""
    ins, outs = _inputs(d), _outputs(d)
    if d.kind in ('mux', 'busCreator'):
        y = outs[0].id if outs else 'y'
        if all(width(p) == 1 for p in ins):
            return f'{y} = {{{", ".join(p.id for p in ins)}}};'
        parts = ', '.join(f'{{{p.id}}}' if width(p) == 1 else p.id for p in ins)
        return f'{y} = cat(1, {parts});'
    u = ins[0] if ins else None
    uid = u.id if u else 'u'
    if d.kind == 'demux':
        part = max(1, width(u) // max(1, len(outs)))
        return '\n'.join(f'{p.id} = {uid}[{k + 1}];' if part == 1 else f'{p.id} = {uid}[{k * part + 1}:{(k + 1) * part}];'
                         for k, p in enumerate(outs))
    lines = []
    for p in outs:
        at = selected_indices(u, p.name)
        lines.append(f'{p.id} = {uid}[{{{", ".join(map(str, at))}}}];' if len(at) > 1 else f'{p.id} = {uid}[{at[0] if at else 1}];')
    return '\n'.join(lines)


def expected_outputs(d: Definition) -> dict[str, tuple[int, list[str] | None]]:
    """Output port ID → (width, element names) its inputs imply."""
    ins, outs = _inputs(d), _outputs(d)
    found = {}
    if d.kind in ('mux', 'busCreator'):
        total = sum(width(p) for p in ins)
        elements = None
        if d.kind == 'busCreator' and total > 1:
            elements = [e for p in ins for e in ([p.name] if width(p) == 1 else [f'{p.name}.{n}' for n in element_names(p)])]
        for p in outs:
            found[p.id] = (total, elements)
    elif d.kind == 'demux':
        u = ins[0] if ins else None
        w, n = width(u), len(outs)
        part = w // n if n and w % n == 0 else 1
        for k, p in enumerate(outs):
            names = u.elements[k * part:(k + 1) * part] if part > 1 and u is not None and u.elements else None
            found[p.id] = (part, names)
    elif d.kind == 'busSelector':
        u = ins[0] if ins else None
        available = element_names(u)
        for p in outs:
            under = [e[len(p.name) + 1:] for e in available if e.startswith(f'{p.name}.')]
            found[p.id] = (len(under), under) if p.name not in available and len(under) > 1 else (1, None)
    return found


def bus_problems(diagram) -> list[dict]:
    """Width and naming mistakes on one diagram, as the editor reports them (busProblems)."""
    blocks = {b.id: b for b in diagram.blocks}
    port = {(b.id, p.id): p for b in diagram.blocks for p in b.definition.ports}
    problems = []
    connected = set()
    for a, b, c, d in flatten_connects(diagram):
        source, target = port[(a, b)], port[(c, d)]
        connected.add((c, d))
        if source.direction != 'output' or target.domain != 'signal':
            continue
        w, here = width(source), width(target)
        if w == here:
            continue
        name = f'{blocks[c].definition.name}.{target.name}'
        problems.append(dict(
            blockId=c, portId=d,
            message=f'{name} takes one signal, but {blocks[a].definition.name} sends a bus of {w}.' if here == 1
            else f'{name} expects {here} signals but receives {w}.',
            hint='Split the bus with a Demux, or pick signals out of it with a Bus Selector.' if here == 1
            else 'A subsystem used in several places must receive the same bus width everywhere.'))
    for block in diagram.blocks:
        d = block.definition
        if not is_bus_block(d):
            continue
        ins, outs = _inputs(d), _outputs(d)
        u = ins[0] if ins else None
        if d.kind == 'demux' and u is not None and (block.id, u.id) in connected:
            w, n = width(u), len(outs)
            if w == 1 or w % n:
                problems.append(dict(
                    blockId=block.id, portId=None,
                    message=f'{d.name} receives one signal; there is nothing to split.' if w == 1
                    else f'{d.name} cannot split {w} signals into {n} equal parts.',
                    hint='Feed it a vector from a Mux or a bus from a Bus Creator.' if w == 1
                    else f'Set its outputs to {w}, or to a number that divides {w}.'))
                continue
        if d.kind == 'busSelector' and u is not None and (block.id, u.id) in connected:
            if width(u) == 1:
                problems.append(dict(blockId=block.id, portId=None, message=f'{d.name} receives one signal, not a bus.',
                                     hint='Connect it to the output of a Bus Creator or a Mux.'))
                continue
            missing = [p for p in outs if not selected_indices(u, p.name)]
            for p in missing:
                problems.append(dict(blockId=block.id, portId=p.id,
                                     message=f'{d.name}: the incoming bus has no signal named {p.name}.',
                                     hint='Choose its signals again in the block’s properties.'))
            if missing:
                continue
        if d.kind == 'busCreator':
            names = [p.name for p in ins]
            if len(set(names)) != len(names):
                problems.append(dict(blockId=block.id, portId=None, message=f'{d.name} names two signals the same.',
                                     hint='Give each signal in a bus its own name.'))
                continue
        expected = expected_outputs(d)
        if any((width(p), p.elements if width(p) > 1 else None) != (
                expected[p.id][0], expected[p.id][1] if expected[p.id][0] > 1 else None) for p in outs):
            problems.append(dict(blockId=block.id, portId=None,
                                 message=f'The bus widths stored for {d.name} do not match its inputs.',
                                 hint='Open the model in Gradara and save it again; the editor recomputes bus widths.'))
    return problems


def array_suffix(port: Port) -> str:
    """`[n]` for a bus connector, empty for one signal."""
    return f'[{port.width}]' if port.width else ''
