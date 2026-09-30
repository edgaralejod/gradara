# SPDX-License-Identifier: Apache-2.0
"""Deterministic C code generation for a controller: a subsystem or a selection of signal blocks.

The unit is flattened (nested subsystems are inlined), checked to be signal-only,
sorted by data dependency, and written as C from one small template per block
type. Continuous states are discretized with forward Euler, backward Euler, or
Tustin; sampled blocks run on counters derived from their sample period. The same
model and options always give the same code. `verify` replays the unit's inputs
from the last simulation through the compiled C and compares its outputs.
"""
from __future__ import annotations

import csv
import math
import re
from dataclasses import dataclass, field
from pathlib import Path
from typing import Callable, Literal

from pydantic import BaseModel, Field

from .buses import BUS_KINDS
from .models import BOUNDARY_KINDS, CAUSAL_DOMAINS, Block, Definition, Project, net_components

Method = Literal['forward', 'backward', 'tustin']


class CodegenOptions(BaseModel):
    step: float | None = Field(default=None, gt=0, le=10)
    method: Method = 'tustin'
    real: Literal['float', 'double'] = 'double'
    prefix: str = Field(default='controller', pattern=r'^[A-Za-z][A-Za-z0-9_]{0,40}$')


class CodegenRequest(BaseModel):
    project: Project
    # Subsystem instance IDs from the top level down to the sheet the unit is on.
    path: list[str] = Field(default_factory=list, max_length=20)
    # Either one subsystem instance on that sheet, or a set of blocks on it.
    instanceId: str | None = None
    blockIds: list[str] = Field(default_factory=list, max_length=500)
    options: CodegenOptions = Field(default_factory=CodegenOptions)
    runId: str | None = Field(default=None, pattern=r'^[A-Za-z0-9_-]+$')


class CodegenError(ValueError):
    def __init__(self, message: str, block_ids: list[str] | None = None):
        super().__init__(message)
        self.block_ids = block_ids or []


def c_name(text: str, taken: set[str]) -> str:
    base = re.sub(r'[^A-Za-z0-9_]', '_', text).strip('_') or 'signal'
    if base[0].isdigit():
        base = 's_' + base
    name, n = base, 2
    while name in taken:
        name, n = f'{base}_{n}', n + 1
    taken.add(name)
    return name


# ---------------------------------------------------------------- flattening

@dataclass
class Node:
    """One executable block after nested subsystems are inlined."""
    key: str            # C-safe unique name, e.g. drive__pi
    block_id: str       # ID on its own sheet
    path: str           # dotted instance path to the sheet (result variable prefix)
    definition: Definition
    inputs: dict[str, 'Source'] = field(default_factory=dict)


@dataclass(frozen=True)
class Source:
    """What drives an input: a node output, or a unit input by index."""
    node: str | None
    port: str | None
    unit_input: int | None = None


def _sheet(project: Project, path: list[str]):
    sheet, prefix = project, ''
    subsystems = {s.id: s for s in (project.subsystems or [])}
    for ident in path:
        block = next((b for b in sheet.blocks if b.id == ident), None)
        if block is None or block.definition.subsystem is None:
            raise CodegenError('That subsystem is no longer in the model.')
        sheet = subsystems[block.definition.subsystem.ref]
        prefix += f'{ident}.'
    return sheet, prefix


class _Union:
    def __init__(self):
        self.parent: dict = {}

    def find(self, x):
        self.parent.setdefault(x, x)
        while self.parent[x] != x:
            self.parent[x] = self.parent[self.parent[x]]
            x = self.parent[x]
        return x

    def join(self, a, b):
        self.parent[self.find(a)] = self.find(b)


@dataclass
class Unit:
    nodes: list[Node]
    inputs: list[dict]    # {name, domain, column}: column is the result variable that fed it
    outputs: list[dict]   # {name, domain, source: Source, column}
    blocks_on_sheet: list[str]


def build_unit(project: Project, path: list[str], instance_id: str | None, block_ids: list[str]) -> Unit:
    sheet, prefix = _sheet(project, path)
    subsystems = {s.id: s for s in (project.subsystems or [])}
    union = _Union()
    nodes: dict[str, Node] = {}
    by_id = {b.id: b for b in sheet.blocks}
    if instance_id:
        instance = by_id.get(instance_id)
        if instance is None or instance.definition.subsystem is None:
            raise CodegenError('Choose a subsystem block to generate code for.')
        chosen = [instance]
    else:
        chosen = [by_id[i] for i in block_ids if i in by_id]
        if not chosen:
            raise CodegenError('Select the controller blocks, or a subsystem, to generate code for.')
    chosen_ids = {b.id for b in chosen}

    def add_sheet(diagram, sheet_prefix: str, key_prefix: str, members: set[str] | None):
        """Inline one sheet: nodes for executable blocks, unions for every net."""
        for component in net_components(diagram):
            keys = [(key_prefix, b, p) for b, p in component if members is None or b in members]
            for a, b in zip(keys, keys[1:]):
                union.join(a, b)
        for block in diagram.blocks:
            if members is not None and block.id not in members:
                continue
            d = block.definition
            if d.boundary is not None and d.kind in BOUNDARY_KINDS:
                continue
            if d.subsystem is not None:
                inner = subsystems[d.subsystem.ref]
                inner_key = f'{key_prefix}{block.id}__'
                for port in d.ports:
                    # The instance's port and the matching boundary block inside are the same signal.
                    handle = 'y' if port.direction == 'input' else 'u'
                    union.join((key_prefix, block.id, port.id), (inner_key, port.id, handle))
                add_sheet(inner, f'{sheet_prefix}{block.id}.', inner_key, None)
                continue
            for port in d.ports:
                if port.domain not in CAUSAL_DOMAINS:
                    raise CodegenError(f'{d.name} has a physical {port.domain} terminal. C code covers signal and '
                                       'Boolean blocks only; leave physical parts out of the controller.', [block.id])
            key = f'{key_prefix}{block.id}'
            nodes[key] = Node(key=key, block_id=block.id, path=sheet_prefix, definition=d)

    unit_inputs: list[dict] = []
    unit_outputs: list[dict] = []
    driver_of: dict = {}
    taken: set[str] = set()
    if instance_id:
        instance = chosen[0]
        inner = subsystems[instance.definition.subsystem.ref]
        physical = [p for p in instance.definition.ports if p.domain not in CAUSAL_DOMAINS]
        if physical:
            raise CodegenError(f'{instance.definition.name} has a physical {physical[0].domain} port. C code covers '
                               'signal and Boolean subsystems only.', [instance.id])
        add_sheet(inner, f'{prefix}{instance.id}.', f'{instance.id}__', None)
        # The instance's own inports are the unit inputs; its outports the outputs.
        wires_in = _outside_drivers(sheet, {instance.id})
        for port in instance.definition.ports:
            name = c_name(port.name, taken)
            if port.direction == 'input':
                index = len(unit_inputs)
                column = wires_in.get((instance.id, port.id))
                unit_inputs.append({'name': name, 'domain': port.domain, 'label': port.name,
                                    'column': f'{prefix}{column}' if column else None})
                driver_of[union.find((f'{instance.id}__', port.id, 'y'))] = Source(None, None, index)
            else:
                unit_outputs.append({'name': name, 'domain': port.domain, 'label': port.name,
                                     'key': (f'{instance.id}__', port.id, 'u'),
                                     'column': f'{prefix}{instance.id}.{port.id}'})
    else:
        add_sheet(sheet, prefix, '', chosen_ids)
        # Nets that cross the selection edge become inputs (driven outside) or outputs (driven inside).
        ports = {(b.id, p.id): p for b in sheet.blocks for p in b.definition.ports}
        for component in net_components(sheet):
            inside = [(b, p) for b, p in component if b in chosen_ids]
            outside = [(b, p) for b, p in component if b not in chosen_ids]
            if not inside or not outside:
                continue
            domain = ports[inside[0]].domain
            if domain not in CAUSAL_DOMAINS:
                names = ', '.join(sorted({by_id[b].definition.name for b, _ in inside}))
                raise CodegenError(f'The selection shares a physical {domain} connection with the rest of the model '
                                   f'({names}). Select signal blocks only.', [b for b, _ in inside])
            driver = next(((b, p) for b, p in component if ports[(b, p)].direction == 'output'), None)
            label = f'{by_id[driver[0]].definition.name} {ports[driver].name}' if driver else 'input'
            if driver and driver[0] in chosen_ids:
                unit_outputs.append({'name': c_name(label, taken), 'domain': domain, 'label': label,
                                     'key': ('', driver[0], driver[1]),
                                     'column': _column(prefix, by_id[driver[0]], driver[1])})
            else:
                index = len(unit_inputs)
                unit_inputs.append({'name': c_name(label, taken), 'domain': domain, 'label': label,
                                    'column': _column(prefix, by_id[driver[0]], driver[1]) if driver else None})
                driver_of[union.find(('', inside[0][0], inside[0][1]))] = Source(None, None, index)
    # Every node output drives its union set.
    for node in nodes.values():
        key_prefix = node.key[:-len(node.block_id)]
        for port in node.definition.ports:
            if port.direction == 'output':
                driver_of[union.find((key_prefix, node.block_id, port.id))] = Source(node.key, port.id)
    for node in nodes.values():
        key_prefix = node.key[:-len(node.block_id)]
        for port in node.definition.ports:
            if port.direction == 'input':
                source = driver_of.get(union.find((key_prefix, node.block_id, port.id)))
                if source is None:
                    raise CodegenError(f'{node.definition.name}.{port.name} is not connected.', [node.block_id])
                node.inputs[port.id] = source
    for output in unit_outputs:
        source = driver_of.get(union.find(output['key']))
        if source is None:
            raise CodegenError(f'Output {output["label"]} is not driven inside the unit.')
        output['source'] = source
    return Unit(list(nodes.values()), unit_inputs, unit_outputs, sorted(chosen_ids))


def _column(prefix: str, block: Block, port_id: str) -> str:
    """The result variable of a block's output terminal."""
    from .msl import connector
    if block.definition.boundary is not None and block.definition.kind in BOUNDARY_KINDS:
        return f'{prefix}{block.id}'  # a subsystem port is the subsystem's own connector
    return f'{prefix}{block.id}.{connector(block.definition, port_id)}'


def _outside_drivers(sheet, members: set[str]) -> dict:
    """(member block, port) → result variable of the outside output that drives it."""
    ports = {(b.id, p.id): (b, p) for b in sheet.blocks for p in b.definition.ports}
    found = {}
    for component in net_components(sheet):
        driver = next(((b, p) for b, p in component if ports[(b, p)][1].direction == 'output' and b not in members), None)
        if not driver:
            continue
        block, port = ports[driver]
        column = _column('', block, port.id)
        for b, p in component:
            if b in members:
                found[(b, p)] = column
    return found


# ---------------------------------------------------------------- templates

@dataclass
class Code:
    """What one block contributes to the generated step function."""
    output: list[str] = field(default_factory=list)   # computes outputs (may read inputs when feedthrough)
    update: list[str] = field(default_factory=list)   # advances state after every output is known
    state: list[tuple[str, str, str]] = field(default_factory=list)  # (name, C type, initial value)
    feedthrough: bool = True
    period: float | None = None
    note: str = ''


class Ctx:
    def __init__(self, node: Node, real: str, h: float, method: Method, value_of: Callable[[Source], str]):
        self.node, self.real, self.h, self.method = node, real, h, method
        self._value_of = value_of
        self.params = {p.id: p.value for p in node.definition.parameters}

    def u(self, port: str) -> str:
        return self._value_of(self.node.inputs[port])

    def y(self, port: str) -> str:
        return f'{self.node.key}_{port}'

    def p(self, name: str) -> str:
        return f'p->{self.node.key}_{name}'

    def x(self, name: str) -> str:
        return f's->{self.node.key}_{name}'

    def lit(self, value: float) -> str:
        text = repr(float(value))
        return text + ('f' if self.real == 'float' and 'inf' not in text and 'nan' not in text else '')


def _clamp(lo: str, hi: str, v: str) -> str:
    return f'fmax({lo}, fmin({hi}, {v}))'


def _linear1(c: Ctx, name: str, a: str, b: str, u: str, init: str = '0') -> tuple[list[str], list[str], bool]:
    """One linear state der(x) = a*x + b*u. Returns (output-phase lines, update lines, feedthrough)."""
    x, h = c.x(name), c.lit(c.h)
    if c.method == 'forward':
        return [], [f'{x} += {h} * (({a}) * {x} + ({b}) * {u});'], False
    # The first step only records the input: the state starts at its initial value at t = 0.
    if c.method == 'backward':
        return [f'if (s->steps > 0) {x} = ({x} + {h} * ({b}) * {u}) / (1 - {h} * ({a}));'], [], True
    prev = c.x(name + '_u')
    return ([f'if (s->steps > 0) {x} = ((1 + {h} * ({a}) / 2) * {x} + {h} * ({b}) / 2 * ({u} + {prev})) / '
             f'(1 - {h} * ({a}) / 2);'], [f'{prev} = {u};'], True)


def _state1(c: Ctx, name: str, real: str) -> list[tuple[str, str, str]]:
    extra = [(name + '_u', real, '0')] if c.method == 'tustin' else []
    return [(name, real, '0')] + extra


def _sampled(c: Ctx, period_param: str, body: list[str], state: list[tuple[str, str, str]]) -> Code:
    period = c.params[period_param]
    return Code(output=body, state=state, feedthrough=True, period=period)


def t_signal(kind: str, c: Ctx) -> Code | None:
    y, u, p, x, R = c.y, c.u, c.p, c.x, c.real
    simple = {
        'gain': lambda: f'{y("y")} = {p("k")} * {u("u")};',
        'sum': lambda: f'{y("y")} = {u("a")} + {u("b")};',
        'subtract': lambda: f'{y("y")} = {u("a")} - {u("b")};',
        'product': lambda: f'{y("y")} = {u("a")} * {u("b")};',
        'divide': lambda: f'{y("y")} = {u("a")} / {u("b")};',
        'abs': lambda: f'{y("y")} = fabs({u("u")});',
        'sign': lambda: f'{y("y")} = ({u("u")} > 0) ? 1 : (({u("u")} < 0) ? -1 : 0);',
        'sqrt': lambda: f'{y("y")} = sqrt(fmax(0, {u("u")}));',
        'min': lambda: f'{y("y")} = fmin({u("a")}, {u("b")});',
        'max': lambda: f'{y("y")} = fmax({u("a")}, {u("b")});',
        'sineOp': lambda: f'{y("y")} = sin({u("u")});',
        'cosineOp': lambda: f'{y("y")} = cos({u("u")});',
        'unaryMinus': lambda: f'{y("y")} = -{u("u")};',
        'power': lambda: f'{y("y")} = pow({u("u")}, {p("n")});',
        'saturation': lambda: f'{y("y")} = {_clamp(p("lower"), p("upper"), u("u"))};',
        'deadzone': lambda: (f'{y("y")} = ({u("u")} > {p("start")}) ? {u("u")} - {p("start")} : '
                             f'(({u("u")} < -{p("start")}) ? {u("u")} + {p("start")} : 0);'),
        'relay': lambda: f'{y("y")} = ({u("u")} >= {p("offSwitch")}) ? {p("onValue")} : {p("offValue")};',
        'switch2': lambda: f'{y("y")} = ({u("sel")} >= {p("threshold")}) ? {u("u1")} : {u("u3")};',
        'manualSwitch': lambda: f'{y("y")} = ({p("sel")} >= 1.5) ? {u("u2")} : {u("u1")};',
        'constant': lambda: f'{y("y")} = {p("value")};',
        'step': lambda: f'{y("y")} = (s->t < {p("startTime")}) ? 0 : {p("height")};',
        'ramp': lambda: f'{y("y")} = (s->t < {p("startTime")}) ? 0 : {p("slope")} * (s->t - {p("startTime")});',
        'sine': lambda: (f'{y("y")} = {p("offset")} + {p("amplitude")} * sin(6.283185307179586 * {p("frequency")} * s->t '
                         f'+ {p("phase")});'),
        'pulse': lambda: (f'{y("y")} = (fmod(s->t - {p("startTime")} + {p("period")}, {p("period")}) < {p("width")} * '
                          f'{p("period")}) ? {p("amplitude")} : 0;'),
        'clock': lambda: f'{y("y")} = s->t;',
    }
    if kind in simple:
        line = simple[kind]()
        return Code(output=[line], feedthrough=any(port.direction == 'input' for port in c.node.definition.ports))
    if kind in ('terminator', 'scope', 'display'):
        return Code(feedthrough=False)
    if kind == 'clarke':
        return Code(output=[f'{y("alpha")} = (2 * {u("ia")} - {u("ib")} - {u("ic")}) / 3;',
                            f'{y("beta")} = ({u("ib")} - {u("ic")}) / sqrt(3);'])
    if kind == 'park':
        return Code(output=[f'{y("id")} = {u("alpha")} * cos({u("theta")}) + {u("beta")} * sin({u("theta")});',
                            f'{y("iq")} = -{u("alpha")} * sin({u("theta")}) + {u("beta")} * cos({u("theta")});'])
    if kind == 'inversePark':
        a, b = f'{c.node.key}_alpha', f'{c.node.key}_beta'
        return Code(output=[f'{R} {a} = {u("vd")} * cos({u("theta")}) - {u("vq")} * sin({u("theta")});',
                            f'{R} {b} = {u("vd")} * sin({u("theta")}) + {u("vq")} * cos({u("theta")});',
                            f'{y("va")} = {a};', f'{y("vb")} = -{a} / 2 + sqrt(3) * {b} / 2;',
                            f'{y("vc")} = -{a} / 2 - sqrt(3) * {b} / 2;'])
    if kind == 'pwmPair':
        return Code(output=[f'{y("high")} = (fmod(s->t, 1 / {p("frequency")}) < {p("duty")} / {p("frequency")}) ? 1 : 0;',
                            f'{y("low")} = 1 - {y("high")};'], feedthrough=False)
    # Continuous dynamics, discretized with the chosen method.
    if kind == 'integrator':
        out, upd, ft = _linear1(c, 'x', '0', '1', u('u'))
        lim = p('limit')
        return Code(output=out + [f'{x("x")} = {_clamp("-" + lim, lim, x("x"))};', f'{y("y")} = {x("x")};'],
                    update=upd + ([f'{x("x")} = {_clamp("-" + lim, lim, x("x"))};'] if upd else []),
                    state=_state1(c, 'x', R), feedthrough=ft, note='limits are applied to the state after each step')
    if kind == 'filter':
        out, upd, ft = _linear1(c, 'x', f'-1 / {p("tau")}', f'1 / {p("tau")}', u('u'))
        return Code(output=out + [f'{y("y")} = {x("x")};'], update=upd, state=_state1(c, 'x', R), feedthrough=ft)
    if kind == 'derivative':
        out, upd, _ = _linear1(c, 'x', f'-1 / {p("tau")}', f'1 / {p("tau")}', u('u'))
        # y reads the input directly, so this block always feeds through.
        return Code(output=[f'{y("y")} = ({u("u")} - {x("x")}) / {p("tau")};'] + out, update=upd,
                    state=_state1(c, 'x', R), feedthrough=True)
    if kind == 'secondOrder':
        h = c.lit(c.h)
        wn, z = p('wn'), p('zeta')
        # Semi-implicit Euler keeps the oscillator stable for any method; exact methods for 2 states need matrices.
        return Code(output=[f'{y("y")} = {x("x1")};'],
                    update=[f'{x("x2")} += {h} * ({wn} * {wn} * ({u("u")} - {x("x1")}) - 2 * {z} * {wn} * {x("x2")});',
                            f'{x("x1")} += {h} * {x("x2")};'],
                    state=[('x1', R, '0'), ('x2', R, '0')], feedthrough=False,
                    note='two states, discretized with semi-implicit Euler')
    if kind == 'pid':
        oi, ui, fi = _linear1(c, 'xi', '0', '1', u('u'))
        of, uf, ff = _linear1(c, 'xf', f'-1 / {p("tf")}', f'1 / {p("tf")}', u('u'))
        return Code(output=oi + of + [f'{y("y")} = {p("kp")} * {u("u")} + {p("ki")} * {x("xi")} + '
                                      f'{p("kd")} * ({u("u")} - {x("xf")}) / {p("tf")};'],
                    update=ui + uf, state=_state1(c, 'xi', R) + _state1(c, 'xf', R), feedthrough=True)
    if kind == 'currentPI':
        h = c.lit(c.h)
        raw = f'{c.node.key}_raw'
        return Code(output=[f'{R} {raw} = {p("kp")} * {u("u")} + {x("x")};',
                            f'{y("y")} = {_clamp("-" + p("limit"), p("limit"), raw)};'],
                    update=[f'{x("x")} += {h} * ({p("ki")} * {u("u")} + {p("kaw")} * ({y("y")} - ({p("kp")} * {u("u")} + {x("x")})));'],
                    state=[('x', R, '0')], feedthrough=True, note='anti-windup state, forward Euler')
    if kind == 'rateLimiter':
        h = c.lit(c.h)
        return Code(output=[f'{y("y")} = {x("y")};'],
                    update=[f'{x("y")} += {_clamp("-" + p("falling") + " * " + h, p("rising") + " * " + h, u("u") + " - " + x("y"))};'],
                    state=[('y', R, '0')], feedthrough=False, note='ideal discrete rate limiter')
    if kind == 'delay':
        n = max(1, round(c.params['T'] / c.h))
        buf, idx, ready = x('buf'), x('i'), x('ready')
        return Code(output=[f'{y("y")} = {buf}[{idx}];'],
                    update=[f'if (!{ready}) {{ for (int k = 0; k < {n}; k++) {buf}[k] = {u("u")}; {ready} = 1; }}',
                            f'{buf}[{idx}] = {u("u")};', f'{idx} = ({idx} + 1) % {n};'],
                    state=[(f'buf[{n}]', R, '{0}'), ('i', 'int', '0'), ('ready', 'int', '0')], feedthrough=False,
                    note=f'transport delay of {n} steps (output 0 on the first step); changing T needs new code')
    # Sampled blocks: run when their counter comes round; outputs hold in between.
    if kind == 'pi':
        e = f'{c.node.key}_e'
        return _sampled(c, 'samplePeriod', [
            f'{R} {e} = {u("reference")} - {u("measured")};',
            f'{x("integral")} = {_clamp("-" + p("limit"), p("limit"), x("integral") + " + " + p("samplePeriod") + " * " + p("ki") + " * " + e)};',
            f'{x("y")} = {_clamp("-" + p("limit"), p("limit"), p("kp") + " * " + e + " + " + x("integral"))};'],
            [('integral', R, '0'), ('y', R, '0')])
    if kind == 'discretePID':
        return _sampled(c, 'samplePeriod', [
            f'{x("e")} = {u("reference")} - {u("measured")};',
            f'{x("integral")} = {_clamp("-" + p("limit"), p("limit"), x("integral") + " + " + p("samplePeriod") + " * " + p("ki") + " * " + x("e"))};',
            f'{x("derivative")} = ({p("filterTime")} * {x("derivative")} + {p("kd")} * ({x("e")} - {x("errorPrev")})) / '
            f'({p("filterTime")} + {p("samplePeriod")});',
            f'{x("errorPrev")} = {x("e")};',
            f'{x("y")} = {_clamp("-" + p("limit"), p("limit"), p("kp") + " * " + x("e") + " + " + x("integral") + " + " + x("derivative"))};'],
            [('e', R, '0'), ('integral', R, '0'), ('derivative', R, '0'), ('errorPrev', R, '0'), ('y', R, '0')])
    if kind == 'unitDelay':
        # The output is the input from one sample earlier, so it does not wait for this step's input.
        return Code(output=[f'{x("y")} = {x("stored")};'], update=[f'{x("stored")} = {u("u")};'],
                    state=[('stored', R, '0'), ('y', R, '0')], feedthrough=False, period=c.params['Ts'])
    if kind == 'zoh':
        return _sampled(c, 'Ts', [f'{x("y")} = {u("u")};'], [('y', R, '0')])
    if kind == 'discreteIntegrator':
        return _sampled(c, 'Ts', [f'{x("y")} = {x("y")} + {p("Ts")} * {u("u")};'], [('y', R, '0')])
    return None


def t_msl(cls: str, c: Ctx) -> Code | None:
    y, u, p, x = c.y, c.u, c.p, c.x
    name = cls.rsplit('.', 1)[-1]
    logic = {'And': '&&', 'Or': '||', 'Xor': '!='}
    if name in logic:
        return Code(output=[f'{y("y")} = {u("u1")} {logic[name]} {u("u2")};'])
    if name == 'Nand':
        return Code(output=[f'{y("y")} = !({u("u1")} && {u("u2")});'])
    if name == 'Nor':
        return Code(output=[f'{y("y")} = !({u("u1")} || {u("u2")});'])
    if name == 'Not':
        return Code(output=[f'{y("y")} = !{u("u")};'])
    if name == 'GreaterThreshold':
        return Code(output=[f'{y("y")} = {u("u")} > {p("threshold")};'])
    if name == 'LessThreshold':
        return Code(output=[f'{y("y")} = {u("u")} < {p("threshold")};'])
    if name == 'Greater':
        return Code(output=[f'{y("y")} = {u("u1")} > {u("u2")};'])
    if name == 'Less':
        return Code(output=[f'{y("y")} = {u("u1")} < {u("u2")};'])
    if name == 'Hysteresis':
        return Code(output=[f'{x("y")} = ({u("u")} > {p("uHigh")}) || ({x("y")} && {u("u")} >= {p("uLow")});',
                            f'{y("y")} = {x("y")};'], state=[('y', 'bool', 'false')])
    if name == 'OnOffController':
        return Code(output=[f'{x("y")} = ({x("y")} && {u("u")} < {u("reference")} + {p("bandwidth")} / 2) || '
                            f'({u("u")} < {u("reference")} - {p("bandwidth")} / 2);', f'{y("y")} = {x("y")};'],
                    state=[('y', 'bool', 'false')])
    if name == 'Switch':
        return Code(output=[f'{y("y")} = {u("u2")} ? {u("u1")} : {u("u3")};'])
    if name == 'BooleanToReal':
        return Code(output=[f'{y("y")} = {u("u")} ? {p("realTrue")} : {p("realFalse")};'])
    if name == 'BooleanConstant':
        return Code(output=[f'{y("y")} = true;'], feedthrough=False)
    if name == 'BooleanStep':
        return Code(output=[f'{y("y")} = s->t >= {p("startTime")};'], feedthrough=False)
    if name == 'BooleanPulse':
        return Code(output=[f'{y("y")} = s->t >= {p("startTime")} && fmod(s->t - {p("startTime")}, {p("period")}) < '
                            f'{p("width")} / 100 * {p("period")};'], feedthrough=False)
    if name == 'Timer':
        return Code(output=[f'if ({u("u")} && !{x("on")}) {x("t0")} = s->t;', f'{x("on")} = {u("u")};',
                            f'{y("y")} = {u("u")} ? s->t - {x("t0")} : 0;'], state=[('on', 'bool', 'false'), ('t0', c.real, '0')])
    if name == 'Edge':
        return Code(output=[f'{y("y")} = {u("u")} && !{x("u")};'], update=[f'{x("u")} = {u("u")};'],
                    state=[('u', 'bool', 'false')])
    if name == 'RSFlipFlop':
        return Code(output=[f'{x("q")} = {u("S")} || ({x("q")} && !{u("R")});', f'{y("Q")} = {x("q")};', f'{y("QI")} = !{x("q")};'],
                    state=[('q', 'bool', 'false')])
    if name == 'SignalPWM':
        n = round(1 / (c.params['f'] * c.h))
        if n < 2 or abs(1 / (c.params['f'] * c.h) - n) > 1e-6:
            raise CodegenError(f'{c.node.definition.name} switches at {c.params["f"]:g} Hz; choose a step that divides '
                               'its period into a whole number of at least two steps.', [c.node.block_id])
        return Code(output=[f'if ({x("k")} == 0) {x("d")} = fmax(0, fmin(1, {u("dutyCycle")}));',
                            f'{y("fire")} = {x("d")} > (double){x("k")} / {n};', f'{y("notFire")} = !{y("fire")};'],
                    update=[f'{x("k")} = ({x("k")} + 1) % {n};'], state=[('d', c.real, '0'), ('k', 'uint32_t', '0')],
                    note=f'sawtooth carrier with {n} steps per period; changing f needs new code')
    if name == 'TriggeredSampler':
        return Code(output=[f'if ({u("trigger")} && !{x("t")}) {x("y")} = {u("u")};', f'{y("y")} = {x("y")};'],
                    update=[f'{x("t")} = {u("trigger")};'], state=[('y', c.real, repr(c.params.get('y_start', 0.0))), ('t', 'bool', 'false')])
    return None


def t_custom(d: Definition, c: Ctx) -> Code | None:
    """A custom block's own template (written by the AI once), if it still matches the block."""
    from . import ctemplate
    tpl = d.ctemplate
    if tpl is None or tpl.signature != ctemplate.signature(d):
        return None
    ctemplate.check(d, tpl)
    names = {f'u.{p.id}': c.u(p.id) for p in d.ports if p.direction == 'input'}
    names |= {f'y.{p.id}': c.y(p.id) for p in d.ports if p.direction == 'output'}
    names |= {f'p.{p.id}': c.p(p.id) for p in d.parameters}
    names |= {f'x.{s.name}': c.x(s.name) for s in tpl.state}
    names |= {'h': c.lit(c.h), 't': 's->t'}
    types = {'real': c.real, 'bool': 'bool', 'int': 'int32_t'}
    init = lambda s: ('true' if s.init else 'false') if s.type == 'bool' else repr(int(s.init) if s.type == 'int' else float(s.init))
    return Code(output=[ctemplate.render(line, names) for line in tpl.output],
                update=[ctemplate.render(line, names) for line in tpl.update],
                state=[(s.name, types[s.type], init(s)) for s in tpl.state],
                feedthrough=tpl.feedthrough, note=tpl.notes.strip().rstrip('.') if tpl.notes else 'C template written by AI')


def template(node: Node, c: Ctx) -> Code:
    d = node.definition
    if d.kind in BUS_KINDS or any(p.width for p in d.ports):
        raise CodegenError(f'{d.name} carries a bus. C export handles single signals only: '
                           'leave bus blocks outside the code unit, or split the bus before it.', [node.block_id])
    if d.modelica is not None:
        code = t_msl(d.modelica.class_, c)
    elif d.generated:
        code = t_custom(d, c)
    else:
        code = t_signal(d.kind, c)
    if code is None:
        hint = ('Write its C template with AI in the Export dialog' if d.generated
                else 'Replace it with library blocks')
        raise CodegenError(f'{d.name} has no C template yet. {hint}, or leave it outside the code unit.',
                           [node.block_id])
    return code


# ---------------------------------------------------------------- emission

@dataclass
class Generated:
    files: dict[str, str]
    step: float
    inputs: list[dict]
    outputs: list[dict]
    blocks: list[str]
    notes: list[str]


def _order(unit: Unit, codes: dict[str, Code]) -> list[Node]:
    """Nodes in execution order: a feedthrough block runs after the blocks feeding it."""
    deps = {n.key: {s.node for s in n.inputs.values() if s.node} if codes[n.key].feedthrough else set()
            for n in unit.nodes}
    order, state = [], {}

    def visit(key, trail):
        if state.get(key) == 2:
            return
        if state.get(key) == 1:
            loop = trail[trail.index(key):-1]
            names = [next(n for n in unit.nodes if n.key == k).definition.name for k in loop]
            raise CodegenError('These blocks form an algebraic loop, so their outputs depend on each other within one '
                               'step: ' + ' → '.join(names) + '. Add a delay, filter, or integrator in the loop.',
                               [next(n for n in unit.nodes if n.key == k).block_id for k in loop])
        state[key] = 1
        for dep in sorted(deps[key]):
            visit(dep, trail + [dep])
        state[key] = 2
        order.append(key)
    for node in sorted(unit.nodes, key=lambda n: n.key):
        visit(node.key, [node.key])
    by_key = {n.key: n for n in unit.nodes}
    return [by_key[k] for k in order]


def generate(project: Project, path: list[str], instance_id: str | None, block_ids: list[str],
             options: CodegenOptions) -> Generated:
    unit = build_unit(project, path, instance_id, block_ids)
    if not unit.nodes:
        raise CodegenError('There are no blocks to generate code for.')
    real = options.real
    periods = []
    for node in unit.nodes:
        for pid in ('samplePeriod', 'Ts'):
            value = next((p.value for p in node.definition.parameters if p.id == pid), None)
            if value and node.definition.kind in {'pi', 'discretePID', 'unitDelay', 'zoh', 'discreteIntegrator'}:
                periods.append(value)
    h = options.step or (min(periods) if periods else 1e-3)
    prefix = options.prefix
    ctype = {'signal': real, 'boolean': 'bool'}

    def value_of(source: Source) -> str:
        if source.unit_input is not None:
            return f'in->{unit.inputs[source.unit_input]["name"]}'
        return f'{source.node}_{source.port}'

    codes: dict[str, Code] = {}
    for node in unit.nodes:
        codes[node.key] = template(node, Ctx(node, real, h, options.method, value_of))
    order = _order(unit, codes)
    notes = []
    for node in order:
        code = codes[node.key]
        if code.period is not None:
            ratio = code.period / h
            if abs(ratio - round(ratio)) > 1e-6 or round(ratio) < 1:
                raise CodegenError(f'{node.definition.name} samples every {code.period:g} s, which is not a whole '
                                   f'number of {h:g} s steps. Choose a step that divides it.', [node.block_id])
        if code.note:
            notes.append(f'{node.definition.name}: {code.note}.')

    guard = f'{prefix.upper()}_H'
    H = [f'/* Generated by Gradara from "{project.name}". Deterministic: same model and options, same code. */',
         f'#ifndef {guard}', f'#define {guard}', '', '#include <stdbool.h>', '#include <stdint.h>', '',
         '#ifdef __cplusplus', 'extern "C" {', '#endif', '',
         f'/* Call {prefix}_step once every {prefix.upper()}_STEP_SIZE seconds. */',
         f'#define {prefix.upper()}_STEP_SIZE {h!r}', '']
    H.append('typedef struct {')
    H += [f'  {ctype[i["domain"]]} {i["name"]}; /* {i["label"]} */' for i in unit.inputs] or ['  char unused;']
    H += [f'}} {prefix}_In;', '', 'typedef struct {']
    H += [f'  {ctype[o["domain"]]} {o["name"]}; /* {o["label"]} */' for o in unit.outputs] or ['  char unused;']
    H += [f'}} {prefix}_Out;', '', 'typedef struct {']
    params = [(node, p) for node in order for p in node.definition.parameters]
    H += [f'  {real} {node.key}_{p.id}; /* {node.definition.name}: {p.name}{" [" + p.unit + "]" if p.unit else ""} */'
          for node, p in params] or ['  char unused;']
    H += [f'}} {prefix}_Params;', '', 'typedef struct {', f'  {real} t; /* time since init [s] */',
          '  uint64_t steps; /* steps since init; t is derived from it so time does not drift */']
    for node in order:
        code = codes[node.key]
        for name, typ, _ in code.state:
            H.append(f'  {typ} {node.key}_{name};')
        if code.period is not None:
            H.append(f'  uint32_t {node.key}_tick;')
    H += [f'}} {prefix}_State;', '',
          f'/* Parameter values from the model. */', f'void {prefix}_default_params({prefix}_Params *p);',
          f'void {prefix}_init({prefix}_State *s);',
          f'void {prefix}_step({prefix}_State *s, const {prefix}_Params *p, const {prefix}_In *in, {prefix}_Out *out);',
          '', '#ifdef __cplusplus', '}', '#endif', '', f'#endif /* {guard} */', '']
    lit = lambda v: repr(float(v)) + ('f' if real == 'float' else '')
    C = [f'/* Generated by Gradara from "{project.name}". */', f'#include "{prefix}.h"', '#include <math.h>', '#include <string.h>', '',
         f'void {prefix}_default_params({prefix}_Params *p)', '{']
    C += [f'  p->{node.key}_{p.id} = {lit(p.value)};' for node, p in params] or ['  (void)p;']
    C += ['}', '', f'void {prefix}_init({prefix}_State *s)', '{', '  memset(s, 0, sizeof *s);']
    for node in order:
        for name, typ, init in codes[node.key].state:
            if init not in ('0', 'false', '{0}'):
                C.append(f'  s->{node.key}_{name} = {init};')
    C += ['}', '', f'void {prefix}_step({prefix}_State *s, const {prefix}_Params *p, const {prefix}_In *in, {prefix}_Out *out)',
          '{', '  (void)p; (void)in;']
    # Outputs of every block, then state updates, so every block sees this step's values.
    for node in order:
        code = codes[node.key]
        outs = [pt for pt in node.definition.ports if pt.direction == 'output']
        C.append(f'  /* {node.definition.name} ({node.path}{node.block_id}) */')
        for port in outs:
            C.append(f'  {ctype[port.domain]} {node.key}_{port.id};')
        if code.period is not None:
            n = round(code.period / h)
            C.append(f'  if (s->{node.key}_tick == 0) {{')
            C += ['    ' + line for line in code.output]
            C.append('  }')
            C.append(f'  s->{node.key}_tick = (s->{node.key}_tick + 1) % {n}u;')
            for port in outs:
                C.append(f'  {node.key}_{port.id} = s->{node.key}_{port.id};')
        else:
            C += ['  ' + line for line in code.output]
    for output in unit.outputs:
        C.append(f'  out->{output["name"]} = {value_of(output["source"])};')
    for node in order:
        code = codes[node.key]
        if code.period is not None and code.update:
            # The counter has just advanced, so a sample was taken this step when it reads 1 (mod n).
            n = round(code.period / h)
            C.append(f'  if (s->{node.key}_tick == {1 % n}u) {{')
            C += ['    ' + line for line in code.update]
            C.append('  }')
        else:
            C += ['  ' + line for line in code.update]
    C += ['  s->steps++;', f'  s->t = ({real})s->steps * {lit(h)};', '}', '']
    # Unused outputs would warn under -Werror.
    source = '\n'.join(C)
    for node in order:
        for port in node.definition.ports:
            name = f'{node.key}_{port.id}'
            if port.direction == 'output' and len(re.findall(rf'\b{name}\b', source)) == 1 + (1 if codes[node.key].period is not None else 0):
                source = source.replace(f'  {ctype[port.domain]} {name};', f'  {ctype[port.domain]} {name}; (void){name};', 1)
    readme = _readme(project, prefix, h, options, unit, notes)
    return Generated({f'{prefix}.h': '\n'.join(H), f'{prefix}.c': source, 'README.md': readme}, h, unit.inputs,
                     unit.outputs, sorted({n.path + n.block_id for n in unit.nodes}), notes)


def _readme(project, prefix, h, options, unit, notes) -> str:
    lines = [f'# {prefix}', '', f'Generated by Gradara from the model "{project.name}".', '',
             f'Call `{prefix}_default_params(&p)` and `{prefix}_init(&s)` once, then `{prefix}_step(&s, &p, &in, &out)` '
             f'every {h:g} s.', '', f'Continuous states: {options.method} discretization. Numbers: `{options.real}`.', '',
             '| Port | Field | Type |', '| --- | --- | --- |']
    lines += [f'| input {i["label"]} | `in.{i["name"]}` | {"bool" if i["domain"] == "boolean" else options.real} |' for i in unit.inputs]
    lines += [f'| output {o["label"]} | `out.{o["name"]}` | {"bool" if o["domain"] == "boolean" else options.real} |' for o in unit.outputs]
    if notes:
        lines += ['', 'Notes:', ''] + [f'- {n}' for n in notes]
    return '\n'.join(lines) + '\n'


# ------------------------------------------------------------ verification

def sil_main(prefix: str, inputs: list[dict], outputs: list[dict], steps: int) -> str:
    """A host program: reads inputs per step from stdin-like CSV, writes outputs per step."""
    read = ' '.join(['%lf'] * len(inputs))
    lines = [f'#include "{prefix}.h"', '#include <stdio.h>', '', 'int main(void)', '{',
             '  FILE *fi = fopen("inputs.csv", "r"), *fo = fopen("outputs.csv", "w");', '  if (!fi || !fo) return 2;',
             f'  {prefix}_Params p; {prefix}_State s; {prefix}_In in; {prefix}_Out out;',
             f'  {prefix}_default_params(&p); {prefix}_init(&s);']
    lines.append(f'  for (long k = 0; k < {steps}L; k++) {{')
    if inputs:
        lines.append(f'    double v[{len(inputs)}];')
        lines.append(f'    if (fscanf(fi, "{read.replace(" ", ",")}", ' + ', '.join(f'&v[{i}]' for i in range(len(inputs))) + ') != '
                     f'{len(inputs)}) break;')
        for i, item in enumerate(inputs):
            cast = '(bool)(v[%d] > 0.5)' % i if item['domain'] == 'boolean' else f'v[{i}]'
            lines.append(f'    in.{item["name"]} = {cast};')
    lines.append(f'    {prefix}_step(&s, &p, &in, &out);')
    fmt = ','.join(['%.17g'] * max(1, len(outputs)))
    values = ', '.join(f'(double)out.{o["name"]}' for o in outputs) or '0.0'
    lines += [f'    fprintf(fo, "{fmt}\\n", {values});', '  }', '  fclose(fi); fclose(fo);', '  return 0;', '}', '']
    return '\n'.join(lines)


MAX_SIL_STEPS = 500_000


def replay_inputs(csv_path: Path, generated: Generated, duration: float):
    """Unit inputs at each controller step, and the outputs the simulation recorded at the same instants.

    Values are interpolated linearly between solver output points; at an event,
    where the solver writes two rows with the same time, the later row counts.
    """
    with csv_path.open(encoding='utf-8') as f:
        reader = csv.DictReader(f)
        header = reader.fieldnames or []
        rows = list(reader)
    if not rows:
        raise CodegenError('The last run has no samples. Run the model, then verify.')

    def column(item, kind):
        name = item.get('column')
        if not name or name not in header:
            raise CodegenError(f'The last run did not record {kind} {item["label"]}. Run the model, then verify.')
        return [float(r[name]) for r in rows]

    times = [float(r['time']) for r in rows]
    ins = [column(item, 'input') for item in generated.inputs]
    outs = [column(item, 'output') for item in generated.outputs]
    steps = int(math.floor(duration / generated.step + 1e-9)) + 1
    if steps > MAX_SIL_STEPS:
        raise CodegenError(f'The run needs {steps} controller steps to replay; the check stops at {MAX_SIL_STEPS}. '
                           'Shorten the run or use a longer step.')
    gap = 1e-9 * max(1.0, times[-1])
    held_in, expected, j = [], [], 0
    for k in range(steps):
        t = k * generated.step
        while j + 1 < len(times) and times[j + 1] <= t + 1e-12:
            j += 1
        if j + 1 < len(times) and times[j + 1] - times[j] > gap and t > times[j]:
            pick = _cubic(times, j, t, gap)
        else:
            pick = lambda col: col[j]
        held_in.append([pick(c) for c in ins])
        expected.append([pick(c) for c in outs])
    return held_in, expected


def _cubic(times: list[float], j: int, t: float, gap: float):
    """Cubic Hermite interpolation on [t_j, t_j+1] with Catmull-Rom slopes.

    Linear interpolation of a fast sinusoid (a motor current, say) is biased toward
    zero; a controller that integrates it drifts in an open-loop replay. Next to an
    event (two rows at one time) the slope falls back to the interval's own secant.
    """
    t0, t1 = times[j], times[j + 1]
    h = t1 - t0
    s = (t - t0) / h
    h00, h10, h01, h11 = 2*s**3 - 3*s**2 + 1, s**3 - 2*s**2 + s, -2*s**3 + 3*s**2, s**3 - s**2
    before = j > 0 and t0 - times[j - 1] > gap
    after = j + 2 < len(times) and times[j + 2] - t1 > gap

    def pick(col):
        secant = (col[j + 1] - col[j]) / h
        m0 = (col[j + 1] - col[j - 1]) / (t1 - times[j - 1]) if before else secant
        m1 = (col[j + 2] - col[j]) / (times[j + 2] - t0) if after else secant
        return h00 * col[j] + h10 * h * m0 + h01 * col[j + 1] + h11 * h * m1
    return pick


def parse_outputs(text: str, width: int) -> list[list[float]]:
    rows = []
    for line in text.splitlines():
        if line.strip():
            values = [float(v) for v in line.split(',')]
            rows.append(values[:width])
    return rows


def compare(expected: list[list[float]], actual: list[list[float]], outputs: list[dict]) -> list[dict]:
    report = []
    for i, item in enumerate(outputs):
        e = [row[i] for row in expected[:len(actual)]]
        a = [row[i] for row in actual]
        if not e:
            continue
        span = max(e) - min(e) or max(1e-12, max(abs(v) for v in e) or 1.0)
        error = max(abs(x - y) for x, y in zip(a, e))
        report.append({'output': item['label'], 'maxError': error, 'relative': error / span,
                       'passed': error / span <= SIL_TOLERANCE})
    return report


# Discretization and the solver's own tolerance make the two differ slightly; beyond this the code is suspect.
SIL_TOLERANCE = 0.02


async def verify(request: CodegenRequest, runs: Path, run_c) -> dict:
    """Replay the last run's inputs through the compiled C and compare against the outputs it recorded."""
    import json
    import uuid

    from .modelica import semantic_hash
    if not request.runId:
        raise CodegenError('Run the model first; verification replays the last run.')
    folder = runs/request.runId
    result_file, csv_file = folder/'result.json', folder/'simulation_res.csv'
    if not result_file.exists() or not csv_file.exists():
        raise CodegenError('The last run is no longer available. Run the model, then verify.')
    result = json.loads(result_file.read_text(encoding='utf-8'))
    if result.get('modelHash') != semantic_hash(request.project):
        raise CodegenError('The model changed since the last run. Run it again, then verify.')
    generated = generate(request.project, request.path, request.instanceId, request.blockIds, request.options)
    held_in, expected = replay_inputs(csv_file, generated, float(result['duration']))
    work = folder/f'sil-{uuid.uuid4().hex[:8]}'
    work.mkdir()
    prefix = request.options.prefix
    for name, text in generated.files.items():
        (work/name).write_text(text, encoding='utf-8')
    (work/'main.c').write_text(sil_main(prefix, generated.inputs, generated.outputs, len(held_in)), encoding='utf-8')
    (work/'inputs.csv').write_text(''.join(','.join(repr(v) for v in row) + '\n' for row in held_in), encoding='utf-8')
    try:
        code, output = await run_c(work, [f'{prefix}.c', 'main.c'])
    except TimeoutError:
        raise CodegenError('The generated code did not finish the replay in time.')
    if code:
        raise CodegenError('The generated code did not compile or run: ' + output[-3000:])
    actual = parse_outputs((work/'outputs.csv').read_text(encoding='utf-8'), len(generated.outputs)) if (work/'outputs.csv').exists() else []
    if len(actual) < len(held_in):
        raise CodegenError(f'The generated code stopped after {len(actual)} of {len(held_in)} steps.')
    report = compare(expected, actual, generated.outputs)
    return {'ok': all(r['passed'] for r in report), 'steps': len(held_in), 'step': generated.step,
            'tolerance': SIL_TOLERANCE, 'outputs': report}


def archive(generated: Generated) -> bytes:
    import io
    import zipfile
    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, 'w', zipfile.ZIP_DEFLATED) as z:
        for name in sorted(generated.files):
            info = zipfile.ZipInfo(name, date_time=(2020, 1, 1, 0, 0, 0))  # fixed stamp keeps archives identical
            z.writestr(info, generated.files[name])
    return buffer.getvalue()


def describe(generated: Generated) -> dict:
    return {'files': generated.files, 'step': generated.step, 'inputs': [_public(i) for i in generated.inputs],
            'outputs': [_public(o) for o in generated.outputs], 'blocks': generated.blocks, 'notes': generated.notes}


def _public(item: dict) -> dict:
    return {k: item[k] for k in ('name', 'label', 'domain', 'column') if k in item}
