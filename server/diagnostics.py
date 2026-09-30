"""Readable execution-boundary checks. OpenModelica still owns equation solvability."""
import re
from typing import Literal
from pydantic import BaseModel, Field
from .models import Project, flatten_connects

Severity = Literal['error', 'warning', 'info']
Source = Literal['validation', 'safety', 'compiler', 'runtime', 'engine']
LOOP_HINT = ('OpenModelica could not solve an algebraic loop. Check feedback signs and gains; a direct '
             'positive-feedback loop with total gain 1 has no unique solution.')
# Blocks whose output does not depend instantaneously on their input.
STATEFUL = re.compile(r'\bder\s*\(|\bsample\s*\(|\bdelay\s*\(|\bpre\s*\(')


class PortRef(BaseModel):
    blockId: str
    portId: str


class Diagnostic(BaseModel):
    """One problem the Problems list can show and select; `detail` keeps the raw text."""
    id: str = ''
    severity: Severity = 'error'
    source: Source
    message: str = Field(max_length=4000)
    detail: str = ''
    blockIds: list[str] = []
    ports: list[PortRef] = []
    netIds: list[str] = []
    wireIds: list[str] = []
    hint: str | None = None


class SimulationFailure(RuntimeError):
    """A failed run whose `str()` stays the readable message and carries structured diagnostics."""

    def __init__(self, message: str, diagnostics: list[Diagnostic]):
        super().__init__(message)
        self.diagnostics = numbered(diagnostics)


class EngineUnavailable(RuntimeError):
    """The numerical engine could not start or finish, independent of the model."""


def numbered(diagnostics: list[Diagnostic]) -> list[Diagnostic]:
    return [d if d.id else d.model_copy(update={'id': f'd{i + 1}'}) for i, d in enumerate(diagnostics)]


def nets_of(project: Project, wire_ids: list[str]) -> list[str]:
    wanted = set(wire_ids)
    return [n.id for n in project.nets or [] if wanted & set(n.wireIds)]


def validate_simulation(project: Project):
    from .hierarchy import active_diagrams
    missing = []
    for _, diagram in active_diagrams(project):
        connections = flatten_connects(diagram)
        connected = {(a, b) for a, b, _, _ in connections} | {(c, d) for _, _, c, d in connections}
        missing += [(b, p) for b in diagram.blocks for p in b.definition.ports
                    if p.direction == 'input' and (b.id, p.id) not in connected]
    if missing:
        names = [f'{b.definition.name}.{p.name}' for b, p in missing]
        raise SimulationFailure(
            'Connect these signal inputs before running:\n' + '\n'.join(f'• {name}' for name in names),
            [Diagnostic(source='validation', message=f'{name} is not connected.', blockIds=[b.id],
                        ports=[PortRef(blockId=b.id, portId=p.id)],
                        hint='Connect a signal source to this input, or remove the block.')
             for name, (b, p) in zip(names, missing)])
    from .buses import bus_problems
    buses = [(diagram, p) for _, diagram in active_diagrams(project) for p in bus_problems(diagram)]
    if buses:
        raise SimulationFailure(
            'Fix these signal buses before running:\n' + '\n'.join(f'• {p["message"]}' for _, p in buses),
            [Diagnostic(source='validation', message=p['message'], blockIds=[p['blockId']],
                        ports=[PortRef(blockId=p['blockId'], portId=p['portId'])] if p['portId'] else [],
                        hint=p['hint']) for _, p in buses])
    idle_problems = variant_port_problems(project)
    if idle_problems:
        raise SimulationFailure('Some active variants leave subsystem ports without an inside:\n'
                                + '\n'.join(f'• {d.message}' for d in idle_problems), idle_problems)
    unfinished = [b for _, diagram in active_diagrams(project) for b in diagram.blocks
                  if not b.definition.generated and b.definition.subsystem is None
                  and b.definition.kind == 'subsystem']
    if unfinished:
        raise SimulationFailure(
            'These blocks do not have their full simulation behavior yet: ' + ', '.join(b.definition.name for b in unfinished)
            + '. Replace them with explicit signal connections before running.',
            [Diagnostic(source='validation', message=f'{b.definition.name} is drawing-only and cannot be simulated yet.',
                        blockIds=[b.id], hint='Replace it with explicit signal connections.') for b in unfinished])


def variant_port_problems(project: Project) -> list[Diagnostic]:
    """Ports the active variant of an instance lacks and has not marked as not used here."""
    from .hierarchy import active_diagrams, missing_ports
    subsystems = {s.id: s for s in (project.subsystems or [])}
    problems = []
    for _, diagram in active_diagrams(project):
        for block in diagram.blocks:
            variant = block.definition.subsystem.active_variant_of() if block.definition.subsystem else None
            unused = set(variant.unused) if variant else set()
            for port in missing_ports(subsystems, block):
                if port.id in unused:
                    continue
                label = f'{block.definition.name} [{variant.name}]' if variant else block.definition.name
                problems.append(Diagnostic(
                    source='validation', message=f'{label} has no inside for port {port.name}.', blockIds=[block.id],
                    ports=[PortRef(blockId=block.id, portId=port.id)],
                    hint='Add the port inside this variant, or mark it “not used here” so it stays idle.'))
    return problems


def reference(identifier: str) -> re.Pattern:
    # Instance IDs are often plain words ("scope", "error"), so only match
    # component references such as `gain.k` or `System.gain`.
    return re.compile(r'(?<![\w.])' + re.escape(identifier) + r'(?=\.\w)|(?<=System\.)' + re.escape(identifier) + r'\b')


def rename(project: Project, message: str) -> str:
    names = {b.id: b.definition.name for b in project.blocks}
    for identifier in sorted(names, key=len, reverse=True):
        message = reference(identifier).sub(names[identifier], message)
    return message


def mentioned(project: Project, text: str) -> list[str]:
    found = set()
    for identifier in sorted((b.id for b in project.blocks), key=len, reverse=True):
        pattern = reference(identifier)
        if pattern.search(text):
            found.add(identifier)
            text = pattern.sub(' ', text)
    return [b.id for b in project.blocks if b.id in found]


def is_algebraic_loop(message: str) -> bool:
    lower = message.lower()
    return 'linear system' in lower or 'singular' in lower


def explain_failure(project: Project, message: str):
    # Keep the solver's diagnostics, but make generated instance IDs recognizable.
    message = rename(project, message)
    if is_algebraic_loop(message):
        message = LOOP_HINT + '\n\n' + message
    return message


def signal_loops(project: Project) -> tuple[list[str], list[str]]:
    """Blocks and wires on signal cycles with no state in between (direct feedthrough)."""
    blocks = {b.id: b for b in project.blocks}
    direction = {(b.id, p.id): p.direction for b in project.blocks for p in b.definition.ports}
    edges: dict[str, set[str]] = {}
    for a, ap, c, cp in flatten_connects(project):
        pair = {direction.get((a, ap)): (a, c), direction.get((c, cp)): (c, a)}
        if 'output' in pair and 'input' in pair:
            src, dst = pair['output']
            edges.setdefault(src, set()).add(dst)
    feedthrough = {i for i, b in blocks.items() if b.definition.domain == 'signal' and not STATEFUL.search(b.definition.equations)}
    graph = {i: {j for j in edges.get(i, ()) if j in feedthrough} for i in feedthrough}
    # Tarjan's strongly connected components.
    index, low, stack, on, counter, loops = {}, {}, [], set(), [0], []
    def visit(v):
        index[v] = low[v] = counter[0]; counter[0] += 1
        stack.append(v); on.add(v)
        for w in graph[v]:
            if w not in index:
                visit(w); low[v] = min(low[v], low[w])
            elif w in on:
                low[v] = min(low[v], index[w])
        if low[v] == index[v]:
            component = []
            while True:
                w = stack.pop(); on.discard(w); component.append(w)
                if w == v: break
            if len(component) > 1 or v in graph[v]:
                loops.extend(component)
    for v in graph:
        if v not in index:
            visit(v)
    members = set(loops)
    wires = [w.id for w in project.wires if w.source in members and w.target in members]
    return [b.id for b in project.blocks if b.id in members], wires


def solver_lines(text: str, pattern: str) -> list[str]:
    lines = [line.strip() for line in text.splitlines()]
    return list(dict.fromkeys(line for line in lines if re.search(pattern, line)))


def failure_diagnostics(project: Project, raw: str) -> list[Diagnostic]:
    """Split a solver failure into readable, block-mapped diagnostics; `detail` keeps everything."""
    detail = rename(project, raw)
    if is_algebraic_loop(raw):
        blocks, wires = signal_loops(project)
        first = next((line for line in solver_lines(detail, r'(?i)linear system|singular') if 'failed' in line.lower()), '')
        message = 'The model has an algebraic loop the solver cannot resolve.' + (f' {first.split("|")[-1].strip()}' if first else '')
        return [Diagnostic(source='runtime', message=message, detail=detail, blockIds=blocks, wireIds=wires,
                           netIds=nets_of(project, wires), hint=LOOP_HINT)]
    compiler = solver_lines(raw, r'\bError:')
    if compiler:
        return [Diagnostic(source='compiler', message=rename(project, re.sub(r'^(\[[^\]]*\]\s*)?Error:\s*', '', line))[:1000], detail=detail,
                           blockIds=mentioned(project, line)) for line in compiler[:20]]
    runtime = solver_lines(raw, r'\|\s*(error|assert|debug)\s*\|')
    message = next((re.split(r'\|\s*(?:error|assert|debug)\s*\|', line)[-1].strip() for line in runtime), '')
    first = next((line for line in detail.splitlines() if line.strip()), 'OpenModelica did not complete the simulation.')
    return [Diagnostic(source='runtime', message=rename(project, message) or first[:400], detail=detail,
                       blockIds=mentioned(project, raw))]


# Solver warnings said in Gradara's terms (the raw text stays in `detail`). The
# engine's own wording points at OMEdit menus and OMNotebook commands, which do
# not exist here; these say what happened to the results and what a user can do.
WARNING_TRANSLATIONS: list[tuple[str, str, str | None]] = [
    (r'initial conditions are not fully specified',
     'The model does not fix every initial state, so the engine chose starting values (0 unless a block says otherwise). '
     'The first moments of the run depend on that choice; the steady state does not.',
     'Set an initial value on the integrators, inertias, capacitors, inductors or thermal masses whose start matters.'),
    (r'Alias set with conflicting start values',
     'Two connected quantities are given different initial values; the engine kept one of them.',
     'Give both blocks the same initial value, or set it on one and leave the other at its default.'),
    (r'Alias set with several free start values',
     'Several connected quantities suggest an initial value; the engine kept one of them.',
     'Set the initial value on the block where it matters and leave the others at their defaults.'),
    (r'(different|conflicting) nominal values',
     'Connected quantities carry different scale hints (nominal values); the engine kept one. This affects solver tolerances, not the equations.',
     None),
    (r'Assuming fixed start value',
     'A state had no initial value, so the engine fixed it at its start value.',
     'Set an initial value on that block if its start matters.'),
]


def translate_warning(message: str) -> tuple[str, str | None]:
    """(message, hint) for a solver warning: Gradara's wording when known, the engine's otherwise."""
    for pattern, plain, hint in WARNING_TRANSLATIONS:
        if re.search(pattern, message, re.IGNORECASE):
            return plain, hint
    return message, None


def warning_diagnostics(project: Project, text: str) -> list[Diagnostic]:
    """Warnings from a successful run, so they are visible without failing it."""
    lines = solver_lines(text, r'\bWarning:|\|\s*warning\s*\|')
    out = []
    for line in lines[:50]:
        raw = rename(project, re.split(r'Warning:|\|\s*warning\s*\|', line)[-1].strip())
        message, hint = translate_warning(raw)
        out.append(Diagnostic(severity='warning', source='compiler' if 'Warning:' in line else 'runtime',
                              message=message[:400], detail=rename(project, line), blockIds=mentioned(project, line), hint=hint))
    return numbered(out)
