import asyncio
import csv
import json
import math
from pathlib import Path
import shutil
import time
from .models import Project, Definition
from .modelica import emit_project, component_source, semantic_hash, project_key
from .runtime import IMAGE, LEGACY_IMAGE, docker_argv

ROOT = Path(__file__).resolve().parent.parent
RUNS = ROOT/'projects'/'runs'
RUNS.mkdir(parents=True, exist_ok=True)
SEMAPHORE = asyncio.Semaphore(2)

async def _image_present(tag: str) -> bool:
    try:
        proc = await asyncio.create_subprocess_exec(
            *docker_argv(), 'image', 'inspect', tag,
            stdout=asyncio.subprocess.DEVNULL, stderr=asyncio.subprocess.DEVNULL,
        )
        return await asyncio.wait_for(proc.wait(), 6) == 0
    except (OSError, asyncio.TimeoutError):
        return False

async def engine_available():
    if await _image_present(IMAGE):
        return True
    if not await _image_present(LEGACY_IMAGE):
        return False
    try:
        proc = await asyncio.create_subprocess_exec(
            *docker_argv(), 'tag', LEGACY_IMAGE, IMAGE,
            stdout=asyncio.subprocess.DEVNULL, stderr=asyncio.subprocess.DEVNULL,
        )
        return await asyncio.wait_for(proc.wait(), 6) == 0
    except (OSError, asyncio.TimeoutError):
        return False

async def execute(folder: Path, config: dict, name: str):
    folder.mkdir(parents=True, exist_ok=True)
    (folder/'request.json').write_text(json.dumps(config))
    shutil.copyfile(ROOT/'server'/'engine_runner.py', folder/'runner.py')
    command = [*docker_argv(), 'run', '--rm', '--name', name, '--network=none', '--cap-drop=ALL', '--security-opt=no-new-privileges', '--pids-limit=256', '--memory=2g', '--cpus=2', '-v', f'{folder}:/work', '-w', '/work', IMAGE, 'python3', '/work/runner.py']
    async with SEMAPHORE:
        process = await asyncio.create_subprocess_exec(*command, stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.STDOUT)
        try:
            output, _ = await asyncio.wait_for(process.communicate(), 120)
        except (asyncio.CancelledError, asyncio.TimeoutError):
            cleanup = await asyncio.create_subprocess_exec(*docker_argv(), 'rm', '-f', name, stdout=asyncio.subprocess.DEVNULL, stderr=asyncio.subprocess.DEVNULL)
            await cleanup.wait()
            if process.returncode is None:
                process.kill()
            await process.wait()
            raise
    (folder/'engine.log').write_bytes(output)
    report = folder/'engine.json'
    if not report.exists():
        raise RuntimeError(output.decode(errors='replace')[-5000:] or 'The numerical engine could not start.')
    result = json.loads(report.read_text())
    if result.get('error'):
        raise RuntimeError(result['error'])
    return result

async def simulate(project: Project, job_id: str):
    started = time.monotonic()
    folder = RUNS/job_id
    folder.mkdir(parents=True, exist_ok=True)
    (folder/'model.mo').write_text(emit_project(project))
    (folder/'project.json').write_text(project.model_dump_json(indent=2))
    report = await execute(folder, {'duration':project.duration}, f'gradara-run-{job_id}')
    csv_file = folder/'simulation_res.csv'
    with csv_file.open() as file:
        reader = csv.DictReader(file)
        rows = list(reader)
    if not rows:
        raise RuntimeError('The engine returned no simulation samples.')
    outputs = []
    for block in project.blocks:
        definition = block.definition
        candidates = [(p.id, p.name, p.unit) for p in definition.ports if p.direction == 'output']
        if definition.kind == 'motor': candidates += [('i','Armature current','A'),('w','Motor speed','rad/s')]
        if definition.kind == 'inertia': candidates += [('w','Shaft speed','rad/s')]
        if definition.kind == 'step': candidates = [('y', 'Target speed', definition.ports[0].unit or 'rad/s')]
        if definition.controller: candidates = [(p.id, f'{definition.name} · {p.name}', 'V') for p in definition.ports if p.direction=='output']
        for variable,label,unit in candidates:
            key = f'{block.id}.{variable}'
            if key in rows[0]:
                values = [float(row[key]) for row in rows]
                if not all(math.isfinite(value) for value in values):
                    raise RuntimeError(f'{label} contains non-finite results.')
                outputs.append({'key':key,'name':label,'unit':unit,'blockId':block.id,'values':values})
    sample_indices = list(range(0,len(rows),max(1,len(rows)//1800)))
    sample_indices += [len(rows)-1]
    # Preserve a dense tail for the scope's last-50-ms view, alongside the overview.
    tail = [i for i,row in enumerate(rows) if float(row['time']) >= project.duration-0.05]
    sample_indices += tail[::max(1,len(tail)//400)]
    for series in outputs:
        values=series['values']
        sample_indices += [values.index(min(values)),values.index(max(values))]
    sample_indices=sorted(set(sample_indices))
    for series in outputs:
        series['values']=[series['values'][i] for i in sample_indices]
    result = {'id':job_id,'engine':'OpenModelica 1.27.0','projectKey':project_key(project),'modelHash':semantic_hash(project),'projectRevision':project.revision,'snapshot':project.model_dump(exclude_none=True),'duration':project.duration,'elapsed':round(time.monotonic()-started,2),'time':[float(rows[i]['time']) for i in sample_indices],'series':outputs,'diagnostics':report.get('diagnostics',''),'samples':len(rows)}
    (folder/'result.json').write_text(json.dumps(result, allow_nan=False))
    return result

async def check_component(definition: Definition, job_id: str):
    folder = RUNS/f'check-{job_id}'
    folder.mkdir(parents=True, exist_ok=True)
    (folder/'model.mo').write_text('within;\npackage Gradara\n'+component_source(definition,'Component')+'\nend Gradara;')
    return await execute(folder, {'checkOnly':True}, f'gradara-check-{job_id}')
