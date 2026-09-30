"""Log signal nets only. Physical quantities are selected through sensor blocks."""
from . import msl
from .models import BOUNDARY_KINDS, CAUSAL_DOMAINS, Project


def _scopes(project: Project):
    """(diagram, variable prefix, readable prefix, top-level block ID) for the top level and every subsystem instance."""
    by_id = {s.id: s for s in (project.subsystems or [])}

    def walk(diagram, prefix, label, top):
        yield diagram, prefix, label, top
        for block in diagram.blocks:
            ref = block.definition.subsystem.ref if block.definition.subsystem else None
            if ref in by_id:
                yield from walk(by_id[ref], f'{prefix}{block.id}.', f'{label}{block.definition.name} › ', top or block.id)
    yield from walk(project, '', '', None)


def logged_signals(project: Project):
    used = {b.id for b in project.blocks}
    result = []
    for diagram, prefix, label, top in _scopes(project):
        blocks = {b.id: b for b in diagram.blocks}
        wires = {w.id: w for w in diagram.wires}
        for net in sorted(diagram.nets or [], key=lambda n: n.id):
            if not net.logged:
                continue
            terminals = {}
            for wire_id in net.wireIds:
                w = wires[wire_id]
                for block_id, port_id in [(w.source, w.sourceHandle), (w.target, w.targetHandle)]:
                    if block_id in blocks:
                        port = next(p for p in blocks[block_id].definition.ports if p.id == port_id)
                        terminals[f'{block_id}.{port_id}'] = (blocks[block_id], port)
            key = next((k for k, (_, p) in sorted(terminals.items()) if p.direction == 'output'), None)
            key = key or (net.anchor if net.anchor in terminals else next(iter(sorted(terminals)), None))
            if key is None:
                continue
            block, port = terminals[key]
            if port.domain not in CAUSAL_DOMAINS:
                raise ValueError('Only signal/control nets can be logged. Add a sensor and log its signal output.')
            field, unit = '', port.unit
            variable = f'gradara_log_{prefix.replace(".", "_")}{net.id}'
            while variable in used:
                variable += '_value'
            used.add(variable)
            if block.definition.boundary is not None and block.definition.kind in BOUNDARY_KINDS:
                reference = f'{prefix}{block.id}'  # the subsystem's own connector
            else:
                reference = f'{prefix}{block.id}.{msl.connector(block.definition, port.id)}'
            expression = reference + ('.'+field if field else '')
            if port.domain == 'boolean':
                expression = f'(if {expression} then 1.0 else 0.0)'
            name = (net.name or f'{block.definition.name}.{port.id}') + (f' · {field}' if field else '')
            entry = dict(key=variable, expression=expression, netId=net.id, path=prefix.rstrip('.') or None,
                         blockId=top or block.id, name=label + name, unit=unit)
            if port.width:  # a bus: one logged series per signal (server/engine.py)
                entry |= dict(width=port.width, elements=port.elements)
            result.append(entry)
    return result
