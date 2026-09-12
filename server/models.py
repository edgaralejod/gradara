"""Serializable editing contract. Numerical semantics are emitted as Modelica."""
import math
import re
from typing import Literal
from pydantic import BaseModel, Field, field_validator, model_validator

IDENTIFIER = r'^[A-Za-z][A-Za-z0-9_]*$'
Domain = Literal['signal', 'electrical', 'mechanical', 'thermal']

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
    height: float = Field(ge=32, le=1000, allow_inf_nan=False)

class Block(BaseModel):
    id: str = Field(pattern=IDENTIFIER, max_length=80)
    definition: Definition
    position: Position
    size: Size | None = None

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

class Project(BaseModel):
    exampleId: str = Field(default="dc", pattern=r"^[A-Za-z0-9_-]+$", max_length=80)
    description: str = Field(default="", max_length=2000)
    annotations: list[Annotation] = Field(default_factory=list, max_length=100)
    plots: list[PlotGroup] = Field(default_factory=list, max_length=30)
    version: Literal[1] = 1
    name: str = Field(min_length=1, max_length=120)
    blocks: list[Block] = Field(max_length=1000)
    wires: list[Wire] = Field(max_length=3000)
    junctions: list[Junction] = Field(default_factory=list, max_length=2000)
    duration: float = Field(gt=0, le=60, allow_inf_nan=False)
    revision: int = Field(ge=0)

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
        occupied = set()
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
                if {a.direction, b.direction} != {'input', 'output'}:
                    raise ValueError('Signal connections require one input and one output.')
            if b and b.direction == 'input':
                key = (wire.target, b.id)
                if key in occupied:
                    raise ValueError('Each signal input may have only one source.')
                occupied.add(key)
            if a and a.direction == 'input':
                key = (wire.source, a.id)
                if key in occupied:
                    raise ValueError('Each signal input may have only one source.')
                occupied.add(key)
        return self

def flatten_connects(project: 'Project') -> list[tuple[str, str, str, str]]:
    taps = {j.id for j in project.junctions}
    blocks = {b.id: b for b in project.blocks}

    def key(ident: str, handle: str) -> str:
        return f'j:{ident}' if ident in taps else f'{ident}.{handle}'

    adj: dict[str, list[str]] = {}
    def link(a: str, b: str):
        adj.setdefault(a, []).append(b)
        adj.setdefault(b, []).append(a)
    for wire in project.wires:
        link(key(wire.source, wire.sourceHandle), key(wire.target, wire.targetHandle))

    def port_of(k: str):
        if k.startswith('j:'):
            return None
        bid, _, hid = k.partition('.')
        block = blocks.get(bid)
        if not block:
            return None
        return next((p for p in block.definition.ports if p.id == hid), None)

    pairs: list[tuple[str, str, str, str]] = []
    seen: set[tuple[str, str, str, str]] = set()
    for origin in list(adj):
        port = port_of(origin)
        if not port or port.direction not in {'output', 'physical'}:
            continue
        stack = [origin]
        visited = {origin}
        while stack:
            cur = stack.pop()
            for nxt in adj.get(cur, []):
                if nxt in visited:
                    continue
                visited.add(nxt)
                if nxt.startswith('j:'):
                    stack.append(nxt)
                    continue
                other = port_of(nxt)
                if not other or other.direction not in {'input', 'physical'}:
                    continue
                sid, _, sh = origin.partition('.')
                tid, _, th = nxt.partition('.')
                pair = (sid, sh, tid, th)
                if pair not in seen:
                    seen.add(pair)
                    pairs.append(pair)
    return pairs


class GenerateRequest(BaseModel):
    prompt: str = Field(min_length=3, max_length=4000)
    existing: Definition | None = None

class ExportRequest(BaseModel):
    project: Project
    blockId: str
    target: Literal['c'] = 'c'
