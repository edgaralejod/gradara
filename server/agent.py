"""AI component authoring. Generation returns data, never edits the workspace directly."""
import copy
import json
from .block_style import house_style
from .models import BlockType, Definition
from .engine import check_component
from .component_library import save_component
from .paths import DATA
from .llm import dispatch

PARAM_SCHEMA = {'type':'object','additionalProperties':False,'properties':{'id':{'type':'string'},'name':{'type':'string'},'value':{'type':'number'},'unit':{'type':'string'}},'required':['id','name','value','unit']}
PORT_SCHEMA = {'type':'object','additionalProperties':False,'properties':{'id':{'type':'string'},'name':{'type':'string'},'direction':{'type':'string','enum':['input','output']},'domain':{'type':'string','enum':['signal']}},'required':['id','name','direction','domain']}
BLOCK_SCHEMA = {'type':'object','additionalProperties':False,'properties':{'kind':{'type':'string'},'name':{'type':'string'},'description':{'type':'string'},'domain':{'type':'string','enum':['signal']},'symbol':{'type':'string'},'ports':{'type':'array','items':PORT_SCHEMA},'parameters':{'type':'array','items':PARAM_SCHEMA},'declarations':{'type':'string'},'equations':{'type':'string'},'controller':{'type':'boolean'}},'required':['kind','name','description','domain','symbol','ports','parameters','declarations','equations','controller']}

async def structured_generation(prompt: str, schema: dict, job_id: str, task: str = 'component') -> dict:
    """Route one schema-constrained generation to the configured AI provider."""
    return await dispatch.generate(prompt, schema, job_id, task=task)


def provider_label() -> str:
    from .settings import ai_provider
    return dispatch.LABELS.get(ai_provider(), 'AI')

def infer_block_type(definition: Definition | None) -> BlockType:
    if definition is None:
        return 'signal'
    domains = {p.domain for p in definition.ports if p.direction == 'physical'}
    if len(domains) > 1:
        return 'multidomain'
    return {'boolean': 'signal', 'threePhase': 'electrical'}.get(definition.domain, definition.domain)


def block_schema(block_type: BlockType) -> dict:
    schema = copy.deepcopy(BLOCK_SCHEMA)
    domains = ['electrical', 'mechanical', 'translational', 'thermal', 'magnetic'] if block_type == 'multidomain' else [block_type]
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
    'mechanical': 'Create a rotational mechanical component with at least one physical shaft flange. Signal input/output ports are optional. Linear motion belongs to the translational type; do not reinterpret it as rotation.',
    'translational': 'Create a translational mechanical component with at least one physical linear flange (.s position in m, flow .f force in N, positive into the component). Signal input/output ports are optional.',
    'magnetic': 'Create a magnetic flux-tube component with at least one physical magnetic port (.V_m magnetic potential in A, flow .Phi flux in Wb, positive into the component). Signal input/output ports are optional.',
    'thermal': 'Create a thermal component with at least one physical heat port. Signal input/output ports are optional. Express heat balance and temperature relations.',
    'multidomain': 'Create a physical coupling between at least TWO of electrical, rotational mechanical, translational mechanical, thermal, and magnetic domains. Choose the main physical domain for the block domain. Use physical ports for each coupled domain; scalar signal ports are optional.',
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
Use valid Modelica 3.6 equation syntax. Our wrapper declares all ports and Real parameters. Signal input/output ports use RealInput/RealOutput. Physical electrical pins expose .v (V) and flow .i (A, positive INTO the component). Rotational mechanical flanges expose .phi (rad) and flow .tau (N.m, into the component); angular velocity is der(port.phi). Translational flanges expose .s (m) and flow .f (N, into the component). Thermal ports expose .T (K) and flow .Q_flow (W, into the component). Magnetic ports expose .V_m (A) and flow .Phi (Wb, into the component). Write constitutive and conservation equations referencing these connector fields. Never redeclare ports, connectors, or parameters, and never replace physical terminals with scalar signals. Ground/reference connections belong in the surrounding model unless explicitly part of the requested component.
Declarations contain only internal Real/Integer/Boolean variables and initial values. Equations contain equation clauses, including when sample(...) if needed. Do not include model, block, external, annotation, function, import, strings, or file operations. IDs start with a letter, use letters/digits/underscores, and are unique. Use a short human-readable name of 1-3 words without an instance suffix. Symbol is compact engineering notation (ideally 1-6 characters, at most 12), never the full equation or the name. Terminal captions (port names) are 1-5 characters such as ref, meas, u, y, p, n, shaft; longer explanations go in the description. Signal inputs sit on the left and outputs on the right (one measured/feedback input may enter from the bottom); a two-terminal physical element has its terminals on opposite sides; choose useful left/right/top/bottom sides for other physical terminals; corresponding transformer winding pins should have matching rows on opposite sides. Gradara supplies size, fonts, colors and geometry. No vector ports. Parameter units are metadata only. Use samplePeriod for sampled controllers. Initialize state with start=..., fixed=true; no imperative := in equations. Set controller=false for physical components. When refining preserve every existing port ID, direction and domain, and parameter IDs/values unless asked to change parameters. Describe behavior and material assumptions concisely.
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
            definition, problems = house_style(definition, existing)
            if problems:
                raise ValueError('The block does not follow the Gradara block design contract: ' + ' '.join(problems))
            await check_component(definition, f'{job_id}-{attempt}')
            entry = save_component(DATA, definition)
            return {'libraryId':entry['id'], 'definition':definition.model_dump(exclude_none=True),'provider':provider_label(),'checked':True,'blockType':selected}
        except Exception as exc:
            errors.append(str(exc))
            instructions += '\nYour prior candidate:\n'+json.dumps(data)+'\nCorrect this integration error while preserving SELECTED BLOCK TYPE '+selected+':\n'+str(exc)[-4000:]
    raise RuntimeError('The generated component needs a revision: '+errors[-1])
