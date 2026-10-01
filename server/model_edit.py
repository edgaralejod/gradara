# SPDX-License-Identifier: Apache-2.0
"""Edit the open model: the agent plans bounded operations, conventional code applies and checks them."""
import json
from typing import ClassVar, Literal
from pydantic import Field, ValidationError
from . import agent
from .diagnostics import Diagnostic, SimulationFailure, validate_simulation
from .engine import simulate
from .llm import dispatch, structured
from .model_agent import ParameterValue, Strict, catalog_snapshot, describe
from .models import CAUSAL_DOMAINS, Block, BlockType, Definition, Net, Project, Wire, flatten_connects
from .paths import DATA

MAX_CREATED = 2
MAX_GENERATED = 3
OPS = ('add_block', 'create_block', 'revise_definition', 'remove_block', 'rename_block', 'set_parameter',
       'connect', 'disconnect', 'set_duration')
LAYOUT = ('position', 'size', 'rotation', 'labelOffset')


class Operation(Strict):
    op: Literal[OPS]
    blockId: str | None = None
    alias: str | None = None
    libraryId: str | None = None
    name: str | None = None
    near: str | None = None
    blockType: BlockType | None = None
    prompt: str | None = Field(default=None, max_length=4000)
    parameterId: str | None = None
    value: float | None = Field(default=None, allow_inf_nan=False)
    parameters: list[ParameterValue] | None = Field(default=None, max_length=30)
    source: str | None = None
    sourcePort: str | None = None
    target: str | None = None
    targetPort: str | None = None
    wireId: str | None = None
    duration: float | None = Field(default=None, allow_inf_nan=False)


class PreviousProposal(Strict):
    """An unapplied proposal the user asks to revise: what they asked and what was proposed."""
    prompt: str = Field(max_length=4000)
    summary: str = Field(max_length=600)
    operations: list[Operation] = Field(min_length=1, max_length=40)


class ModelEditRequest(Strict):
    prompt: str = Field(min_length=3, max_length=4000)
    project: Project
    # Snapshot of the actual UI catalog, as for full-model generation.
    catalog: list[Definition] = Field(min_length=1, max_length=300)
    selection: list[str] = Field(default_factory=list, max_length=200)
    verify: bool = True
    context: str | None = Field(default=None, max_length=6000)
    # Set by Refine: the request then revises this proposal instead of starting over.
    previous: PreviousProposal | None = None


class EditPlan(Strict):
    prose: ClassVar = {'summary', 'assumptions', 'unsupported'}
    summary: str = Field(max_length=600)
    assumptions: list[str] = Field(max_length=8)
    unsupported: str = Field(max_length=1000)
    operations: list[Operation] = Field(min_length=1, max_length=40)


class Change(Strict):
    op: str
    blockIds: list[str] = []
    wireIds: list[str] = []
    description: str


class Unsupported(ValueError):
    pass


def semantic_view(project: Project) -> dict:
    """The model without layout, so the prompt carries behavior and connectivity only."""
    data = project.model_dump(exclude_none=True, exclude={'annotations', 'plots', 'junctions'})
    for block in data['blocks']:
        for key in LAYOUT:
            block.pop(key, None)
        for port in block['definition']['ports']:
            port.pop('side', None)
            port.pop('offset', None)
    for wire in data['wires']:
        wire.pop('waypoints', None)
        wire.pop('junctions', None)
    for net in data.get('nets') or []:
        net.pop('label', None)
    return data


def check_limits(plan: EditPlan):
    created = [o for o in plan.operations if o.op == 'create_block']
    revised = [o for o in plan.operations if o.op == 'revise_definition']
    if len(created) > MAX_CREATED:
        raise ValueError(f'An edit can create at most {MAX_CREATED} new block definitions.')
    if len(created) + len(revised) > MAX_GENERATED:
        raise ValueError(f'An edit can create or rewrite at most {MAX_GENERATED} block definitions.')
    for o in created:
        if not (o.alias and o.blockType and o.prompt):
            raise ValueError('create_block needs alias, blockType, and prompt.')
    for o in revised:
        if not (o.blockId and o.prompt):
            raise ValueError('revise_definition needs blockId and prompt.')


def _free_position(blocks, near, taken):
    def clear(x, y):
        return all(abs(x - bx) >= 200 or abs(y - by) >= 150 for bx, by in taken)
    if near is not None:
        x, y = near.position.x + 320, near.position.y
    else:
        x = max((b.position.x for b in blocks), default=-320) + 320
        y = min((b.position.y for b in blocks), default=0)
    for _ in range(40):
        if clear(x, y):
            return {'x': x, 'y': y}
        y += 224
    return {'x': x, 'y': y}


def assign_nets(project: Project, new_wires: list[str]):
    """Every wire belongs to one net: a new wire joins (and may merge) the nets its ports are on."""
    wires = {w.id: w for w in project.wires}
    def ends(wire_id):
        w = wires[wire_id]
        return {(w.source, w.sourceHandle), (w.target, w.targetHandle)}
    for ident in new_wires:
        touching = [n for n in project.nets if any(ends(ident) & ends(i) for i in n.wireIds)]
        if touching:
            keep = touching[0]
            for other in touching[1:]:
                keep.wireIds += [i for i in other.wireIds if i not in keep.wireIds]
                keep.aliases += [a for a in ([other.name] if other.name else []) + other.aliases if a not in keep.aliases]
            project.nets = [n for n in project.nets if n not in touching[1:]]
            keep.wireIds.append(ident)
        else:
            w, taken, n = wires[ident], {net.id for net in project.nets}, 1
            while f'net_ai_{n}' in taken:
                n += 1
            project.nets.append(Net(id=f'net_ai_{n}', anchor=f'{w.source}.{w.sourceHandle}', wireIds=[ident], hidden=True))


def apply_operations(project: Project, plan: EditPlan, catalog: dict[str, Definition],
                     generated: dict[str, Definition] | None = None,
                     revised: dict[str, Definition] | None = None) -> tuple[Project, list[Change]]:
    """Apply every operation or none; raises ValueError with a readable reason."""
    generated, revised = generated or {}, revised or {}
    edited = project.model_copy(deep=True)
    blocks = {b.id: b for b in edited.blocks}
    aliases: dict[str, str] = {}
    changes: list[Change] = []
    new_wires: list[str] = []
    counter = 0

    def resolve(ref: str | None, what: str = 'block') -> str:
        if ref in blocks:
            return ref
        if ref in aliases:
            return aliases[ref]
        raise ValueError(f'Unknown {what} "{ref}".')

    def name_of(block_id: str) -> str:
        return blocks[block_id].definition.name

    def add_instance(op: Operation, definition: Definition):
        if not op.alias or not op.alias.replace('_', 'a').isalnum() or not op.alias[0].isalpha():
            raise ValueError('New blocks need a short alias made of letters, digits, and underscores.')
        if op.alias in aliases:
            raise ValueError(f'The alias "{op.alias}" is used twice.')
        definition = definition.model_copy(deep=True)
        if op.name:
            definition.name = op.name
        parameters = {p.id: p for p in definition.parameters}
        for value in op.parameters or []:
            if value.id not in parameters:
                raise ValueError(f'{definition.name} has no parameter "{value.id}".')
            parameters[value.id].value = value.value
        definition = Definition.model_validate(definition.model_dump())
        ident, suffix = 'b_' + op.alias, 1
        while ident in blocks:
            ident, suffix = f'b_{op.alias}{suffix}', suffix + 1
        near = blocks.get(aliases.get(op.near, op.near)) if op.near else None
        taken = [(b.position.x, b.position.y) for b in blocks.values()]
        block = Block.model_validate({'id': ident, 'definition': definition.model_dump(),
                                      'position': _free_position(list(blocks.values()), near, taken)})
        edited.blocks.append(block)
        blocks[ident] = block
        aliases[op.alias] = ident
        return ident

    def driven(block_id: str, port_id: str) -> bool:
        return any((a, b) == (block_id, port_id) or (c, d) == (block_id, port_id) for a, b, c, d in flatten_connects(edited))

    for op in plan.operations:
        if op.op in ('add_block', 'create_block'):
            if op.op == 'add_block':
                if op.libraryId not in catalog:
                    raise ValueError(f'Unknown library block "{op.libraryId}".')
                definition = catalog[op.libraryId]
            else:
                if op.alias not in generated:
                    raise ValueError(f'The new block "{op.alias}" was not created.')
                definition = generated[op.alias]
            ident = add_instance(op, definition)
            changes.append(Change(op=op.op, blockIds=[ident], description=f'Add {name_of(ident)}'))
        elif op.op == 'revise_definition':
            ident = resolve(op.blockId)
            if ident not in revised:
                raise ValueError(f'The revision of {name_of(ident)} was not created.')
            definition = revised[ident].model_copy(deep=True)
            definition.name = blocks[ident].definition.name
            blocks[ident].definition = Definition.model_validate(definition.model_dump())
            changes.append(Change(op=op.op, blockIds=[ident], description=f'Rewrite the equations of {name_of(ident)}'))
        elif op.op == 'remove_block':
            ident = resolve(op.blockId)
            removed = [w.id for w in edited.wires if ident in (w.source, w.target)]
            name = name_of(ident)
            edited.blocks = [b for b in edited.blocks if b.id != ident]
            edited.wires = [w for w in edited.wires if w.id not in removed]
            del blocks[ident]
            changes.append(Change(op=op.op, blockIds=[ident], wireIds=removed, description=f'Remove {name}'))
        elif op.op == 'rename_block':
            ident = resolve(op.blockId)
            if not op.name or len(op.name) > 100:
                raise ValueError('rename_block needs a name of 1 to 100 characters.')
            old = name_of(ident)
            blocks[ident].definition.name = op.name
            changes.append(Change(op=op.op, blockIds=[ident], description=f'Rename {old} to {op.name}'))
        elif op.op == 'set_parameter':
            ident = resolve(op.blockId)
            definition = blocks[ident].definition
            parameter = next((p for p in definition.parameters if p.id == op.parameterId), None)
            if parameter is None or op.value is None:
                raise ValueError(f'{definition.name} has no parameter "{op.parameterId}", or no value was given.')
            before = parameter.value
            parameter.value = op.value
            blocks[ident].definition = Definition.model_validate(definition.model_dump())
            unit = f' {parameter.unit}' if parameter.unit else ''
            changes.append(Change(op=op.op, blockIds=[ident],
                                  description=f'Set {definition.name}.{parameter.name} from {before:g} to {op.value:g}{unit}'))
        elif op.op == 'connect':
            a, b = resolve(op.source), resolve(op.target)
            pa = next((p for p in blocks[a].definition.ports if p.id == op.sourcePort), None)
            pb = next((p for p in blocks[b].definition.ports if p.id == op.targetPort), None)
            if pa is None or pb is None:
                missing = f'{name_of(a)}.{op.sourcePort}' if pa is None else f'{name_of(b)}.{op.targetPort}'
                raise ValueError(f'Port {missing} does not exist.')
            if (a, pa.id) == (b, pb.id):
                raise ValueError('A port cannot connect to itself.')
            if pa.domain != pb.domain:
                raise ValueError(f'Cannot connect {pa.domain} {name_of(a)}.{pa.name} to {pb.domain} {name_of(b)}.{pb.name}.')
            if pa.domain in CAUSAL_DOMAINS:
                if pa.direction == 'input' and pb.direction == 'output':
                    a, pa, b, pb = b, pb, a, pa
                if (pa.direction, pb.direction) != ('output', 'input'):
                    raise ValueError(f'Signal connections run from an output to an input ({name_of(a)}.{pa.name} → {name_of(b)}.{pb.name}).')
                if driven(b, pb.id):
                    raise ValueError(f'{name_of(b)}.{pb.name} already has a source.')
            elif pa.direction != 'physical' or pb.direction != 'physical':
                raise ValueError('Physical terminals connect only to physical terminals.')
            if any({(w.source, w.sourceHandle), (w.target, w.targetHandle)} == {(a, pa.id), (b, pb.id)} for w in edited.wires):
                raise ValueError(f'{name_of(a)}.{pa.name} and {name_of(b)}.{pb.name} are already connected.')
            counter += 1
            ident = f'w_ai_{counter}'
            while any(w.id == ident for w in edited.wires):
                counter += 1
                ident = f'w_ai_{counter}'
            edited.wires.append(Wire(id=ident, source=a, sourceHandle=pa.id, target=b, targetHandle=pb.id))
            new_wires.append(ident)
            changes.append(Change(op=op.op, blockIds=[a, b], wireIds=[ident],
                                  description=f'Connect {name_of(a)}.{pa.name} to {name_of(b)}.{pb.name}'))
        elif op.op == 'disconnect':
            if op.wireId:
                matches = [w for w in edited.wires if w.id == op.wireId]
            else:
                a, b = resolve(op.source), resolve(op.target)
                ends = {(a, op.sourcePort), (b, op.targetPort)}
                matches = [w for w in edited.wires if {(w.source, w.sourceHandle), (w.target, w.targetHandle)} == ends]
            if not matches:
                raise ValueError('There is no such connection to remove.')
            ids = [w.id for w in matches]
            edited.wires = [w for w in edited.wires if w.id not in ids]
            touched = [i for w in matches for i in (w.source, w.target) if i in blocks]
            changes.append(Change(op=op.op, blockIds=list(dict.fromkeys(touched)), wireIds=ids,
                                  description='Disconnect ' + ' and '.join(name_of(i) for i in dict.fromkeys(touched)) if touched else 'Remove a connection'))
        elif op.op == 'set_duration':
            if op.duration is None or not 0 < op.duration <= 86400:
                raise ValueError('The stop time must be greater than 0 and at most 86,400 s.')
            before = edited.duration
            edited.duration = op.duration
            changes.append(Change(op=op.op, description=f'Set the stop time from {before:g} s to {op.duration:g} s'))
    wire_ids = {w.id for w in edited.wires}
    if edited.nets is not None:
        for net in edited.nets:
            net.wireIds = [i for i in net.wireIds if i in wire_ids]
        edited.nets = [n for n in edited.nets if n.wireIds]
        assign_nets(edited, new_wires)
    try:
        result = Project.model_validate(edited.model_dump())
    except ValidationError as exc:
        raise ValueError('The edited model is not valid: ' + '; '.join(e['msg'] for e in exc.errors()[:3])) from exc
    return result, changes


INSTRUCTIONS = '''You edit an existing Gradara model. Return only schema JSON; do not use tools.
Make only the change the user asks for. Keep every existing block ID, name, parameter, and connection that the request does not concern.
Operations run in order:
- add_block: place a catalog block (libraryId from the catalog, a new alias, optional name, parameter overrides, near = a block to place it next to).
- create_block: only when no catalog block fits; give alias, blockType, and a self-contained prompt for the typed component creator. At most two per edit.
- revise_definition: rewrite one existing block's equations (blockId, prompt). Its ports stay the same. Combined with create_block, at most three per edit.
- remove_block, rename_block (blockId, name), set_parameter (blockId, parameterId, value), set_duration (duration in s).
- connect (source, sourcePort, target, targetPort): signal connections run from an output port to an input port, and an input has one source; physical terminals connect only to the same domain. Block references may be existing IDs or aliases added earlier in this edit.
- disconnect: wireId, or the four endpoint fields.
Prefer catalog blocks and parameter changes over new definitions. Gradara places new blocks and draws new wires in its house style, so never describe positions; give new blocks short names of 1-3 words. Keep physical references (ground) and connect every signal input you add. Set unused fields to null.
If the request cannot be done with these operations or the supported physics (electrical including 3-phase, rotational and translational mechanical, thermal, magnetic, scalar Real and Boolean signals), explain why in unsupported and return one set_duration operation with the current stop time. Otherwise unsupported is empty.
summary is one or two sentences for the user. assumptions are short and explicit.'''


def edit_prompt(request: ModelEditRequest, catalog: dict[str, Definition]) -> str:
    names = {b.id: b.definition.name for b in request.project.blocks}
    selection = [f'{names[i]} ({i})' for i in request.selection if i in names]
    parts = [INSTRUCTIONS]
    if request.previous:
        earlier = request.previous
        parts.append('\nYou are revising a proposal you made earlier. The user has not applied it, so the current model below '
                     'does not contain it. Return one complete plan against the current model that carries out the earlier '
                     'request with the revision applied. Keep the parts of the earlier plan that the revision does not concern.'
                     '\nEarlier request:\n' + earlier.prompt
                     + '\nEarlier proposal:\n' + earlier.summary
                     + '\nEarlier operations:\n'
                     + json.dumps([o.model_dump(exclude_none=True) for o in earlier.operations])
                     + '\nRevision the user asks for:\n' + request.prompt)
    else:
        parts.append('\nUser request:\n' + request.prompt)
    if selection:
        parts.append('\nSelected blocks (the request most likely concerns these):\n' + ', '.join(selection))
    if request.context:
        parts.append('\nContext from the last run:\n' + request.context[-6000:])
    parts.append('\nCurrent model (layout omitted):\n' + json.dumps(semantic_view(request.project)))
    parts.append('\nCatalog:\n' + describe(catalog))
    return '\n'.join(parts)


async def realize(plan: EditPlan, project: Project, job_id: str, progress, cache: dict) -> tuple[dict, dict]:
    """Generate new and revised definitions; each is one priced part of the job."""
    generated, revised = {}, {}
    blocks = {b.id: b for b in project.blocks}
    jobs = [o for o in plan.operations if o.op in ('create_block', 'revise_definition')]
    for index, op in enumerate(jobs):
        existing = blocks.get(op.blockId) if op.op == 'revise_definition' else None
        if op.op == 'revise_definition' and existing is None:
            raise ValueError(f'Unknown block "{op.blockId}" to revise.')
        if existing is not None and existing.definition.modelica is not None:
            raise ValueError(f'{existing.definition.name} is a Modelica Standard Library block; set its parameters or '
                             'replace it with create_block instead of rewriting it.')
        key = (op.op, op.alias or op.blockId, op.prompt)
        label = op.alias if op.op == 'create_block' else existing.definition.name
        if key not in cache:
            progress(f'{"Creating" if op.op == "create_block" else "Rewriting"} block {index + 1}/{len(jobs)}: {label}')
            with dispatch.job_part(f'block:{len(cache) + 1}'):
                result = await agent.generate_component(op.prompt, existing.definition if existing else None,
                                                        f'{job_id}-block{len(cache)}', op.blockType)
            cache[key] = Definition.model_validate(result['definition'])
        if op.op == 'create_block':
            generated[op.alias] = cache[key]
        else:
            revised[op.blockId] = cache[key]
    return generated, revised


def proposal(project: Project, original: Project, plan: EditPlan, changes: list[Change], generated: dict,
             verified: bool, diagnostics: list[Diagnostic], samples: int | None) -> dict:
    document = project.model_dump(exclude_none=True)
    before = {w.id for w in original.wires}
    for wire in document['wires']:
        # New wires carry no route, so the canvas router draws them.
        if wire['id'] not in before:
            wire.pop('waypoints', None)
            wire.pop('junctions', None)
    return dict(project=document, summary=plan.summary, assumptions=plan.assumptions,
                changes=[c.model_dump() for c in changes],
                operations=[o.model_dump(exclude_none=True) for o in plan.operations],
                generated=[dict(alias=alias, name=d.name) for alias, d in generated.items()],
                verified=verified, diagnostics=[d.model_dump() for d in diagnostics], samples=samples,
                provider=agent.provider_label(),
                **({'credits': credits} if (credits := dispatch.credits_for_current_job()) is not None else {}))


async def edit_model(request: ModelEditRequest, job_id: str, progress=lambda message: None):
    catalog = catalog_snapshot(request, DATA)
    prompt = edit_prompt(request, catalog)
    cache: dict = {}
    for attempt in range(2):
        progress('Planning the edit' if attempt == 0 else 'Revising the edit from diagnostics')
        data = await agent.structured_generation(prompt, EditPlan.model_json_schema(), f'{job_id}-edit{attempt}', task='edit-plan')
        try:
            plan = structured.parse(EditPlan, data)
            if plan.unsupported:
                raise Unsupported(plan.unsupported)
            check_limits(plan)
            generated, revised = await realize(plan, request.project, job_id, progress, cache)
            edited, changes = apply_operations(request.project, plan, catalog, generated, revised)
        except Unsupported:
            raise
        except Exception as exc:
            if attempt:
                raise ValueError('The edit could not be applied: ' + str(exc)[-1500:]) from exc
            prompt += '\nPrevious plan:\n' + json.dumps(data) + '\nIt could not be applied. Fix this and return a new plan:\n' + str(exc)[-4000:]
            continue
        try:
            validate_simulation(edited)
            samples = None
            if request.verify:
                progress('Checking the edited model in OpenModelica')
                samples = (await simulate(edited, f'{job_id}trial{attempt}'))['samples']
            return proposal(edited, request.project, plan, changes, generated, request.verify, [], samples)
        except SimulationFailure as exc:
            if attempt == 0:
                prompt += ('\nPrevious plan:\n' + json.dumps(data) + '\nThe edited model failed its check. '
                           'Fix these diagnostics and return a new plan:\n' + str(exc)[-6000:])
                continue
            return proposal(edited, request.project, plan, changes, generated, False, exc.diagnostics, None)
