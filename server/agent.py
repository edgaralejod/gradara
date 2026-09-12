"""Local Codex adapter. Generation returns data, never edits the workspace directly."""
import asyncio
import json
import os
from pathlib import Path
import shutil
from .models import Definition
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

async def generate_component(prompt: str, existing: Definition | None, job_id: str):
    instructions = '''You create a component for Gradara, a graphical Modelica simulation workbench. Return only the requested JSON. Do not call tools, read files, or execute commands. The complete task is below.
Produce a compact useful signal component. Trust the user's intended behavior. Use valid Modelica 3.6 equation syntax. Named scalar Real input/output ports are declared by our wrapper, as are Real parameters. Declarations contain only internal Real/Integer/Boolean variables and initial values; equations contain only equation clauses, including when sample(...) if needed. Do not duplicate ports/parameters in declarations. Do not include model, block, end-block, external, annotation, function, import, strings, or file operations. IDs must start with a letter, use only letters/digits/underscores, and be unique. Symbol <= 12 characters. No vector ports. Use unit descriptions in parameter metadata only. Use samplePeriod parameter for sampled controllers. For state, declare initial values with start=..., fixed=true. Output algebraic equations or well-formed sampled assignments; do not use imperative := assignments in equation sections. When revising, preserve port IDs and parameter IDs unless necessary. Existing parameter values should remain unless asked otherwise. If a request involves electrical/mechanical hardware, provide its signal input/output control or behavioral equation component. Description should explain behavior in one sentence.
'''
    if existing:
        instructions += '\nExisting component to revise:\n'+existing.model_dump_json()
    instructions += '\nUser request:\n'+prompt
    errors = []
    for attempt in range(2):
        data = await structured_generation(instructions, BLOCK_SCHEMA, f'{job_id}-{attempt}')
        try:
            definition = Definition.model_validate({**data,'generated':True})
            await check_component(definition, f'{job_id}-{attempt}')
            return {'definition':definition.model_dump(exclude_none=True),'provider':'Codex','checked':True}
        except Exception as exc:
            errors.append(str(exc))
            instructions += '\nYour prior candidate:\n'+json.dumps(data)+'\nCorrect this integration error and return a corrected component:\n'+str(exc)[-4000:]
    raise RuntimeError('The generated component needs a revision: '+errors[-1])
