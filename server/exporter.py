import json
import re
import zipfile
from . import agent
from .models import Definition, Project
from .modelica import component_source
from .paths import EXPORTS
from . import engines
from .safety import check_definition

EXPORT_SCHEMA = {'type':'object','additionalProperties':False,'properties':{'header':{'type':'string'},'source':{'type':'string'},'notes':{'type':'string'}},'required':['header','source','notes']}
COMPILE_COMMAND = 'gcc -std=c11 -Wall -Wextra -Werror -c gradara_controller.c'
SAMPLE_PARAMETERS = ('samplePeriod', 'Ts')


def timing(definition: Definition) -> dict:
    """Sampling facts read from the definition, so the prompt does not have to infer them."""
    period = next((p for name in SAMPLE_PARAMETERS for p in definition.parameters if p.id == name), None)
    states = re.findall(r'\bdiscrete\s+Real\s+([A-Za-z_]\w*)', definition.declarations or '')
    return {'samplePeriod': {'parameter': period.id, 'value': period.value, 'unit': period.unit or 's'} if period else None,
            'discreteStates': states,
            'sampled': 'sample(' in definition.equations}

async def export_controller(project:Project,block_id:str,job_id:str):
    block = next((b for b in project.blocks if b.id==block_id),None)
    if not block or not block.definition.controller:
        raise ValueError('Choose a component marked as a controller.')
    check_definition(block.definition)
    boundary = {'projectName':project.name,'projectRevision':project.revision,'controller':block.model_dump(),'modelica':component_source(block.definition,'Controller'),'connections':[w.model_dump() for w in project.wires if block_id in (w.source,w.target)],'target':{'language':'C11','numeric':'double','interface':'initialization and one synchronous step; host supplies time and sample period',**timing(block.definition)}}
    prompt = '''Generate a self-contained C11 controller implementation from the supplied equations and parameter values. Return only JSON. Do not call tools or read files. Trust the requested behavior. Provide a header named gradara_controller.h and source named gradara_controller.c. The source must include "gradara_controller.h". Use structs for parameters, state, inputs and outputs, plus gradara_controller_init and gradara_controller_step. Initialize all state and expose parameters with documented defaults. Expose sample time explicitly and define whether time is an input. Keep consistent sample/update ordering. For continuous states, choose and document a discrete approximation. C source must compile with gcc -std=c11 -Wall -Wextra -Werror. Avoid unused parameters or cast to void. Use only math.h, stdint.h, stdbool.h, stddef.h, and the local header. No allocation, I/O, external files, or platform dependencies. Header uses an include guard and extern "C" guards for C++. Notes should include concise integration instructions, defaults and timing/discretization choices. Do not generate a main function.\nController package:\n'''+json.dumps(boundary)
    folder = EXPORTS/job_id
    folder.mkdir(parents=True,exist_ok=True)
    for attempt in range(2):
        data = await agent.structured_generation(prompt,EXPORT_SCHEMA,f'export-{job_id}-{attempt}',task='export')
        if len(data['source'])>64000 or len(data['header'])>24000: raise ValueError('The generated controller is too large for this demo.')
        (folder/'gradara_controller.c').write_text(data['source'])
        (folder/'gradara_controller.h').write_text(data['header'])
        returncode,output = await engines.compile_c(folder,'gradara_controller.c')
        if returncode==0: break
        if attempt: raise ValueError('The generated C needs a revision: '+output[-3000:])
        prompt+='\nPrevious candidate:\n'+json.dumps(data)+'\nRepair this compiler output:\n'+output[-4000:]
    (folder/'controller-package.json').write_text(json.dumps(boundary,indent=2))
    (folder/'README.md').write_text('# Gradara controller export\n\n'+data['notes']+'\n\nGenerated from project revision '+str(project.revision)+'. Compiled as C11. Behavioral equivalence and target hardware execution have not been tested.\n')
    archive=folder/'gradara-controller.zip'
    with zipfile.ZipFile(archive,'w',zipfile.ZIP_DEFLATED) as z:
        for filename in ['gradara_controller.c','gradara_controller.h','controller-package.json','README.md']:
            z.write(folder/filename,filename)
    return {'id':job_id,'blockId':block_id,'header':data['header'],'source':data['source'],'notes':data['notes'],'compiled':True,'compiler':COMPILE_COMMAND}
