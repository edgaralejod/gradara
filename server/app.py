import asyncio
import json
import os
import uuid
from contextlib import asynccontextmanager
from fastapi import FastAPI, HTTPException, Request
from fastapi.responses import FileResponse, JSONResponse, Response
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field
from .platform_env import extend_path

extend_path()

from .models import Definition, Project, GenerateRequest, NewModelRequest, SaveModelRequest, CopyModelRequest
from . import workspace, settings, engines, credentials
from .modelica import emit_project, project_key, semantic_hash
from .engine import RUNS, engine_available, simulate
from .diagnostics import SimulationFailure
from .agent import generate_component
from .model_agent import ModelGenerateRequest, generate_model
from .model_edit import ModelEditRequest, edit_model
from .diagnose_agent import DiagnoseRequest, diagnose
from .paths import DATA, EXAMPLES, STATIC
from .llm import dispatch, gradara as gradara_ai
from .llm.providers import ProviderError, verify_key

def app_version() -> str:
    """Installed apps set GRADARA_VERSION. A source checkout reads package.json."""
    override = os.environ.get('GRADARA_VERSION')
    if override:
        return override
    package = os.path.join(os.path.dirname(__file__), '..', 'package.json')
    try:
        with open(package, encoding='utf-8') as handle:
            return json.load(handle)['version']
    except (OSError, ValueError, KeyError):
        return 'dev'

VERSION = app_version()
PROJECT_DIR = DATA
PROJECT_FILE = PROJECT_DIR/'workspace.json'
JOBS: dict[str,dict] = {}
TASKS: dict[str,asyncio.Task] = {}
SIGNINS: dict[str, dict] = {}
PORT = os.environ.get('GRADARA_PORT', '8765')
LOCAL_ORIGINS = {f'http://{host}:{port}' for host in ('localhost', '127.0.0.1') for port in {'4317', '8765', PORT}}
LOCAL_HOSTS = {'localhost', '127.0.0.1', '[::1]', 'testserver'}
CLIENT_HEADER = 'x-gradara-client'

@asynccontextmanager
async def lifespan(app):
    yield
    for task in TASKS.values():
        if not task.done(): task.cancel()
    await asyncio.gather(*TASKS.values(), return_exceptions=True)

app = FastAPI(title='Gradara local workspace', lifespan=lifespan, docs_url='/api/docs', openapi_url='/api/openapi.json')
app.add_middleware(CORSMiddleware, allow_origins=sorted(LOCAL_ORIGINS),allow_methods=['GET','POST','PUT','DELETE'],allow_headers=['Content-Type','X-Gradara-Client'])

def _hostname(host: str) -> str:
    if host.startswith('['):
        return host.split(']')[0] + ']'
    return host.rsplit(':', 1)[0]

@app.middleware('http')
async def local_only(request:Request, call_next):
    """Accept requests only from this computer's Gradara window.

    * Host must be a loopback name, which defeats DNS-rebinding pages.
    * A browser Origin, when present, must be the workbench itself.
    * State-changing requests must carry X-Gradara-Client. Browsers cannot add
      that header cross-origin without a CORS preflight, which is refused, so
      other websites cannot trigger simulations or paid AI calls.
    """
    if _hostname(request.headers.get('host') or '') not in LOCAL_HOSTS:
        return JSONResponse({'detail':'This workspace only accepts local requests.'},status_code=403)
    origin = request.headers.get('origin')
    same_origin = origin == f"http://{request.headers.get('host')}"
    if origin and not same_origin and origin not in LOCAL_ORIGINS:
        return JSONResponse({'detail':'This workspace only accepts local requests.'},status_code=403)
    if request.method in {'POST','PUT','DELETE','PATCH'} and request.url.path.startswith('/api/') and not request.headers.get(CLIENT_HEADER):
        return JSONResponse({'detail':'Missing Gradara client header.'},status_code=403)
    return await call_next(request)

@app.exception_handler(ProviderError)
async def provider_error(request: Request, exc: ProviderError):
    return JSONResponse({'detail': str(exc)}, status_code=exc.status if 400 <= exc.status < 600 else 502)

@app.get('/api/health')
async def health():
    ready = await engine_available()
    ai = dispatch.status()
    return {'engine': 'OpenModelica','engineReady':ready,'agentReady':ai['ready'],'provider':ai['label'],
            'aiProvider':ai['provider'],'version':VERSION,'projectDirectory':str(PROJECT_DIR)}

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
        project = workspace.new_model(PROJECT_DIR, EXAMPLES, request.name, request.template)
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
    path = workspace.template_path(EXAMPLES, example_id)
    if path is None: raise HTTPException(404,'Example not found.')
    if not path.exists(): raise HTTPException(404,'Example is unavailable.')
    data = json.loads(path.read_text(encoding='utf-8'))
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
    # One top-level operation is one billable AI job, including its repairs.
    dispatch.current_job.set({'id': job_id, 'kind': JOBS[job_id]['kind']})
    try:
        result = await operation
        JOBS[job_id].update(status='complete',result=result)
    except asyncio.CancelledError:
        JOBS[job_id].update(status='cancelled')
    except Exception as exc:
        JOBS[job_id].update(status='failed',error=str(exc))
        if isinstance(exc, SimulationFailure):
            JOBS[job_id]['diagnostics'] = [d.model_dump() for d in exc.diagnostics]
    finally:
        # Operation closures can hold full models; drop them once finished.
        TASKS.pop(job_id, None)
        _trim_jobs()

def _trim_jobs(limit: int = 200):
    finished = [key for key, job in JOBS.items() if job['status'] in {'complete','failed','cancelled'}]
    for key in finished[:-limit]:
        JOBS.pop(key, None)

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
            result = json.loads(path.read_text(encoding='utf-8'))
        except (OSError, ValueError):
            continue
        snapshot = result.get('snapshot', {})
        identity = snapshot.get('modelId') or f"legacy-{snapshot.get('exampleId') or 'workspace'}"
        if identity == project.modelId and result.get('modelHash') == wanted_hash:
            return {'result':result}
    return {'result':None}

@app.get('/api/runs/{run_id}/diagnostics')
async def run_diagnostics(run_id: str):
    if not run_id.isalnum(): raise HTTPException(400, 'Invalid run ID.')
    path = RUNS/run_id/'diagnostics.json'
    if not path.exists(): raise HTTPException(404, 'No diagnostics were recorded for this run.')
    return json.loads(path.read_text(encoding='utf-8'))

@app.get('/api/results/{run_id}/data')
async def full_result_data(run_id: str):
    if not run_id.isalnum(): raise HTTPException(400, 'Invalid run ID.')
    folder = RUNS/run_id
    if not (folder/'result.json').exists() or not (folder/'simulation_res.csv').exists():
        raise HTTPException(404, 'Results are unavailable.')
    def read():
        import csv, math
        result = json.loads((folder/'result.json').read_text(encoding='utf-8'))
        with (folder/'simulation_res.csv').open(encoding='utf-8') as stream:
            rows = [row for row in csv.DictReader(stream) if float(row['time']) <= result['duration'] + max(1e-12, result['duration']*1e-12)]
        result['time'] = [float(row['time']) for row in rows]
        for series in result['series']:
            series['values'] = [float(row[series['key']]) for row in rows]
        if not all(math.isfinite(v) for v in result['time']) or not all(math.isfinite(v) for s in result['series'] for v in s['values']):
            raise ValueError('Non-finite samples in stored results.')
        return result
    return await asyncio.to_thread(read)

@app.get('/api/results/{run_id}/csv')
async def csv_download(run_id:str):
    if not run_id.isalnum(): raise HTTPException(400,'Invalid run ID.')
    path = RUNS/run_id/'simulation_res.csv'
    if not path.exists(): raise HTTPException(404,'Results are unavailable.')
    return FileResponse(path,media_type='text/csv',filename='gradara-simulation.csv')

@app.get('/api/components/library')
async def component_library():
    from .component_library import list_components
    return {'components': list_components(PROJECT_DIR)}

@app.post('/api/models/generate')
async def generate_full_model(request: ModelGenerateRequest):
    return await start_job('model', lambda i: generate_model(request, i, lambda message: JOBS[i].update(progress=message)))

@app.post('/api/models/edit')
async def edit_open_model(request: ModelEditRequest):
    return await start_job('edit', lambda i: edit_model(request, i, lambda message: JOBS[i].update(progress=message)))

@app.post('/api/diagnose')
async def diagnose_problems(request: DiagnoseRequest):
    return await start_job('diagnose', lambda i: diagnose(request, i, lambda message: JOBS[i].update(progress=message)))

@app.post('/api/components/generate')
async def generate(request:GenerateRequest):
    return await start_job('component',lambda i:generate_component(request.prompt,request.existing,i,request.blockType))

from .models import ExportRequest
from .exporter import export_controller
from .paths import EXPORTS

@app.post('/api/exports')
async def export(request:ExportRequest):
    return await start_job('export',lambda i:export_controller(request.project,request.blockId,i))

@app.get('/api/exports/{export_id}/download')
async def export_download(export_id:str):
    if not export_id.isalnum(): raise HTTPException(400,'Invalid export ID.')
    path=EXPORTS/export_id/'gradara-controller.zip'
    if not path.exists(): raise HTTPException(404,'Export not found.')
    return FileResponse(path,media_type='application/zip',filename='gradara-controller.zip')


from . import codegen as _codegen


def _codegen_failure(exc: Exception) -> dict:
    return {'ok': False, 'error': str(exc), 'blockIds': getattr(exc, 'block_ids', [])}


@app.post('/api/codegen')
async def generate_code(request: _codegen.CodegenRequest):
    try:
        generated = _codegen.generate(request.project, request.path, request.instanceId, request.blockIds, request.options)
    except _codegen.CodegenError as exc:
        return _codegen_failure(exc)
    return {'ok': True, **_codegen.describe(generated)}

@app.post('/api/codegen/archive')
async def code_archive(request: _codegen.CodegenRequest):
    try:
        generated = _codegen.generate(request.project, request.path, request.instanceId, request.blockIds, request.options)
    except _codegen.CodegenError as exc:
        raise HTTPException(422, str(exc)) from exc
    return Response(_codegen.archive(generated), media_type='application/zip',
                    headers={'Content-Disposition': f'attachment; filename="{request.options.prefix}.zip"'})

class TemplateRequest(BaseModel):
    definition: Definition


@app.post('/api/codegen/template')
async def write_c_template(request: TemplateRequest):
    from .ctemplate import write_template
    return await start_job('export', lambda i: write_template(request.definition, i, lambda message: JOBS[i].update(progress=message)))


@app.post('/api/codegen/verify')
async def verify_code(request: _codegen.CodegenRequest):
    try:
        return await _codegen.verify(request, RUNS, engines.run_c)
    except _codegen.CodegenError as exc:
        return _codegen_failure(exc)


@app.post('/api/variants/check')
async def check_inactive_variants(project: Project):
    from .variant_check import check_variants
    return await start_job('variants', lambda i: check_variants(project, i, lambda message: JOBS[i].update(progress=message)))


# ------------------------------------------------------------------ engine

class EngineChoice(BaseModel):
    engine: str = Field(pattern='^(auto|native|docker)$')

@app.get('/api/engine')
async def engine_status(refresh: bool = False):
    return await engines.status(refresh)

@app.put('/api/engine')
async def choose_engine(choice: EngineChoice):
    settings.update({'engine': choice.engine})
    return await engines.status()

@app.post('/api/engine/prepare')
async def prepare_engine():
    if any(j['kind'] == 'engine' and j['status'] in {'queued','running'} for j in JOBS.values()):
        raise HTTPException(409, 'Engine setup is already running.')
    return await start_job('engine', lambda i: engines.prepare(lambda message: JOBS[i].update(progress=message)))

# ---------------------------------------------------------------------- AI

class AIChoice(BaseModel):
    provider: str | None = Field(default=None, pattern='^(gradara|openai|anthropic|codex|off)$')
    openaiModel: str | None = Field(default=None, max_length=100)
    anthropicModel: str | None = Field(default=None, max_length=100)

class APIKey(BaseModel):
    key: str = Field(min_length=8, max_length=400)

@app.get('/api/ai')
async def ai_status():
    return dispatch.status()

@app.put('/api/ai')
async def choose_ai(choice: AIChoice):
    settings.update({'ai': choice.model_dump(exclude_none=True)})
    return dispatch.status()

@app.put('/api/ai/keys/{provider}')
async def save_key(provider: str, body: APIKey):
    if provider not in dispatch.KEY_NAMES: raise HTTPException(404, 'Unknown provider.')
    key = body.key.strip()
    await verify_key(provider, key)
    credentials.put(dispatch.KEY_NAMES[provider], key)
    return dispatch.status()

@app.delete('/api/ai/keys/{provider}')
async def remove_key(provider: str):
    if provider not in dispatch.KEY_NAMES: raise HTTPException(404, 'Unknown provider.')
    credentials.delete(dispatch.KEY_NAMES[provider])
    return dispatch.status()

# ------------------------------------------------------- Gradara AI account

class CheckoutRequest(BaseModel):
    pack: str = Field(min_length=1, max_length=40)

@app.post('/api/account/signin')
async def begin_sign_in():
    data = await gradara_ai.start_sign_in()
    signin = uuid.uuid4().hex
    SIGNINS.clear()
    SIGNINS[signin] = {'deviceCode': data['deviceCode']}
    return {'id': signin, 'userCode': data['userCode'], 'verificationUrl': data['verificationUrl'],
            'expiresIn': data.get('expiresIn', 600), 'interval': data.get('interval', 3)}

@app.get('/api/account/signin/{signin}')
async def sign_in_progress(signin: str):
    pending = SIGNINS.get(signin)
    if pending is None: raise HTTPException(404, 'Start sign-in again.')
    data = await gradara_ai.poll_sign_in(pending['deviceCode'])
    if data.get('status') in {'approved', 'expired', 'denied'}:
        SIGNINS.pop(signin, None)
    return data

@app.get('/api/account')
async def account():
    if not credentials.present('gradara_token'):
        return {'signedIn': False}
    return {'signedIn': True, **await gradara_ai.account()}

@app.post('/api/account/checkout')
async def checkout(request: CheckoutRequest):
    return await gradara_ai.checkout(request.pack)

@app.post('/api/account/signout')
async def sign_out():
    await gradara_ai.sign_out()
    return {'signedIn': False}

@app.delete('/api/account')
async def delete_account():
    return await gradara_ai.delete_account()

# ------------------------------------------------------ installed workbench

if STATIC is not None and (STATIC/'index.html').exists():
    from fastapi.staticfiles import StaticFiles
    app.mount('/assets', StaticFiles(directory=STATIC/'assets', check_dir=False), name='assets')

    @app.get('/{path:path}', include_in_schema=False)
    async def workbench(path: str):
        if path.startswith('api/'):
            raise HTTPException(404, 'Not found.')
        candidate = (STATIC/path).resolve()
        if path and candidate.is_file() and STATIC.resolve() in candidate.parents:
            return FileResponse(candidate)
        return FileResponse(STATIC/'index.html', headers={'Cache-Control': 'no-store'})
