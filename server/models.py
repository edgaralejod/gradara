"""Serializable editing contract. Numerical semantics are emitted as Modelica."""
import math
import re
from typing import Literal
from pydantic import BaseModel, Field, field_validator, model_validator

IDENTIFIER = r'^[A-Za-z][A-Za-z0-9_]*$'
Domain = Literal['signal', 'boolean', 'electrical', 'mechanical', 'translational', 'thermal', 'magnetic', 'threePhase']
# Domains carried by input/output ports; every other domain is a physical (acausal) connector.
CAUSAL_DOMAINS = {'signal', 'boolean'}
BlockType = Literal['signal', 'electrical', 'mechanical', 'translational', 'thermal', 'magnetic', 'multidomain']

class Port(BaseModel):
    id: str = Field(pattern=IDENTIFIER, max_length=60)
    name: str = Field(max_length=80)
    direction: Literal['input', 'output', 'physical']
    domain: Domain
    side: Literal['left', 'right', 'top', 'bottom'] | None = None
    unit: str = Field(default='', max_length=40)
    offset: float | None = Field(default=None, ge=0, le=100)

class Parameter(BaseModel):
    id: str = Field(pattern=IDENTIFIER, max_length=60)
    name: str = Field(max_length=100)
    value: float = Field(allow_inf_nan=False)
    unit: str = Field(default='', max_length=40)
    min: float | None = None
    max: float | None = None

    @model_validator(mode='after')
    def check_range(self):
        if self.min is not None and self.value < self.min:
            raise ValueError(f'{self.name} must be at least {self.min}')
        if self.max is not None and self.value > self.max:
            raise ValueError(f'{self.name} must be at most {self.max}')
        return self

class ModelicaWrapper(BaseModel):
    """A built-in block that is an instance of a Modelica Standard Library class.

    `modifiers` maps MSL parameter names to expressions over the block's parameter
    IDs; `ports` maps block port IDs to MSL connector names when they differ.
    """
    model_config = {'populate_by_name': True, 'serialize_by_alias': True}
    class_: str = Field(alias='class', pattern=r'^Modelica(\.[A-Za-z_][A-Za-z0-9_]*)+$', max_length=200)
    modifiers: dict[str, str] = Field(default_factory=dict, max_length=40)
    ports: dict[str, str] = Field(default_factory=dict, max_length=40)

    @field_validator('modifiers')
    @classmethod
    def plain_expressions(cls, values):
        for key, value in values.items():
            if not re.fullmatch(r'[A-Za-z_][A-Za-z0-9_]*(\.[A-Za-z_][A-Za-z0-9_]*)?', key):
                raise ValueError('Modifier names must be Modelica identifiers.')
            if len(value) > 200 or not re.fullmatch(r'[A-Za-z0-9_.+\-*/(), {}^]+', value):
                raise ValueError('Modifier values must be plain numeric expressions.')
        return values


class SubsystemRef(BaseModel):
    ref: str = Field(pattern=IDENTIFIER, max_length=80)


class Boundary(BaseModel):
    """Where the matching port sits on the outside of the subsystem block."""
    side: Literal['left', 'right', 'top', 'bottom'] | None = None
    order: float = 0


BOUNDARY_KINDS = {'inport': 'input', 'outport': 'output', 'connport': 'physical'}


class Definition(BaseModel):
    kind: str = Field(pattern=IDENTIFIER, max_length=80)
    name: str = Field(min_length=1, max_length=100)
    description: str = Field(max_length=1000)
    domain: Domain
    symbol: str = Field(max_length=24)
    ports: list[Port] = Field(max_length=20)
    parameters: list[Parameter] = Field(max_length=30)
    equations: str = Field(max_length=16000)
    declarations: str = Field(default='', max_length=6000)
    generated: bool = False
    controller: bool = False
    category: str = Field(default='', max_length=40)
    keywords: list[str] = Field(default_factory=list, max_length=24)
    modelica: ModelicaWrapper | None = None
    # A subsystem instance: its ports come from the boundary blocks of `subsystem.ref`.
    subsystem: 'SubsystemRef | None' = None
    # A boundary block inside a subsystem (kinds inport, outport, connport).
    boundary: 'Boundary | None' = None

    @field_validator('equations', 'declarations')
    @classmethod
    def bounded_modelica(cls, text):
        forbidden = r'\b(external|annotation|package|model|class|function|encapsulated|within|system|loadResource|loadFile|import)\b'
        if re.search(forbidden, text, re.IGNORECASE):
            raise ValueError('Use declarations and equations inside the component, without external code or class definitions.')
        if '"' in text or '\\' in text:
            raise ValueError('Component equations must be numeric Modelica expressions.')
        return text

    @model_validator(mode='after')
    def causal_ports(self):
        for port in self.ports:
            if (port.direction == 'physical') == (port.domain in CAUSAL_DOMAINS):
                raise ValueError('Input/output ports carry signal or Boolean values; physical terminals use a physical domain.')
        if self.generated and self.modelica is not None:
            raise ValueError('Generated blocks define their own equations; they cannot wrap a library class.')
        return self

    @model_validator(mode='after')
    def unique_names(self):
        ids = [p.id for p in self.ports] + [p.id for p in self.parameters]
        if len(ids) != len(set(ids)):
            raise ValueError('Ports and parameters need unique names.')
        return self

class Position(BaseModel):
    x: float = Field(allow_inf_nan=False)
    y: float = Field(allow_inf_nan=False)

class Size(BaseModel):
    width: float = Field(ge=32, le=1200, allow_inf_nan=False)
    height: float = Field(ge=32, le=1200, allow_inf_nan=False)

class Block(BaseModel):
    id: str = Field(pattern=IDENTIFIER, max_length=80)
    definition: Definition
    position: Position
    size: Size | None = None
    labelOffset: Position | None = None
    rotation: Literal[0, 90, 180, 270] | None = None

class Wire(BaseModel):
    id: str = Field(max_length=100)
    source: str
    sourceHandle: str
    target: str
    targetHandle: str
    waypoints: list[Position] = Field(default_factory=list, max_length=30)
    junctions: list[Position] = Field(default_factory=list, max_length=30)

class Junction(BaseModel):
    id: str = Field(pattern=IDENTIFIER, max_length=80)
    position: Position
    domain: Domain

class NetLabel(BaseModel):
    wireId: str = Field(min_length=1, max_length=100)
    fraction: float = Field(ge=0, le=1, allow_inf_nan=False)
    side: Literal[-1, 1] = 1

class Net(BaseModel):
    id: str = Field(pattern=IDENTIFIER, max_length=80)
    name: str | None = Field(default=None, max_length=120)
    aliases: list[str] = Field(default_factory=list, max_length=3000)
    anchor: str = Field(min_length=1, max_length=160)
    wireIds: list[str] = Field(min_length=1, max_length=3000)
    label: NetLabel | None = None
    hidden: bool = False
    logged: bool = False

    @field_validator('aliases')
    @classmethod
    def alias_lengths(cls, values):
        if any(len(value) > 120 for value in values):
            raise ValueError('Net names must be at most 120 characters.')
        return values

class Annotation(BaseModel):
    x: float
    y: float
    text: str
    detail: str = ""

class PlotGroup(BaseModel):
    id: str
    label: str
    series: list[str]
    labels: list[str] = Field(default_factory=list)

class Diagram(BaseModel):
    """One sheet: the root model or the inside of a subsystem."""
    blocks: list[Block] = Field(max_length=1000)
    wires: list[Wire] = Field(max_length=3000)
    junctions: list[Junction] = Field(default_factory=list, max_length=2000)
    nets: list[Net] | None = Field(default=None, max_length=3000)

    @model_validator(mode='after')
    def structure(self):
        blocks = {b.id: b for b in self.blocks}
        if len(blocks) != len(self.blocks):
            raise ValueError('Component identifiers must be unique.')
        taps = {j.id: j for j in self.junctions}
        if len(taps) != len(self.junctions):
            raise ValueError('Node identifiers must be unique.')
        if set(blocks) & set(taps):
            raise ValueError('A node cannot reuse a component identifier.')
        wire_ids = set()
        for wire in self.wires:
            if wire.id in wire_ids:
                raise ValueError('Connection identifiers must be unique.')
            wire_ids.add(wire.id)
            if wire.source not in blocks and wire.source not in taps:
                raise ValueError('A connection refers to a deleted component.')
            if wire.target not in blocks and wire.target not in taps:
                raise ValueError('A connection refers to a deleted component.')
            a = None
            b = None
            if wire.source in blocks:
                a = next((p for p in blocks[wire.source].definition.ports if p.id == wire.sourceHandle), None)
                if not a:
                    raise ValueError('Connection ports must exist and belong to the same domain.')
            if wire.target in blocks:
                b = next((p for p in blocks[wire.target].definition.ports if p.id == wire.targetHandle), None)
                if not b:
                    raise ValueError('Connection ports must exist and belong to the same domain.')
            domain_a = a.domain if a else taps[wire.source].domain
            domain_b = b.domain if b else taps[wire.target].domain
            if domain_a != domain_b:
                raise ValueError('Connection ports must exist and belong to the same domain.')
            if a and b:
                if a.direction == b.direction == 'physical':
                    continue
                if 'physical' in {a.direction, b.direction}:
                    raise ValueError('Physical connectors cannot join signal ports.')
        ports = {(b.id, p.id): p for b in self.blocks for p in b.definition.ports}
        for component in net_components(self):
            directions = [ports[key].direction for key in component]
            if directions.count('output') > 1:
                raise ValueError('Each signal net may have only one source, including through junctions.')
            if 'physical' in directions and any(d != 'physical' for d in directions):
                raise ValueError('Physical connectors cannot join signal ports.')
        if self.nets is not None:
            net_ids = [n.id for n in self.nets]
            if len(set(net_ids)) != len(net_ids):
                raise ValueError('Net identifiers must be unique.')
            owned = [w for n in self.nets for w in n.wireIds]
            if len(owned) != len(set(owned)) or set(owned) != wire_ids:
                raise ValueError('Every wire must belong to exactly one net.')
            by_wire = {w.id: w for w in self.wires}
            endpoint_owners = {}
            def endpoint(ident, handle):
                return f'j:{ident}' if ident in taps else f'{ident}.{handle}'
            for net in self.nets:
                if net.logged:
                    first = by_wire[net.wireIds[0]]
                    domain = ports[(first.source, first.sourceHandle)].domain if first.source in blocks else taps[first.source].domain
                    if domain not in CAUSAL_DOMAINS:
                        raise ValueError('Only signal/control nets can be logged. Add a sensor and log its signal output.')
                adj = {}
                for ident in net.wireIds:
                    wire = by_wire[ident]
                    a, b = endpoint(wire.source, wire.sourceHandle), endpoint(wire.target, wire.targetHandle)
                    adj.setdefault(a, set()).add(b)
                    adj.setdefault(b, set()).add(a)
                if net.anchor not in adj:
                    raise ValueError('A net anchor must belong to its connection.')
                seen, stack = set(), [net.anchor]
                while stack:
                    current = stack.pop()
                    if current in seen:
                        continue
                    seen.add(current)
                    stack.extend(adj[current] - seen)
                if seen != set(adj):
                    raise ValueError('A net must be one connected component.')
                for key in seen:
                    if key in endpoint_owners:
                        raise ValueError('Connected wires must share one net identifier.')
                    endpoint_owners[key] = net.id
                if net.label and net.label.wireId not in net.wireIds:
                    raise ValueError('A net label must be attached to a wire in that net.')
        return self

class PromotedTarget(BaseModel):
    blockId: str = Field(pattern=IDENTIFIER, max_length=80)
    parameterId: str = Field(pattern=IDENTIFIER, max_length=60)


class PromotedParameter(Parameter):
    """A parameter of the subsystem block that sets inner block parameters."""
    targets: list[PromotedTarget] = Field(min_length=1, max_length=20)


class Subsystem(Diagram):
    id: str = Field(pattern=IDENTIFIER, max_length=80)
    name: str = Field(min_length=1, max_length=120)
    parameters: list[PromotedParameter] = Field(default_factory=list, max_length=30)


class Project(Diagram):
    modelId: str | None = Field(default=None, pattern=r"^[A-Za-z0-9_-]+$", max_length=80)
    exampleId: str | None = Field(default=None, pattern=r"^[A-Za-z0-9_-]+$", max_length=80)
    description: str = Field(default="", max_length=2000)
    annotations: list[Annotation] = Field(default_factory=list, max_length=100)
    plots: list[PlotGroup] = Field(default_factory=list, max_length=30)
    version: Literal[1, 2] = 1
    name: str = Field(min_length=1, max_length=120)
    duration: float = Field(gt=0, le=86400, allow_inf_nan=False)
    revision: int = Field(ge=0)
    subsystems: list[Subsystem] | None = Field(default=None, max_length=500)

    @model_validator(mode='after')
    def hierarchy(self):
        from .hierarchy import check_hierarchy
        check_hierarchy(self)
        return self


def net_components(project: 'Project') -> list[list[tuple[str, str]]]:
    taps = {j.id for j in project.junctions}
    adj: dict[tuple[str, str], set[tuple[str, str]]] = {}
    def end(ident, handle):
        return (ident, 'node' if ident in taps else handle)
    for wire in project.wires:
        a, b = end(wire.source, wire.sourceHandle), end(wire.target, wire.targetHandle)
        adj.setdefault(a, set()).add(b)
        adj.setdefault(b, set()).add(a)
    seen = set()
    components = []
    for seed in sorted(adj):
        if seed in seen:
            continue
        stack, ports = [seed], []
        while stack:
            current = stack.pop()
            if current in seen:
                continue
            seen.add(current)
            if current[0] not in taps:
                ports.append(current)
            stack.extend(adj[current] - seen)
        components.append(sorted(ports))
    return components


def flatten_connects(project: 'Project') -> list[tuple[str, str, str, str]]:
    ports = {(b.id, p.id): p for b in project.blocks for p in b.definition.ports}
    pairs = []
    for component in net_components(project):
        if not component:
            continue
        driver = next((key for key in component if ports[key].direction == 'output'), None)
        source = driver or component[0]
        for target in component:
            if target == source:
                continue
            if ports[target].direction == ('input' if driver else 'physical'):
                pairs.append((*source, *target))
    return sorted(pairs)


class GenerateRequest(BaseModel):
    prompt: str = Field(min_length=3, max_length=4000)
    existing: Definition | None = None
    blockType: BlockType | None = None

class ExportRequest(BaseModel):
    project: Project
    blockId: str
    target: Literal['c'] = 'c'


class NewModelRequest(BaseModel):
    name: str = Field(default='Untitled model', min_length=1, max_length=100)
    template: Literal['blank', 'dc', 'foc', 'buck', 'flyback', 'datacenter', 'servo'] = 'blank'


class SaveModelRequest(BaseModel):
    project: Project
    expectedVersion: str | None = Field(default=None, pattern=r'^[a-f0-9]{64}$')


class CopyModelRequest(BaseModel):
    project: Project
    name: str = Field(min_length=1, max_length=120)
