import asyncio
import json
from pathlib import Path
import zipfile
from .agent import structured_generation
from .models import Project
from .modelica import component_source
from .engine import ROOT, IMAGE
from .runtime import docker_argv

EXPORT_SCHEMA = {'type':'object','additionalProperties':False,'properties':{'header':{'type':'string'},'source':{'type':'string'},'notes':{'type':'string'}},'required':['header','source','notes']}
EXPORTS = ROOT/'projects'/'exports'
EXPORTS.mkdir(parents=True,exist_ok=True)

async def export_controller(project:Project,block_id:str,job_id:str):
    block = next((b for b in project.blocks if b.id==block_id),None)
    if not block or not block.definition.controller:
        raise ValueError('Choose a component marked as a controller.')
    boundary = {'projectName':project.name,'projectRevision':project.revision,'controller':block.model_dump(),'modelica':component_source(block.definition,'Controller'),'connections':[w.model_dump() for w in project.wires if block_id in (w.source,w.target)],'target':{'language':'C11','numeric':'double','interface':'initialization and one synchronous step; host supplies time and sample period'}}
    prompt = '''Generate a self-contained C11 controller implementation from the supplied equations and parameter values. Return only JSON. Do not call tools or read files. Trust the requested behavior. Provide a header named gradara_controller.h and source named gradara_controller.c. The source must include "gradara_controller.h". Use structs for parameters, state, inputs and outputs, plus gradara_controller_init and gradara_controller_step. Initialize all state and expose parameters with documented defaults. Expose sample time explicitly and define whether time is an input. Keep consistent sample/update ordering. For continuous states, choose and document a discrete approximation. C source must compile with gcc -std=c11 -Wall -Wextra -Werror. Avoid unused parameters or cast to void. Use only math.h, stdint.h, stdbool.h, stddef.h, and the local header. No allocation, I/O, external files, or platform dependencies. Header uses an include guard and extern "C" guards for C++. Notes should include concise integration instructions, defaults and timing/discretization choices. Do not generate a main function.\nController package:\n'''+json.dumps(boundary)
    folder = EXPORTS/job_id
    folder.mkdir(parents=True,exist_ok=True)
    for attempt in range(2):
        data = await structured_generation(prompt,EXPORT_SCHEMA,f'export-{job_id}-{attempt}')
        if len(data['source'])>64000 or len(data['header'])>24000: raise ValueError('The generated controller is too large for this demo.')
        (folder/'gradara_controller.c').write_text(data['source'])
        (folder/'gradara_controller.h').write_text(data['header'])
        process = await asyncio.create_subprocess_exec(*docker_argv(),'run','--rm','--network=none','--cap-drop=ALL','--security-opt=no-new-privileges','--memory=512m','--pids-limit=64','-v',f'{folder}:/work','-w','/work',IMAGE,'gcc','-std=c11','-Wall','-Wextra','-Werror','-c','gradara_controller.c','-o','gradara_controller.o',stdout=asyncio.subprocess.PIPE,stderr=asyncio.subprocess.STDOUT)
        output,_=await asyncio.wait_for(process.communicate(),45)
        if process.returncode==0: break
        if attempt: raise ValueError('The generated C needs a revision: '+output.decode(errors='replace')[-3000:])
        prompt+='\nPrevious candidate:\n'+json.dumps(data)+'\nRepair this compiler output:\n'+output.decode(errors='replace')[-4000:]
    (folder/'controller-package.json').write_text(json.dumps(boundary,indent=2))
    (folder/'README.md').write_text('# Gradara controller export\n\n'+data['notes']+'\n\nGenerated from project revision '+str(project.revision)+'. Compiled as C11. Behavioral equivalence and target hardware execution have not been tested.\n')
    archive=folder/'gradara-controller.zip'
    with zipfile.ZipFile(archive,'w',zipfile.ZIP_DEFLATED) as z:
        for filename in ['gradara_controller.c','gradara_controller.h','controller-package.json','README.md']:
            z.write(folder/filename,filename)
    return {'id':job_id,'header':data['header'],'source':data['source'],'notes':data['notes'],'compiled':True}
