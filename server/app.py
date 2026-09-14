import asyncio
import json
from pathlib import Path
import shutil
import uuid
from contextlib import asynccontextmanager
from fastapi import FastAPI, HTTPException, Request
from fastapi.responses import FileResponse, PlainTextResponse
from fastapi.middleware.cors import CORSMiddleware
from .models import Project, GenerateRequest, NewModelRequest, SaveModelRequest, CopyModelRequest
from . import workspace
from .modelica import emit_project, project_key, semantic_hash
from .engine import ROOT, RUNS, engine_available, simulate
from .agent import generate_component, CODEX

PROJECT_DIR = ROOT/'projects'
PROJECT_FILE = PROJECT_DIR/'workspace.json'
JOBS: dict[str,dict] = {}
TASKS: dict[str,asyncio.Task] = {}

@asynccontextmanager
async def lifespan(app):
    yield
    for task in TASKS.values():
        if not task.done(): task.cancel()
    await asyncio.gather(*TASKS.values(), return_exceptions=True)

app = FastAPI(title='Gradara local workspace', lifespan=lifespan)
app.add_middleware(CORSMiddleware, allow_origins=['http://localhost:4317','http://127.0.0.1:4317'],allow_methods=['GET','POST','PUT','DELETE'],allow_headers=['Content-Type'])

@app.middleware('http')
async def local_origin(request:Request, call_next):
    origin = request.headers.get('origin')
    if origin and origin not in {'http://localhost:4317','http://127.0.0.1:4317','http://localhost:8765','http://127.0.0.1:8765'}:
        from fastapi.responses import JSONResponse
        return JSONResponse({'detail':'This workspace only accepts local requests.'},status_code=403)
    return await call_next(request)

@app.get('/api/health')
async def health():
    ready = await engine_available()
    return {'engine': 'OpenModelica 1.27.0','engineReady':ready,'agentReady':Path(CODEX).exists() or shutil.which(CODEX) is not None,'provider':'Codex','projectDirectory':str(PROJECT_DIR)}

def document_response(project):
    return {'project': project.model_dump(exclude_none=True) if project else None,
            'saveVersion': workspace.save_version(project) if project else None}

@app.get('/api/project')
async def load_project():
    project = workspace.load_current(PROJECT_DIR)
    return document_response(project)

@app.put('/api/project')
async def save_project(project:Project):
    project = workspace.document(project.model_dump(exclude_none=True))
    existing = workspace.saved_models(PROJECT_DIR).get(project.modelId)
    if existing and workspace.save_version(existing) != workspace.save_version(project):
        raise HTTPException(409, 'Reload Gradara to save this model with conflict protection.')
    try:
        project = existing or workspace.save_document(PROJECT_DIR, project, None)
        if existing is None:
            project = workspace.activate(PROJECT_DIR, project.modelId)
    except workspace.SaveConflict as exc:
        raise HTTPException(409, str(exc)) from exc
    return {'saved':True,'modelId':project.modelId,'revision':project.revision,'key':project_key(project)}

@app.get('/api/models')
async def list_models(trashed: bool = False):
    return {'models':workspace.model_summaries(PROJECT_DIR, trashed)}

@app.post('/api/models')
async def create_model(request: NewModelRequest):
    try:
        project = workspace.new_model(PROJECT_DIR, ROOT/'models'/'examples', request.name, request.template)
    except ValueError as exc:
        raise HTTPException(422,str(exc)) from exc
    return document_response(project)

@app.post('/api/models/copy')
async def copy_model(request: CopyModelRequest):
    try:
        return document_response(workspace.copy_model(PROJECT_DIR, request.project, request.name))
    except ValueError as exc:
        raise HTTPException(422, str(exc)) from exc

@app.put('/api/models/{model_id}')
async def update_model(model_id: str, request: SaveModelRequest):
    if model_id != request.project.modelId:
        raise HTTPException(422, 'Document ID does not match the save destination.')
    try:
        return document_response(workspace.save_document(PROJECT_DIR, request.project, request.expectedVersion))
    except workspace.SaveConflict as exc:
        raise HTTPException(409, str(exc)) from exc

@app.post('/api/models/{model_id}/activate')
async def activate_model(model_id: str):
    try:
        return document_response(workspace.activate(PROJECT_DIR, model_id))
    except KeyError as exc:
        raise HTTPException(404, 'Saved model not found.') from exc

@app.post('/api/models/{model_id}/trash')
async def trash_model(model_id: str):
    try:
        workspace.trash_model(PROJECT_DIR, model_id)
        return {'trashed': True}
    except workspace.SaveConflict as exc:
        raise HTTPException(409, str(exc)) from exc
    except KeyError as exc:
        raise HTTPException(404, 'Saved model not found.') from exc

@app.post('/api/models/{model_id}/restore')
async def restore_model(model_id: str):
    try:
        return document_response(workspace.restore_model(PROJECT_DIR, model_id))
    except KeyError as exc:
        raise HTTPException(404, 'Model not found in Trash.') from exc

@app.get('/api/models/{model_id}')
async def load_model(model_id: str):
    project = workspace.saved_models(PROJECT_DIR).get(model_id)
    if project is None: raise HTTPException(404,'Saved model not found.')
    return document_response(project)

@app.get('/api/examples/{example_id}')
async def load_example(example_id: str):
    if example_id not in {'dc','foc','buck'}: raise HTTPException(404,'Example not found.')
    path = ROOT/'models'/'examples'/f'{example_id}.json'
    if not path.exists(): raise HTTPException(404,'Example is unavailable.')
    data = json.loads(path.read_text())
    data['modelId'] = uuid.uuid4().hex
    names = {p.name for p in workspace.saved_models(PROJECT_DIR).values()}
    base = data['name']
    number = 2
    while data['name'] in names:
        data['name'] = f'{base} ({number})'
        number += 1
    return {'project':workspace.document(data).model_dump(exclude_none=True)}

@app.post('/api/source')
async def source(project:Project):
    return {'source':emit_project(project)}

async def perform(job_id, operation):
    JOBS[job_id]['status']='running'
    try:
        result = await operation
        JOBS[job_id].update(status='complete',result=result)
    except asyncio.CancelledError:
        JOBS[job_id].update(status='cancelled')
    except Exception as exc:
        JOBS[job_id].update(status='failed',error=str(exc))

async def start_job(kind, operation_factory):
    active = sum(1 for j in JOBS.values() if j['status'] in {'running','queued'})
    if active >= 4: raise HTTPException(429,'Wait for a running operation to finish.')
    job_id = uuid.uuid4().hex[:16]
    JOBS[job_id]={'id':job_id,'kind':kind,'status':'queued'}
    TASKS[job_id]=asyncio.create_task(perform(job_id,operation_factory(job_id)))
    return JOBS[job_id]

@app.post('/api/runs')
async def run(project:Project):
    if not project.blocks: raise HTTPException(422,'Add a component before running the model.')
    return await start_job('simulation',lambda i:simulate(project,i))

@app.get('/api/jobs/{job_id}')
async def job(job_id:str):
    if job_id not in JOBS: raise HTTPException(404,'Operation not found. The local service may have restarted.')
    return JOBS[job_id]

@app.delete('/api/jobs/{job_id}')
async def cancel(job_id:str):
    if job_id not in TASKS: raise HTTPException(404,'Operation not found.')
    if not TASKS[job_id].done(): TASKS[job_id].cancel()
    return {'cancelled':True}

@app.get('/api/results/latest')
async def latest(model: str | None = None):
    project = workspace.saved_models(PROJECT_DIR).get(model) if model else workspace.load_current(PROJECT_DIR)
    if project is None: return {'result':None}
    wanted_hash = semantic_hash(project)
    files = sorted(RUNS.glob('*/result.json'),key=lambda p:p.stat().st_mtime,reverse=True)
    for path in files:
        try:
            result = json.loads(path.read_text())
        except (OSError, ValueError):
            continue
        snapshot = result.get('snapshot', {})
        identity = snapshot.get('modelId') or f"legacy-{snapshot.get('exampleId') or 'workspace'}"
        if identity == project.modelId and result.get('modelHash') == wanted_hash:
            return {'result':result}
    return {'result':None}

@app.get('/api/results/{run_id}/csv')
async def csv_download(run_id:str):
    if not run_id.isalnum(): raise HTTPException(400,'Invalid run ID.')
    path = RUNS/run_id/'simulation_res.csv'
    if not path.exists(): raise HTTPException(404,'Results are unavailable.')
    return FileResponse(path,media_type='text/csv',filename='gradara-simulation.csv')

@app.post('/api/components/generate')
async def generate(request:GenerateRequest):
    return await start_job('component',lambda i:generate_component(request.prompt,request.existing,i))

from .models import ExportRequest
from .exporter import export_controller, EXPORTS

@app.post('/api/exports')
async def export(request:ExportRequest):
    return await start_job('export',lambda i:export_controller(request.project,request.blockId,i))

@app.get('/api/exports/{export_id}/download')
async def export_download(export_id:str):
    if not export_id.isalnum(): raise HTTPException(400,'Invalid export ID.')
    path=EXPORTS/export_id/'gradara-controller.zip'
    if not path.exists(): raise HTTPException(404,'Export not found.')
    return FileResponse(path,media_type='application/zip',filename='gradara-controller.zip')
