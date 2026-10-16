# SPDX-License-Identifier: Apache-2.0
"""Goto/From tags and connection labels.

A Goto block takes a signal and a From block with the same tag gives it back, so a
signal can reach far parts of a diagram without a wire. A connection label joins every
physical terminal wired to a label with the same tag into one node. Tags reach down a
hierarchy, never up: a From finds the Goto with its tag on its own sheet or, failing
that, on the nearest sheet above it on its instance path; labels on a sheet join the
labels with their tag on the sheets above. A Goto inside a subsystem is not seen by a
From outside it.

Nothing downstream knows about tags. `lower_tags` turns a document into an ordinary
one: on every sheet, the tag blocks of one tag become one junction, and a tag that
reaches into a subsystem becomes a hidden port of that subsystem (an input for a
signal, a terminal for a physical label) wired to the junction above. Emission, code
generation and the run see plain wires.
"""
from __future__ import annotations

from .models import Block, Boundary, Definition, Junction, Port, Position, Project, Wire

GOTO, FROM, LABEL = 'goto', 'from', 'connectionLabel'
TAG_KINDS = {GOTO: 'input', FROM: 'output', LABEL: 'physical'}
NODE = 'node'


def is_tag(block: Block) -> bool:
    return block.definition.kind in TAG_KINDS


def _sheets(project: Project) -> dict:
    return {None: project, **{s.id: s for s in (project.subsystems or [])}}


def _children(sheet) -> list[tuple[Block, str]]:
    return [(b, b.definition.subsystem.ref) for b in sheet.blocks if b.definition.subsystem is not None]


def _by_tag(sheet, kinds: set[str]) -> dict[str, list[Block]]:
    found: dict[str, list[Block]] = {}
    for block in sheet.blocks:
        if block.definition.kind in kinds and block.definition.tag:
            found.setdefault(block.definition.tag, []).append(block)
    return found


def has_tags(project: Project) -> bool:
    return any(is_tag(b) for sheet in _sheets(project).values() for b in sheet.blocks)


def tag_problems(project: Project) -> list[dict]:
    """What keeps tags from connecting: a tag block without a tag, two Gotos with one tag
    on a sheet, a From with no Goto on its sheet or above, and blocks of one tag that
    carry different kinds of value. Each is {message, blockIds, sheet, hint}."""
    sheets = _sheets(project)
    problems: list[dict] = []
    seen: set[tuple] = set()

    def add(key, message, block_ids, sheet, hint):
        if key not in seen:
            seen.add(key)
            problems.append(dict(message=message, blockIds=block_ids, sheet=sheet, hint=hint))

    for sheet_id, sheet in sheets.items():
        for block in sheet.blocks:
            if is_tag(block) and not block.definition.tag:
                add(('untagged', sheet_id, block.id), f'{block.definition.name} has no tag.', [block.id], sheet_id,
                    'Give it a tag in its properties: letters, digits and _.')
        for tag, gotos in _by_tag(sheet, {GOTO}).items():
            if len(gotos) > 1:
                add(('twice', sheet_id, tag), f'Two Goto blocks on one sheet use the tag [{tag}].',
                    [b.id for b in gotos], sheet_id, 'Keep one Goto per tag on a sheet; rename the other.')
        for tag, blocks in _by_tag(sheet, {GOTO, FROM}).items():
            domains = {b.definition.ports[0].domain for b in blocks}
            if len(domains) > 1:
                add(('mixed', sheet_id, tag), f'The Goto and From blocks tagged [{tag}] carry different kinds of signal.',
                    [b.id for b in blocks], sheet_id, 'Use one tag for signals and another for Boolean values.')
        for tag, labels in _by_tag(sheet, {LABEL}).items():
            domains = {b.definition.ports[0].domain for b in labels}
            if len(domains) > 1:
                add(('mixed-label', sheet_id, tag), f'The connection labels [{tag}] join different physical domains.',
                    [b.id for b in labels], sheet_id, 'Use one tag per domain.')

    # Froms: walk every instance path, carrying the tags whose Goto is on a sheet above.
    def walk(sheet_id, above: frozenset, path: tuple):
        sheet = sheets[sheet_id]
        here = above | frozenset(_by_tag(sheet, {GOTO}))
        for tag, froms in _by_tag(sheet, {FROM}).items():
            if tag not in here:
                add(('orphan', sheet_id, tag), f'No Goto [{tag}] on this sheet or above it for the From [{tag}].',
                    [b.id for b in froms], sheet_id,
                    'Add a Goto with this tag here or on a sheet above. A Goto inside a subsystem is not seen outside it.')
        for block, ref in _children(sheet):
            if ref in sheets and ref not in path:
                walk(ref, here, path + (ref,))

    walk(None, frozenset(), ())
    return problems


def _unique(taken: set[str], base: str) -> str:
    ident, n = base, 1
    while ident in taken:
        n += 1
        ident = f'{base}_{n}'
    taken.add(ident)
    return ident


def lower_tags(project: Project) -> Project:
    """The same model with every tag turned into wires, junctions and hidden subsystem ports."""
    if not has_tags(project):
        return project
    project = project.model_copy(deep=True)
    sheets = _sheets(project)

    def domain_of(sheet, tag, kinds):
        blocks = _by_tag(sheet, kinds).get(tag)
        return blocks[0].definition.ports[0].domain if blocks else None

    # Signals: the tags a sheet needs from above (a From without a Goto here, or a child that needs it).
    need: dict = {}

    def signal_need(ref, path=()):
        if ref in need:
            return need[ref]
        sheet = sheets[ref]
        gotos = set(_by_tag(sheet, {GOTO}))
        wanted = {t: domain_of(sheet, t, {FROM}) for t in _by_tag(sheet, {FROM}) if t not in gotos}
        for _, child in _children(sheet):
            if child in sheets and child not in path:
                for t, d in signal_need(child, path + (ref,)).items():
                    if t not in gotos:
                        wanted.setdefault(t, d)
        need[ref] = wanted
        return wanted

    # Physical: the label tags used on a sheet or below it, and those a sheet receives from above.
    use: dict = {}

    def label_use(ref, path=()):
        if ref in use:
            return use[ref]
        sheet = sheets[ref]
        used = {t: domain_of(sheet, t, {LABEL}) for t in _by_tag(sheet, {LABEL})}
        for _, child in _children(sheet):
            if child in sheets and child not in path:
                for t, d in label_use(child, path + (ref,)).items():
                    used.setdefault(t, d)
        use[ref] = used
        return used

    received: dict = {ref: {} for ref in sheets}
    visited: set = set()

    def receive(ref, above: dict, path=()):
        key = (ref, tuple(sorted(above)))
        if key in visited:
            return
        visited.add(key)
        sheet = sheets[ref]
        scope = {**above, **{t: d for t, d in label_use(ref).items() if t in _by_tag(sheet, {LABEL})}}
        for _, child in _children(sheet):
            if child in sheets and child not in path:
                got = {t: d for t, d in scope.items() if t in label_use(child)}
                received[child].update(got)
                receive(child, got, path + (ref,))

    receive(None, {})
    for ref in sheets:
        if ref is not None:
            signal_need(ref)
    # Hidden ports are named before any sheet changes, so a parent can wire to them.
    hidden: dict = {}
    for ref, sheet in sheets.items():
        taken = {b.id for b in sheet.blocks} | {j.id for j in sheet.junctions} | {w.id for w in sheet.wires}
        names = {}
        for tag in sorted(need.get(ref, {}) if ref is not None else {}):
            names[('in', tag)] = _unique(taken, f'tag_in_{tag}')
        for tag in sorted(received.get(ref, {})):
            names[('io', tag)] = _unique(taken, f'tag_io_{tag}')
        hidden[ref] = names

    for ref, sheet in sheets.items():
        taken = ({b.id for b in sheet.blocks} | {j.id for j in sheet.junctions} | {w.id for w in sheet.wires}
                 | set(hidden[ref].values()))
        junctions = list(sheet.junctions)
        wires = list(sheet.wires)
        blocks = [b for b in sheet.blocks if not is_tag(b)]
        order = len([b for b in blocks if b.definition.boundary is not None])

        def node(tag, domain, at, kind):
            ident = _unique(taken, f'tag_{kind}_{tag}')
            junctions.append(Junction.model_construct(id=ident, position=at, domain=domain))
            return ident

        def hidden_port(kind, tag, domain):
            nonlocal order
            ident = hidden[ref][('in' if kind == 'inport' else 'io', tag)]
            port = (Port(id='y', name=tag, direction='output', domain=domain, side='right') if kind == 'inport'
                    else Port(id='p', name=tag, direction='physical', domain=domain, side='right'))
            definition = Definition.model_construct(
                kind=kind, name=f'[{tag}]', description='Tag from the sheet above.', domain=domain, symbol='',
                ports=[port], parameters=[], equations='', declarations='', generated=False, controller=False,
                category='', keywords=[], modelica=None, subsystem=None,
                boundary=Boundary.model_construct(side=None, order=order), ctemplate=None, tag=None)
            order += 1
            blocks.append(Block.model_construct(id=ident, definition=definition, position=Position(x=0, y=0),
                                                size=None, labelOffset=None, rotation=None, flip=None,
                                                terminated=None))
            return ident, port.id

        def wire(a, ah, b, bh):
            wires.append(Wire.model_construct(id=_unique(taken, 'tag_w'), source=a, sourceHandle=ah,
                                              target=b, targetHandle=bh, waypoints=None, junctions=[]))

        extra: dict[str, list[Port]] = {}

        def to_instance(junction, instance, hidden_id, direction, domain):
            wire(junction, NODE, instance.id, hidden_id)
            extra.setdefault(instance.id, []).append(
                Port(id=hidden_id, name=hidden_id, direction=direction, domain=domain, side='left'))

        def retarget(tag_blocks, junction):
            ids = {b.id for b in tag_blocks}
            for i, w in enumerate(wires):
                if w.source in ids or w.target in ids:
                    w = w.model_copy()
                    if w.source in ids:
                        w.source, w.sourceHandle = junction, NODE
                    if w.target in ids:
                        w.target, w.targetHandle = junction, NODE
                    wires[i] = w

        children = _children(sheet)
        # Signals.
        local = _by_tag(sheet, {GOTO, FROM})
        wanted_here = need.get(ref, {}) if ref is not None else {}
        child_needs = {t for _, c in children if c in need for t in need[c]}
        for tag in sorted(set(local) | set(wanted_here) | child_needs):
            tag_blocks = local.get(tag, [])
            domain = (tag_blocks[0].definition.ports[0].domain if tag_blocks
                      else wanted_here.get(tag) or next(need[c][tag] for _, c in children if tag in need.get(c, {})))
            at = tag_blocks[0].position if tag_blocks else Position(x=0, y=0)
            junction = node(tag, domain, at, 's')
            retarget(tag_blocks, junction)
            if tag in wanted_here:
                port, handle = hidden_port('inport', tag, domain)
                wire(port, handle, junction, NODE)
            for instance, child in children:
                if tag in need.get(child, {}):
                    to_instance(junction, instance, hidden[child][('in', tag)], 'input', domain)
        # Physical labels.
        labels = _by_tag(sheet, {LABEL})
        got = received.get(ref, {})
        child_gets = {t for _, c in children for t in received.get(c, {})}
        for tag in sorted(set(labels) | (set(got) & set(label_use(ref))) | child_gets):
            tag_blocks = labels.get(tag, [])
            domain = (tag_blocks[0].definition.ports[0].domain if tag_blocks
                      else got.get(tag) or next(received[c][tag] for _, c in children if tag in received.get(c, {})))
            at = tag_blocks[0].position if tag_blocks else Position(x=0, y=0)
            junction = node(tag, domain, at, 'p')
            retarget(tag_blocks, junction)
            if tag in got:
                port, handle = hidden_port('connport', tag, domain)
                wire(port, handle, junction, NODE)
            for instance, child in children:
                if tag in received.get(child, {}):
                    to_instance(junction, instance, hidden[child][('io', tag)], 'physical', domain)
        # The instances list the hidden ports their insides gained.
        blocks = [b if b.id not in extra else b.model_copy(update={'definition': b.definition.model_copy(
                      update={'ports': [*b.definition.ports, *extra[b.id]]})}) for b in blocks]
        sheet.blocks, sheet.wires, sheet.junctions = blocks, wires, junctions
    return project

