# SPDX-License-Identifier: Apache-2.0
"""Draw a block's symbol with the AI: a bounded drawing (shapes and port anchors), never code.

The workbench's symbol editor sends the block's definition (its ports as laid out now)
and a short description ("a schematic N-channel MOSFET"). The agent returns a `Drawing`
in a flat, schema-friendly form; conventional code turns it into a `SymbolGlyph`
(server/models.py, lib/gradara/glyph.ts) and checks it: every shape in bounds, an anchor
on every port. The job runs as the existing `component` job kind and task, priced like
creating or refining a block, so the Gradara AI gateway needs no change. Nothing is
saved; the editor shows the drawing for the user to keep or change.
"""
from __future__ import annotations

import json
from typing import ClassVar, Literal

from pydantic import Field, ValidationError

from . import agent
from .llm import dispatch, structured
from .model_agent import Strict
from .models import Definition, SymbolGlyph


class SymbolRequest(Strict):
    definition: Definition
    description: str = Field(min_length=3, max_length=600)


class DrawnShape(Strict):
    """One shape; fields the shape's type does not use are null."""
    type: Literal['line', 'polygon', 'rect', 'ellipse', 'arc', 'path', 'text']
    points: list[list[float]] | None = Field(default=None, max_length=60)
    x: float | None = None
    y: float | None = None
    width: float | None = None
    height: float | None = None
    rx: float | None = None
    ry: float | None = None
    cx: float | None = None
    cy: float | None = None
    r: float | None = None
    start: float | None = None
    end: float | None = None
    d: str | None = Field(default=None, max_length=2000)
    text: str | None = Field(default=None, max_length=24)
    fill: bool | None = None


class DrawnAnchor(Strict):
    port: str = Field(max_length=80)
    x: float
    y: float


class Drawing(Strict):
    prose: ClassVar = set()
    width: float
    height: float
    outline: bool
    shapes: list[DrawnShape] = Field(min_length=1, max_length=120)
    anchors: list[DrawnAnchor] = Field(max_length=20)


FIELDS = {
    'line': ('points',), 'polygon': ('points', 'fill'), 'rect': ('x', 'y', 'width', 'height', 'rx', 'fill'),
    'ellipse': ('cx', 'cy', 'rx', 'ry', 'fill'), 'arc': ('cx', 'cy', 'r', 'start', 'end'), 'path': ('d', 'fill'),
    'text': ('x', 'y', 'text'),
}

INSTRUCTIONS = '''You draw the schematic symbol of one block for Gradara, a graphical simulation workbench. Return only schema JSON; do not use tools.
The drawing is line art in its own design box: units are diagram units (one unit is one pixel at 100% zoom), x to the right, y DOWN, origin at the top left. Gradara strokes every shape at 1.6 units in the block's domain color with round caps, centers the drawing in the block, and draws a lead from each terminal on the block's edge to that terminal's anchor, so do not draw the terminals or leads yourself.
Follow standard IEC/IEEE schematic conventions an engineer would recognize (a transistor with its gate, channel, and arrow; a diode triangle and bar; coils as arcs). Keep it compact and clean: typical design boxes are 40 x 32 for a two-terminal element, 36 x 44 for a transistor, 48 x 40 for an amplifier, and never more than 160 on a side. Use whole or half units. Use fill only for solid marks such as arrowheads. A few short labels (text, at most 4 characters, such as D, S, +, −) are allowed when they help.
outline is false for a schematic symbol drawn on its own, true when the drawing reads better inside the block's rectangle (a converter, a controller, a sensor with a pictogram).
Give EXACTLY one anchor for every port listed below: the point where that port's lead should meet the drawing, on the edge of the drawing facing the side the port is on (a left port's anchor at x = 0, a top port's at y = 0, and so on), at the place the symbol's own terminal is. Anchors and all coordinates must lie inside the design box.
Shapes: line (points: two or more [x, y]), polygon (points, closed; fill), rect (x, y, width, height, optional rx), ellipse (cx, cy, rx, ry), arc (cx, cy, r, start and end in degrees, clockwise from +x with y down, so 90 is straight down), path (d: SVG path data with M L H V C S Q T A Z and numbers only), text (x, y, text, centered on the point). Set fields a shape does not use to null.
Example, the built-in N-channel MOSFET with ports D (top), G (left), S (bottom), B (right): width 36, height 44, outline false, shapes [path "M0 22H5M5 12V32M10 8V16M10 18V26M10 28V36M10 12H18V0M10 32H18V44M18 22H36M18 32V22", polygon [[11,22],[17,18.5],[17,25.5]] fill true], anchors D (18, 0), G (0, 22), S (18, 44), B (36, 22).'''


def drawing_prompt(request: SymbolRequest) -> str:
    d = request.definition
    ports = [dict(id=p.id, name=p.name, direction=p.direction, domain=p.domain, side=p.side or
                  ('left' if p.direction == 'input' else 'right')) for p in d.ports]
    return '\n'.join([INSTRUCTIONS,
                      '\nThe block: ' + json.dumps(dict(name=d.name, kind=d.kind, domain=d.domain, symbol=d.symbol,
                                                         description=d.description[:600])),
                      'Its ports (draw an anchor for each, facing its side): ' + json.dumps(ports),
                      '\nWhat the user wants the symbol to look like:\n' + request.description])


def to_glyph(drawing: Drawing, definition: Definition) -> SymbolGlyph:
    """The checked SymbolGlyph for `drawing`; ValueError with a readable reason otherwise."""
    shapes = []
    for shape in drawing.shapes:
        fields = {k: getattr(shape, k) for k in FIELDS[shape.type] if getattr(shape, k) is not None}
        if 'points' in fields:
            fields['points'] = [tuple(p[:2]) for p in fields['points'] if len(p) >= 2]
        shapes.append({'type': shape.type, **fields})
    ports = {p.id for p in definition.ports}
    anchors = {a.port: {'x': a.x, 'y': a.y} for a in drawing.anchors if a.port in ports}
    missing = sorted(ports - set(anchors))
    if missing:
        raise ValueError('Give an anchor for every port; missing: ' + ', '.join(missing) + '.')
    try:
        return SymbolGlyph.model_validate(dict(width=drawing.width, height=drawing.height, shapes=shapes,
                                               anchors=anchors, outline=drawing.outline))
    except ValidationError as exc:
        raise ValueError('The drawing is out of bounds: '
                         + '; '.join(f"{'.'.join(map(str, e['loc']))}: {e['msg']}" for e in exc.errors()[:4])) from exc


async def draw_symbol(request: SymbolRequest, job_id: str, progress=lambda message: None) -> dict:
    prompt = drawing_prompt(request)
    for attempt in range(2):
        progress('Drawing the symbol' if attempt == 0 else 'Correcting the drawing')
        drawing = await structured.generate(prompt, Drawing, f'{job_id}-symbol{attempt}', task='component')
        try:
            glyph = to_glyph(drawing, request.definition)
        except ValueError as exc:
            if attempt:
                raise
            prompt += ('\nYour previous drawing:\n' + drawing.model_dump_json()[-8000:]
                       + '\nIt cannot be used: ' + str(exc) + '\nReturn the complete corrected drawing.')
            continue
        result = {'glyph': glyph.model_dump(exclude_none=True), 'provider': agent.provider_label()}
        credits = dispatch.credits_for_current_job()
        return result | ({'credits': credits} if credits is not None else {})
