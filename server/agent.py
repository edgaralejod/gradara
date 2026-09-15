"""Local Codex adapter. Generation returns data, never edits the workspace directly."""
import copy
import asyncio
import json
import os
from pathlib import Path
import shutil
from .models import BlockType, Definition
from .engine import ROOT, check_component

AGENT_DIR = ROOT/'projects'/'agent'
AGENT_DIR.mkdir(parents=True, exist_ok=True)
CODEX = os.environ.get('GRADARA_CODEX_BIN') or os.environ.get('FLUX_CODEX_BIN') or shutil.which('codex') or '/Applications/ChatGPT.app/Contents/Resources/codex'

PARAM_SCHEMA = {'type':'object','additionalProperties':False,'properties':{'id':{'type':'string'},'name':{'type':'string'},'value':{'type':'number'},'unit':{'type':'string'}},'required':['id','name','value','unit']}
PORT_SCHEMA = {'type':'object','additionalProperties':False,'properties':{'id':{'type':'string'},'name':{'type':'string'},'direction':{'type':'string','enum':['input','output']},'domain':{'type':'string','enum':['signal']}},'required':['id','name','direction','domain']}
BLOCK_SCHEMA = {'type':'object','additionalProperties':False,'properties':{'kind':{'type':'string'},'name':{'type':'string'},'description':{'type':'string'},'domain':{'type':'string','enum':['signal']},'symbol':{'type':'string'},'ports':{'type':'array','items':PORT_SCHEMA},'parameters':{'type':'array','items':PARAM_SCHEMA},'declarations':{'type':'string'},'equations':{'type':'string'},'controller':{'type':'boolean'}},'required':['kind','name','description','domain','symbol','ports','parameters','declarations','equations','controller']}

async def structured_generation(prompt: str, schema: dict, job_id: str):
    folder = AGENT_DIR/job_id
    folder.mkdir(parents=True, exist_ok=True)
    schema_path = folder/'schema.json'
    result_path = folder/'response.json'
    schema_path.write_text(json.dumps(schema))
    (folder/'prompt.txt').write_text(prompt)
    command = [CODEX,'exec','--ephemeral','--ignore-user-config','--skip-git-repo-check','--sandbox','read-only','-c','features.shell_tool=false','--output-schema',str(schema_path),'--output-last-message',str(result_path),'--color','never','-']
    env = {k:v for k,v in os.environ.items() if not k.startswith('CODEX_') or k=='CODEX_HOME'}
    process = await asyncio.create_subprocess_exec(*command,cwd=folder,env=env,stdin=asyncio.subprocess.PIPE,stdout=asyncio.subprocess.PIPE,stderr=asyncio.subprocess.PIPE,start_new_session=True)
    try:
        stdout, stderr = await asyncio.wait_for(process.communicate(prompt.encode()), 180)
    except (asyncio.CancelledError, asyncio.TimeoutError):
        import signal
        os.killpg(process.pid, signal.SIGTERM)
        await process.wait()
        raise
    (folder/'agent.log').write_bytes(stderr)
    if process.returncode != 0 or not result_path.exists():
        raise RuntimeError('Component generation did not finish. '+stderr.decode(errors='replace')[-1200:])
    return json.loads(result_path.read_text())

def infer_block_type(definition: Definition | None) -> BlockType:
    if definition is None:
        return 'signal'
    domains = {p.domain for p in definition.ports if p.direction == 'physical'}
    return 'multidomain' if len(domains) > 1 else definition.domain


def block_schema(block_type: BlockType) -> dict:
    schema = copy.deepcopy(BLOCK_SCHEMA)
    domains = ['electrical', 'mechanical', 'thermal'] if block_type == 'multidomain' else [block_type]
    schema['properties']['domain']['enum'] = domains
    port = schema['properties']['ports']['items']
    port['properties']['direction']['enum'] = ['input', 'output'] if block_type == 'signal' else ['input', 'output', 'physical']
    port['properties']['domain']['enum'] = list(dict.fromkeys(['signal', *domains]))
    port['properties']['side'] = {'type': 'string', 'enum': ['left', 'right', 'top', 'bottom']}
    port['required'].append('side')
    return schema


TYPE_RULES = {
    'signal': 'Create a scalar signal/control component. All ports are signal input/output ports. Use scalar behavior only; physical hardware requires the user to choose its physical type in the creator.',
    'electrical': 'Create an electrical component with real physical electrical pins, not a signal transfer-function substitute. Include at least one electrical physical port. Signal input/output ports are optional for sensing/control. An ideal two-winding transformer has FOUR physical pins (p1, n1, p2, n2), winding voltage ratio and current balance equations, and no artificial signal input/output winding ports.',
    'mechanical': 'Create a rotational mechanical component with at least one physical shaft flange. Signal input/output ports are optional. Translational mechanics are not supported by this connector type; do not silently reinterpret linear motion as rotation.',
    'thermal': 'Create a thermal component with at least one physical heat port. Signal input/output ports are optional. Express heat balance and temperature relations.',
    'multidomain': 'Create a physical coupling between at least TWO of electrical, rotational mechanical, and thermal domains. Choose the main physical domain for the block domain. Use physical ports for each coupled domain; scalar signal ports are optional.',
}


def validate_generated_type(definition: Definition, block_type: BlockType, existing: Definition | None = None):
    physical = {p.domain for p in definition.ports if p.direction == 'physical'}
    for port in definition.ports:
        if (port.direction == 'physical') == (port.domain == 'signal'):
            raise ValueError('Physical ports must use a physical domain; input/output ports must use signal.')
    if block_type == 'signal':
        if definition.domain != 'signal' or physical:
            raise ValueError('The selected Signal type requires signal input/output ports only.')
    elif block_type == 'multidomain':
        if len(physical) < 2 or definition.domain not in physical:
            raise ValueError('Multidomain requires physical terminals from at least two domains and a matching main domain.')
    elif definition.domain != block_type or physical != {block_type}:
        raise ValueError(f'The selected {block_type} type requires {block_type} physical terminals and block domain; signal-only substitutes are not accepted.')
    if physical and definition.controller:
        raise ValueError('Physical components cannot be marked as signal controllers for C export.')
    if existing:
        ports = {p.id: p for p in definition.ports}
        for port in existing.ports:
            replacement = ports.get(port.id)
            if replacement is None or (replacement.domain, replacement.direction) != (port.domain, port.direction):
                raise ValueError(f'Refinement must preserve terminal {port.id}, its domain, and direction so existing wires remain valid.')


async def generate_component(prompt: str, existing: Definition | None, job_id: str, block_type: BlockType | None = None):
    selected = block_type or infer_block_type(existing)
    if existing and selected != infer_block_type(existing):
        raise ValueError('Refinement cannot change the block type. Create a new component instead.')
    instructions = '''You create a component for Gradara, a graphical Modelica simulation workbench. Return only the requested JSON. Do not call tools, read files, or execute commands. The selected type is a hard contract, not a color or category label.
Use valid Modelica 3.6 equation syntax. Our wrapper declares all ports and Real parameters. Signal input/output ports use RealInput/RealOutput. Physical electrical pins expose .v (V) and flow .i (A, positive INTO the component). Rotational mechanical flanges expose .phi (rad) and flow .tau (N.m, into the component); angular velocity is der(port.phi). Thermal ports expose .T (K) and flow .Q_flow (W, into the component). Write constitutive and conservation equations referencing these connector fields. Never redeclare ports, connectors, or parameters, and never replace physical terminals with scalar signals. Ground/reference connections belong in the surrounding model unless explicitly part of the requested component.
Declarations contain only internal Real/Integer/Boolean variables and initial values. Equations contain equation clauses, including when sample(...) if needed. Do not include model, block, external, annotation, function, import, strings, or file operations. IDs start with a letter, use letters/digits/underscores, and are unique. Use a short human-readable name without an instance suffix. Symbol is compact engineering notation (ideally 1-6 characters, at most 12). Use short port names and choose useful left/right/top/bottom sides; corresponding transformer winding pins should have matching rows on opposite sides. Gradara supplies size, fonts, colors and geometry. No vector ports. Parameter units are metadata only. Use samplePeriod for sampled controllers. Initialize state with start=..., fixed=true; no imperative := in equations. Set controller=false for physical components. When refining preserve every existing port ID, direction and domain, and parameter IDs/values unless asked to change parameters. Describe behavior and material assumptions concisely.
'''
    instructions += '\nSELECTED BLOCK TYPE: '+selected+'\n'+TYPE_RULES[selected]
    if existing:
        instructions += '\nExisting component to revise:\n'+existing.model_dump_json()
    instructions += '\nUser request:\n'+prompt
    errors = []
    for attempt in range(2):
        data = await structured_generation(instructions, block_schema(selected), f'{job_id}-{attempt}')
        try:
            definition = Definition.model_validate({**data,'generated':True})
            validate_generated_type(definition, selected, existing)
            await check_component(definition, f'{job_id}-{attempt}')
            return {'definition':definition.model_dump(exclude_none=True),'provider':'Codex','checked':True,'blockType':selected}
        except Exception as exc:
            errors.append(str(exc))
            instructions += '\nYour prior candidate:\n'+json.dumps(data)+'\nCorrect this integration error while preserving SELECTED BLOCK TYPE '+selected+':\n'+str(exc)[-4000:]
    raise RuntimeError('The generated component needs a revision: '+errors[-1])
