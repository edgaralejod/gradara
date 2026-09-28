# SPDX-License-Identifier: Apache-2.0
"""C templates for custom blocks: written by the AI once, then used by deterministic code generation.

A template is a list of statements of the form `target = expression;`. Targets
are block outputs `{y.port}` or states `{x.name}`; expressions may use inputs
`{u.port}`, parameters `{p.id}`, states, the step `{h}`, time `{t}`, numbers,
arithmetic, comparisons, `?:`, and a fixed set of math functions. Nothing else
is accepted (no loops, pointers, calls, or includes), so a template can only
compute numbers, even when the SIL check runs it on the host.
"""
from __future__ import annotations

import hashlib
import json
import re

from .models import CAUSAL_DOMAINS, CTemplate, Definition

FUNCTIONS = {'sin', 'cos', 'tan', 'asin', 'acos', 'atan', 'atan2', 'sinh', 'cosh', 'tanh', 'exp', 'log', 'log10',
             'sqrt', 'pow', 'fabs', 'fmin', 'fmax', 'floor', 'ceil', 'fmod', 'round', 'hypot'}
PLACEHOLDER = re.compile(r'\{([uypx])\.([A-Za-z_][A-Za-z0-9_]*)\}|\{(h|t)\}')
TOKEN = re.compile(r'\s*(?:(?P<num>\d+(?:\.\d*)?(?:[eE][+-]?\d+)?|\.\d+(?:[eE][+-]?\d+)?)|(?P<ph>§\d+§)'
                   r'|(?P<name>[A-Za-z_][A-Za-z0-9_]*)|(?P<op>&&|\|\||[<>=!]=|[-+*/(),?:<>!]))')

TEMPLATE_SCHEMA = {
    'type': 'object', 'additionalProperties': False,
    'required': ['state', 'output', 'update', 'feedthrough', 'notes'],
    'properties': {
        'state': {'type': 'array', 'maxItems': 20, 'items': {
            'type': 'object', 'additionalProperties': False, 'required': ['name', 'type', 'init'],
            'properties': {'name': {'type': 'string'}, 'type': {'type': 'string', 'enum': ['real', 'bool', 'int']},
                           'init': {'type': 'number'}}}},
        'output': {'type': 'array', 'maxItems': 40, 'items': {'type': 'string'}},
        'update': {'type': 'array', 'maxItems': 40, 'items': {'type': 'string'}},
        'feedthrough': {'type': 'boolean'},
        'notes': {'type': 'string'},
    },
}


def signature(definition: Definition) -> str:
    """Identity of what a template implements: the block's equations and interface, not its values."""
    data = {'kind': definition.kind, 'equations': definition.equations, 'declarations': definition.declarations,
            'ports': [[p.id, p.direction, p.domain] for p in definition.ports],
            'parameters': sorted(p.id for p in definition.parameters)}
    return hashlib.sha256(json.dumps(data, sort_keys=True).encode()).hexdigest()[:16]


class TemplateError(ValueError):
    pass


def check(definition: Definition, template: CTemplate) -> None:
    """Refuse anything that is not a numeric assignment over this block's own names."""
    if any(p.domain not in CAUSAL_DOMAINS for p in definition.ports):
        raise TemplateError('Only signal and Boolean blocks have C templates.')
    inputs = {p.id for p in definition.ports if p.direction == 'input'}
    outputs = {p.id for p in definition.ports if p.direction == 'output'}
    params = {p.id for p in definition.parameters}
    states = [s.name for s in template.state]
    if len(set(states)) != len(states):
        raise TemplateError('Template state names must be unique.')
    known = {'u': inputs, 'y': outputs, 'p': params, 'x': set(states)}
    assigned = set()
    for phase, lines in (('output', template.output), ('update', template.update)):
        for line in lines:
            target = _statement(line, known, phase)
            assigned.add(target)
    missing = sorted(f'y.{o}' for o in outputs if f'y.{o}' not in assigned)
    if missing:
        raise TemplateError('The template never sets ' + ', '.join(missing) + '.')


def _statement(line: str, known: dict, phase: str) -> str:
    text = line.strip()
    match = re.fullmatch(r'\{([yx])\.([A-Za-z_][A-Za-z0-9_]*)\}\s*=(?!=)\s*(.+);', text)
    if not match:
        raise TemplateError(f'Each statement must be "{{y.port}} = …;" or "{{x.state}} = …;": {text[:80]}')
    kind, name, expression = match.groups()
    if name not in known[kind]:
        raise TemplateError(f'{{{kind}.{name}}} is not an output or state of this block.')
    if kind == 'y' and phase == 'update':
        raise TemplateError('Outputs are set in the output phase, not in update.')
    _expression(expression, known)
    return f'{kind}.{name}'


def _expression(expression: str, known: dict) -> None:
    # Comment markers would hide the rest of the generated line or later statements.
    if re.search(r'/\s*[/*]|\*\s*/', expression):
        raise TemplateError('Comments are not allowed in a template expression.')
    holders = []

    def hold(m):
        if m.group(3):
            holders.append(m.group(3))
        else:
            kind, name = m.group(1), m.group(2)
            if name not in known[kind]:
                raise TemplateError(f'{{{kind}.{name}}} is not part of this block.')
            holders.append(f'{kind}.{name}')
        return f'§{len(holders) - 1}§'
    text = PLACEHOLDER.sub(hold, expression)
    position, depth = 0, 0
    while position < len(text):
        m = TOKEN.match(text, position)
        if not m or m.end() == position:
            rest = text[position:].strip()
            if not rest:
                break
            raise TemplateError(f'Unexpected text in a template expression: {rest[:40]}')
        if m.group('name') and m.group('name') not in FUNCTIONS:
            raise TemplateError(f'{m.group("name")} is not allowed; use placeholders and math functions only.')
        op = m.group('op')
        if op == '(':
            depth += 1
        elif op == ')':
            depth -= 1
            if depth < 0:
                raise TemplateError('Unbalanced parentheses in a template expression.')
        position = m.end()
    if depth:
        raise TemplateError('Unbalanced parentheses in a template expression.')


def render(line: str, names: dict) -> str:
    """Replace placeholders with the generated C names."""
    return PLACEHOLDER.sub(lambda m: names[m.group(3)] if m.group(3) else names[f'{m.group(1)}.{m.group(2)}'], line)


PROMPT = '''Write the C step logic for one Gradara signal block as JSON. Return only JSON. Do not call tools.

The block is simulated from these Modelica equations; reproduce their behavior in discrete time with step {h} seconds.
Statements are C, one per string, each exactly: {y.port} = expression;  or  {x.state} = expression;
Placeholders: {u.port} input, {y.port} output, {p.id} parameter, {x.name} a state you declare, {h} step size, {t} time.
Expressions may use numbers, + - * / ( ), comparisons, && || !, the ?: operator, and these functions only: FUNCTIONS.
No other names, no declarations, no if/for/while, no pointers or arrays, no semicolons except at the end.
"output" statements run every step in order and must set every output; they may read inputs.
"update" statements run after all blocks have produced outputs; they advance states and must not set outputs.
Set "feedthrough" to false only when no output statement reads an input.
Declare each state in "state" with a type (real, bool, int) and its initial value. Discretize continuous states
(der()) with a stable method and say which in "notes" (one short sentence).
Block:
'''.replace('FUNCTIONS', ', '.join(sorted(FUNCTIONS)))


def _probe(definition: Definition):
    """A one-block project: constants feed the inputs and terminators take the outputs."""
    from .models import Project
    signal = lambda kind, ports, params=(): {
        'kind': kind, 'name': kind, 'description': '', 'domain': 'signal', 'symbol': '', 'equations': 'y = 0;',
        'parameters': [{'id': k, 'name': k, 'value': v} for k, v in params],
        'ports': [{'id': i, 'name': i, 'direction': d, 'domain': 'signal'} for i, d in ports]}
    blocks = [{'id': 'block', 'definition': definition.model_dump(exclude_none=True, by_alias=True),
               'position': {'x': 0, 'y': 0}}]
    wires = []
    for n, port in enumerate(definition.ports):
        other = f'b{n}'
        if port.direction == 'input':
            blocks.append({'id': other, 'definition': signal('constant', [('y', 'output')], [('value', 1)]),
                           'position': {'x': 0, 'y': 0}})
            wires.append({'id': f'w{n}', 'source': other, 'sourceHandle': 'y', 'target': 'block', 'targetHandle': port.id})
        else:
            blocks.append({'id': other, 'definition': signal('terminator', [('u', 'input')]), 'position': {'x': 0, 'y': 0}})
            wires.append({'id': f'w{n}', 'source': 'block', 'sourceHandle': port.id, 'target': other, 'targetHandle': 'u'})
    return Project.model_validate({'name': 'probe', 'duration': 1, 'revision': 0, 'blocks': blocks, 'wires': wires})


async def write_template(definition: Definition, job_id: str, progress=lambda message: None) -> dict:
    """Ask the AI provider for a template, check it, compile it in a one-block unit, and allow one repair."""
    from pathlib import Path

    from . import agent, engines
    from .codegen import CodegenError, CodegenOptions, generate
    from .paths import EXPORTS
    if not definition.generated:
        raise TemplateError('Only custom (AI-generated) blocks need a C template; library blocks have their own.')
    if any(p.domain not in CAUSAL_DOMAINS for p in definition.ports):
        raise TemplateError('Only signal and Boolean blocks have C templates.')
    brief = {'name': definition.name, 'equations': definition.equations, 'declarations': definition.declarations,
             'ports': [{'id': p.id, 'direction': p.direction, 'domain': p.domain} for p in definition.ports],
             'parameters': [{'id': p.id, 'value': p.value, 'unit': p.unit} for p in definition.parameters]}
    prompt = PROMPT + json.dumps(brief)
    folder = Path(EXPORTS)/f'template-{job_id}'
    folder.mkdir(parents=True, exist_ok=True)
    problem = ''
    for attempt in range(2):
        progress('Writing the C template' if not attempt else 'Revising the C template')
        data = await agent.structured_generation(
            prompt + (f'\nThe previous attempt was rejected: {problem[:1500]}' if problem else ''),
            TEMPLATE_SCHEMA, f'template-{job_id}-{attempt}', task='export')
        try:
            template = CTemplate.model_validate(data | {'signature': signature(definition)})
            check(definition, template)
            with_template = definition.model_copy(update={'ctemplate': template})
            generated = generate(_probe(with_template), [], None, ['block'], CodegenOptions(prefix='probe'))
            for name, text in generated.files.items():
                (folder/name).write_text(text, encoding='utf-8')
            code, output = await engines.compile_c(folder, 'probe.c')
            if code == 0:
                return {'ctemplate': template.model_dump(), 'notes': generated.notes}
            problem = 'The C did not compile: ' + output[-1500:]
        except (ValueError, CodegenError) as exc:
            problem = str(exc)
    raise TemplateError(f'The C template for {definition.name} could not be completed: {problem[:600]}')
