import asyncio
import json
from pathlib import Path
import shutil
import uuid
from contextlib import asynccontextmanager
from fastapi import FastAPI, HTTPException, Request
from fastapi.responses import FileResponse, PlainTextResponse
from fastapi.middleware.cors import CORSMiddleware
from .models import Project, GenerateRequest
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

@app.get('/api/project')
async def load_project():
    if not PROJECT_FILE.exists(): return {'project':None}
    return {'project':json.loads(PROJECT_FILE.read_text())}

@app.put('/api/project')
async def save_project(project:Project):
    data = project.model_dump_json(indent=2,exclude_none=True)
    examples = PROJECT_DIR/'examples'
    examples.mkdir(exist_ok=True)
    archive = examples/f'{project.exampleId}.json'
    archive.write_text(data)
    temporary = PROJECT_DIR/'workspace.tmp'
    temporary.write_text(data)
    temporary.replace(PROJECT_FILE)
    source = PROJECT_DIR/'workspace.mo'
    temp_source = PROJECT_DIR/'workspace.mo.tmp'
    temp_source.write_text(emit_project(project))
    temp_source.replace(source)
    return {'saved':True,'revision':project.revision,'key':project_key(project)}

@app.get('/api/examples/{example_id}')
async def load_example(example_id: str):
    if example_id not in {'dc','foc','wiring'}: raise HTTPException(404,'Example not found.')
    saved = PROJECT_DIR/'examples'/f'{example_id}.json'
    bundled = ROOT/'models'/'examples'/f'{example_id}.json'
    path = saved if saved.exists() else bundled
    if not path.exists(): raise HTTPException(404,'Example is unavailable.')
    return {'project':json.loads(path.read_text())}

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
async def latest(example: str | None = None):
    files = sorted(RUNS.glob('*/result.json'),key=lambda p:p.stat().st_mtime,reverse=True)
    target = PROJECT_DIR/'examples'/f'{example}.json' if example in {'dc','foc','wiring'} else PROJECT_FILE
    wanted_hash = None
    if target.exists():
        wanted_hash = semantic_hash(Project.model_validate_json(target.read_text()))
    fallback = None
    for path in files:
        result = json.loads(path.read_text())
        if example is not None and result.get('snapshot',{}).get('exampleId','dc') != example:
            continue
        if fallback is None: fallback = result
        if result.get('modelHash') == wanted_hash:
            return {'result':result}
    return {'result':fallback}

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
