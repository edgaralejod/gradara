# SPDX-License-Identifier: Apache-2.0
"""Plan dependencies, await checked components, then assemble and simulate a draft."""
import json
from pydantic import BaseModel, ConfigDict, Field
from . import agent
from .component_library import list_components
from .engine import ROOT, simulate
from .models import BlockType, Definition, Project


class Strict(BaseModel):
    model_config = ConfigDict(extra='forbid')


class ModelGenerateRequest(Strict):
    prompt: str = Field(min_length=3, max_length=8000)
    # Snapshot of the actual UI catalog, rather than a second hand-maintained library.
    catalog: list[Definition] = Field(min_length=1, max_length=300)


class MissingBlock(Strict):
    id: str = Field(pattern=r'^[A-Za-z][A-Za-z0-9_]*$', max_length=60)
    blockType: BlockType
    prompt: str = Field(min_length=3, max_length=4000)


class Plan(Strict):
    name: str = Field(min_length=1, max_length=120)
    description: str = Field(max_length=1200)
    assumptions: list[str] = Field(max_length=12)
    unsupported: str = Field(max_length=1000)
    reuse: list[str] = Field(max_length=80)
    missing: list[MissingBlock] = Field(max_length=4)


class ParameterValue(Strict):
    id: str
    value: float = Field(allow_inf_nan=False)


class Instance(Strict):
    id: str = Field(pattern=r'^[A-Za-z][A-Za-z0-9_]*$', max_length=60)
    libraryId: str
    name: str = Field(min_length=1, max_length=90)
    column: int = Field(ge=0, le=16)
    row: int = Field(ge=0, le=16)
    parameters: list[ParameterValue] = Field(max_length=30)


class Connection(Strict):
    source: str
    sourcePort: str
    target: str
    targetPort: str


class Assembly(Strict):
    duration: float = Field(gt=0, le=60, allow_inf_nan=False)
    instances: list[Instance] = Field(min_length=1, max_length=80)
    connections: list[Connection] = Field(max_length=240)


def catalog_snapshot(request, directory):
    catalog = {}
    for definition in request.catalog:
        key = 'builtin:' + definition.kind
        if definition.generated or key in catalog:
            raise ValueError('Built-in catalog must have unique non-generated kinds.')
        if definition.kind not in {'mux', 'demux', 'subsystem'}:
            catalog[key] = definition.model_copy(deep=True)
    for entry in list_components(directory):
        catalog[entry['id']] = Definition.model_validate(entry['definition'])
    return catalog


def describe(catalog):
    return json.dumps({key: definition.model_dump(exclude_none=True) for key, definition in catalog.items()})


def assemble(plan: Plan, assembly: Assembly, catalog: dict[str, Definition]) -> Project:
    blocks, names, cells = [], set(), set()
    for instance in assembly.instances:
        if instance.libraryId not in catalog:
            raise ValueError(f'Unknown library reference: {instance.libraryId}')
        cell = (instance.column, instance.row)
        if cell in cells:
            raise ValueError('Each block needs its own layout cell.')
        cells.add(cell)
        definition = catalog[instance.libraryId].model_copy(deep=True)
        name, suffix = instance.name, 1
        while name in names:
            name = f'{instance.name}{suffix}'
            suffix += 1
        names.add(name)
        definition.name = name
        parameters = {p.id: p for p in definition.parameters}
        seen = set()
        for value in instance.parameters:
            if value.id not in parameters or value.id in seen:
                raise ValueError(f'Unknown or repeated parameter {instance.id}.{value.id}')
            seen.add(value.id)
            parameters[value.id].value = value.value
        # Revalidate parameter ranges; assignment itself does not run validators.
        definition = Definition.model_validate(definition.model_dump())
        blocks.append(dict(id='b_'+instance.id, definition=definition,
                           position=dict(x=instance.column*320, y=instance.row*224)))
    wires, pairs = [], set()
    for index, connection in enumerate(assembly.connections):
        pair = frozenset([(connection.source, connection.sourcePort), (connection.target, connection.targetPort)])
        if len(pair) != 2 or pair in pairs:
            raise ValueError('Duplicate or self connection.')
        pairs.add(pair)
        wires.append(dict(id=f'w_{index}', source='b_'+connection.source, sourceHandle=connection.sourcePort,
                          target='b_'+connection.target, targetHandle=connection.targetPort))
    return Project(name=plan.name, description=plan.description, duration=assembly.duration,
                   blocks=blocks, wires=wires, revision=0)


async def generate_model(request: ModelGenerateRequest, job_id: str, progress=lambda message: None):
    catalog = catalog_snapshot(request, ROOT/'projects')
    progress('Inspecting the built-in and AI libraries')
    instructions = '''You plan complete runnable models for Gradara. Return only schema JSON; do not use tools.
Reuse catalog components whenever their behavior fits, including parameter variations. Never recreate a resistor, gain, source, sensor, etc. already available. Missing blocks are only genuinely absent behaviors; at most four. Give each missing block an alias id and a self-contained request for the existing typed component creator. No whole-circuit mega-block to bypass assembly. Supported physics: electrical, rotational mechanical, thermal, scalar signals and couplings. Unsupported domains (including translational mechanics, hydraulic connectors, vector signals) must be explained in unsupported, not silently approximated. Otherwise unsupported is empty. Plan a self-contained simulation with sources, loads, references/grounds, and sensors for quantities requested. Assumptions must be concise and explicit. reuse lists exact library IDs. Missing definitions will be generated and checked BEFORE assembly.
User request:\n'''+request.prompt+'\nAvailable catalog:\n'+describe(catalog)
    plan = Plan.model_validate(await agent.structured_generation(instructions, Plan.model_json_schema(), job_id+'-plan'))
    if plan.unsupported:
        raise ValueError(plan.unsupported)
    if any(key not in catalog for key in plan.reuse):
        raise ValueError('The plan selected a component that is not in the library. Please retry.')
    if len({item.id for item in plan.missing}) != len(plan.missing):
        raise ValueError('Missing component aliases must be unique.')
    generated = []
    for index, item in enumerate(plan.missing):
        progress(f'Creating missing block {index+1}/{len(plan.missing)}: {item.id}')
        result = await agent.generate_component(item.prompt, None, f'{job_id}-block{index}', item.blockType)
        catalog['new:'+item.id] = Definition.model_validate(result['definition'])
        generated.append(dict(id=item.id, libraryId=result['libraryId'], name=result['definition']['name']))
    available = catalog
    prompt = '''Assemble a complete runnable Gradara model using ONLY these exact library IDs and port/parameter IDs. Return schema JSON, no tools. Never change definitions or invent equations here. Parameters array contains only overrides (empty allowed). Unique instance IDs; short human names. One block per grid cell. Arrange left-to-right signal flow, shared horizontal rows, return paths/grounds below. A source may connect to multiple inputs; physical terminals may branch. Signal connections must run from output to input. Include physical reference/ground and all required scalar inputs. Add available sensors to expose requested physical measurements. Choose a useful duration <=60 s, especially short for switching circuits.\nUser request:\n'''+request.prompt+'\nPlan:\n'+plan.model_dump_json()+'\nAvailable definitions (complete model will be simulated):\n'+describe(available)
    for attempt in range(2):
        progress('Assembling connections and layout' if attempt == 0 else 'Repairing the model from simulation diagnostics')
        data = await agent.structured_generation(prompt, Assembly.model_json_schema(), f'{job_id}-assembly{attempt}')
        try:
            project = assemble(plan, Assembly.model_validate(data), available)
            progress('Checking the complete model in OpenModelica')
            result = await simulate(project, f'{job_id}trial{attempt}')
            document = project.model_dump(exclude_none=True)
            # Absent waypoints enable the normal automatic router on insertion.
            for wire in document['wires']:
                wire.pop('waypoints', None)
            used = list(dict.fromkeys(instance['libraryId'] for instance in data['instances']))
            return dict(project=document, assumptions=plan.assumptions, generated=generated,
                        reused=[catalog[key].name for key in used if not key.startswith('new:')],
                        checked=True, samples=result['samples'], provider='Codex')
        except Exception as exc:
            if attempt:
                raise RuntimeError('Model assembly needs a revision: '+str(exc)) from exc
            prompt += '\nPrevious assembly:\n'+json.dumps(data)+'\nFix these validation/simulation diagnostics without changing component definitions:\n'+str(exc)[-6000:]
