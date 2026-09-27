"""Log signal nets only. Physical quantities are selected through sensor blocks."""
from . import msl
from .models import CAUSAL_DOMAINS, Project


def logged_signals(project: Project):
    blocks = {b.id: b for b in project.blocks}
    wires = {w.id: w for w in project.wires}
    used = set(blocks)
    result = []
    for net in sorted(project.nets or [], key=lambda n: n.id):
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
        variable = f'gradara_log_{net.id}'
        while variable in used:
            variable += '_value'
        used.add(variable)
        expression = f'{block.id}.{msl.connector(block.definition, port.id)}' + ('.'+field if field else '')
        if port.domain == 'boolean':
            expression = f'(if {expression} then 1.0 else 0.0)'
        result.append(dict(key=variable, expression=expression, netId=net.id,
            blockId=block.id, name=(net.name or f'{block.definition.name}.{port.id}') + (f' · {field}' if field else ''), unit=unit))
    return result
