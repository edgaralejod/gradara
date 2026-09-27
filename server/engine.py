import csv
import json
import math
from pathlib import Path
import time
from . import msl
from .hierarchy import all_blocks, instances
from .models import Project, Definition
from .modelica import emit_project, component_source, semantic_hash, project_key
from .runtime import IMAGE, LEGACY_IMAGE
from .diagnostics import (Diagnostic, EngineUnavailable, SimulationFailure, explain_failure, failure_diagnostics,
                          validate_simulation, warning_diagnostics)
from .paths import ROOT, RUNS
from .safety import UnsafeDefinition, check_definition
from . import engines

__all__ = ['ROOT', 'RUNS', 'IMAGE', 'LEGACY_IMAGE', 'engine_available', 'execute', 'simulate', 'check_component']


async def engine_available():
    return await engines.available()


async def execute(folder: Path, config: dict, name: str):
    try:
        result = await engines.execute(folder, config, name)
    except engines.EngineError as exc:
        raise EngineUnavailable(str(exc)) from exc
    if result.get('error'):
        raise RuntimeError(result['error'])
    return result


def run_failure(message: str, block_id: str | None = None) -> SimulationFailure:
    return SimulationFailure(message, [Diagnostic(source='runtime', message=message, blockIds=[block_id] if block_id else [])])


async def simulate(project: Project, job_id: str):
    validate_simulation(project)
    for block in all_blocks(project):
        try:
            check_definition(block.definition, block.definition.name)
        except UnsafeDefinition as exc:
            raise SimulationFailure(str(exc), [Diagnostic(source='safety', message=str(exc), blockIds=[block.id],
                                                          hint='Open the block dialog and remove that construct from its equations.')]) from exc
    folder = RUNS/job_id
    folder.mkdir(parents=True, exist_ok=True)
    try:
        return await run(project, job_id, folder)
    except SimulationFailure as exc:
        # Kept beside model.mo so a later diagnosis request can cite this exact run.
        (folder/'diagnostics.json').write_text(json.dumps({'error': str(exc), 'diagnostics': [d.model_dump() for d in exc.diagnostics]}))
        raise


async def run(project: Project, job_id: str, folder: Path):
    started = time.monotonic()
    (folder/'model.mo').write_text(emit_project(project))
    (folder/'project.json').write_text(project.model_dump_json(indent=2))
    try:
        report = await execute(folder, {'duration':project.duration}, f'gradara-run-{job_id}')
    except EngineUnavailable as exc:
        raise SimulationFailure(str(exc), [Diagnostic(source='engine', message=str(exc).splitlines()[0][:1000] if str(exc) else 'The numerical engine is unavailable.',
                                                      detail=str(exc), hint='Open Settings → Engine to check the simulation engine.')]) from exc
    except RuntimeError as exc:
        raise SimulationFailure(explain_failure(project, str(exc)), failure_diagnostics(project, str(exc))) from exc
    csv_file = folder/'simulation_res.csv'
    with csv_file.open() as file:
        reader = csv.DictReader(file)
        rows = list(reader)
    if not rows:
        raise run_failure('The engine returned no simulation samples.')
    end_time = float(rows[-1]['time'])
    if not math.isfinite(end_time) or end_time < project.duration - max(1e-8, project.duration * 1e-8):
        raise run_failure(f'Simulation stopped at {end_time:g} s before the requested {project.duration:g} s.')
    # DASSL can emit one output-grid row just beyond stopTime. Keep the plot
    # and final values inside the requested interval; retain the raw CSV.
    rows = [row for row in rows if float(row['time']) <= project.duration + max(1e-12, project.duration * 1e-12)]
    outputs = []
    for prefix, label, block, owner in instances(project):
        definition = block.definition
        candidates = [(p.id, p.name, p.unit) for p in definition.ports if p.direction == 'output' or (definition.kind in {'scope', 'display'} and p.direction == 'input')]
        if definition.kind == 'motor': candidates += [('i','Armature current','A'),('w','Motor speed','rad/s')]
        if definition.kind == 'inertia': candidates += [('w','Shaft speed','rad/s')]
        for variable,label_,unit in candidates:
            key = f'{prefix}{block.id}.{msl.connector(definition, variable)}'
            if key in rows[0]:
                values = [float(row[key]) for row in rows]
                if not all(math.isfinite(value) for value in values):
                    raise run_failure(f'{label}{definition.name}.{label_} contains non-finite results.', owner)
                outputs.append({'key':key,'name':f'{label}{definition.name}.{label_}', 'unit':unit,'blockId':owner,'values':values})
    from .logging_signals import logged_signals
    for log in logged_signals(project):
        key = log['key']
        if key not in rows[0]:
            raise run_failure(f"Logged net {log['name']} is missing from the solver output.", log.get('blockId'))
        values = [float(row[key]) for row in rows]
        if not all(math.isfinite(v) for v in values):
            raise run_failure(f"Logged net {log['name']} contains non-finite values.", log.get('blockId'))
        outputs.append({k:v for k,v in log.items() if k != 'expression'} | {'values':values})
    sample_indices = list(range(0,len(rows),max(1,len(rows)//1800)))
    sample_indices += [len(rows)-1]
    # Preserve switching event pairs and a dense tail for short-time ripple views.
    for i in range(1,len(rows)):
        if abs(float(rows[i]['time'])-float(rows[i-1]['time'])) <= 1e-12:
            sample_indices.extend([i-1,i])
    tail_window = min(0.05, project.duration * 0.1)
    tail = [i for i,row in enumerate(rows) if float(row['time']) >= project.duration-tail_window]
    sample_indices += tail[::max(1,len(tail)//400)]
    for series in outputs:
        values=series['values']
        sample_indices += [values.index(min(values)),values.index(max(values))]
    sample_indices=sorted(set(sample_indices))
    for series in outputs:
        series['values']=[series['values'][i] for i in sample_indices]
    result = {'id':job_id,'engine':report.get('engine','OpenModelica 1.27.0'),'projectKey':project_key(project),'modelHash':semantic_hash(project),'projectRevision':project.revision,'snapshot':project.model_dump(exclude_none=True),'duration':project.duration,'elapsed':round(time.monotonic()-started,2),'time':[float(rows[i]['time']) for i in sample_indices],'series':outputs,'diagnostics':report.get('diagnostics',''),'problems':[d.model_dump() for d in warning_diagnostics(project, report.get('diagnostics',''))],'samples':len(rows)}
    (folder/'result.json').write_text(json.dumps(result, allow_nan=False))
    return result

async def check_component(definition: Definition, job_id: str):
    check_definition(definition)
    folder = RUNS/f'check-{job_id}'
    folder.mkdir(parents=True, exist_ok=True)
    (folder/'model.mo').write_text('within;\npackage Gradara\n'+component_source(definition,'Component')+'\nend Gradara;')
    return await execute(folder, {'checkOnly':True}, f'gradara-check-{job_id}')
