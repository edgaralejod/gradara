"""Readable execution-boundary checks. OpenModelica still owns equation solvability."""
import re
from .models import Project, flatten_connects


def validate_simulation(project: Project):
    connections = flatten_connects(project)
    connected = {(a, b) for a, b, _, _ in connections} | {(c, d) for _, _, c, d in connections}
    missing = [f'{b.definition.name}.{p.name}' for b in project.blocks for p in b.definition.ports if p.direction == 'input' and (b.id, p.id) not in connected]
    if missing:
        raise RuntimeError('Connect these signal inputs before running:\n' + '\n'.join(f'• {name}' for name in missing))
    unfinished = [b.definition.name for b in project.blocks if not b.definition.generated and b.definition.kind in {'mux', 'demux', 'subsystem'}]
    if unfinished:
        raise RuntimeError('These blocks do not have their full simulation behavior yet: ' + ', '.join(unfinished) + '. Replace them with explicit signal connections before running.')


def explain_failure(project: Project, message: str):
    # Keep the solver's diagnostics, but make generated instance IDs recognizable.
    names = {b.id: b.definition.name for b in project.blocks}
    for identifier in sorted(names, key=len, reverse=True):
        message = re.sub(r'\b' + re.escape(identifier) + r'\b', names[identifier], message)
    if 'linear system' in message.lower() or 'singular' in message.lower():
        message = 'OpenModelica could not solve an algebraic loop. Check feedback signs and gains; a direct positive-feedback loop with total gain 1 has no unique solution.\n\n' + message
    return message
