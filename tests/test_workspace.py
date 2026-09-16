import asyncio
import json
from pathlib import Path
import uuid
import pytest
from server import workspace
from server.models import Project
from server.modelica import semantic_hash, project_key
from server.diagnostics import validate_simulation
from server.engine import simulate

FIXTURE = Path(__file__).parent/'fixtures/feedback-project.json'
def feedback(): return Project.model_validate_json(FIXTURE.read_text())

def test_saved_models_survive_switching_and_legacy_migration(tmp_path):
    original = json.loads(FIXTURE.read_text())
    original.update(exampleId='wiring', name='Wiring playground')
    (tmp_path/'examples').mkdir()
    legacy = tmp_path/'examples/wiring.json'
    legacy.write_text(json.dumps(original))
    (tmp_path/'workspace.json').write_text(legacy.read_text())
    before = legacy.read_text()
    model = workspace.load_current(tmp_path)
    assert model.name == 'Feedback control'
    assert model.modelId == 'legacy-wiring'
    assert model.exampleId is None
    assert model.blocks == Project.model_validate(original).blocks
    workspace.save(tmp_path, model)
    other = feedback()
    other.name = 'My other model'
    other = workspace.save(tmp_path, other)
    assert other.modelId != model.modelId
    assert workspace.load_current(tmp_path).modelId == other.modelId
    assert set(workspace.saved_models(tmp_path)) == {model.modelId, other.modelId}
    assert legacy.read_text() == before

def test_document_identity_is_not_solver_identity():
    model = feedback()
    before = (semantic_hash(model), project_key(model))
    model.modelId = 'another-document'
    assert (semantic_hash(model), project_key(model)) == before

def test_incomplete_drawing_can_save_but_reports_named_input_before_simulation():
    model = feedback()
    model.wires = []
    Project.model_validate_json(model.model_dump_json())
    with pytest.raises(RuntimeError, match='Connect these signal inputs') as failure:
        validate_simulation(model)
    assert 'Subtract.+' in str(failure.value)

@pytest.mark.integration
def test_singular_feedback_returns_diagnostics_instead_of_partial_success():
    model = feedback()
    gain = next(b for b in model.blocks if b.definition.kind == 'gain')
    gain.definition.parameters[0].value = 1
    summing = next(b for b in model.blocks if b.definition.kind in {'sum', 'subtract'})
    summing.definition.equations = 'y = a + b;'
    job_id = 'singular' + uuid.uuid4().hex[:12]
    with pytest.raises(RuntimeError) as failure:
        asyncio.run(simulate(model, job_id))
    assert len(str(failure.value)) > 100
    assert 'linear system' in str(failure.value).lower() or 'singular' in str(failure.value).lower()
    from server.engine import RUNS
    assert not (RUNS/job_id/'result.json').exists()

def test_latest_results_require_same_document_and_exact_equations(tmp_path, monkeypatch):
    from server import app as service
    runs = tmp_path/'runs'
    monkeypatch.setattr(service, 'PROJECT_DIR', tmp_path)
    monkeypatch.setattr(service, 'RUNS', runs)
    model = workspace.save(tmp_path, feedback())
    def record(run_id, snapshot, model_hash):
        folder = runs/run_id
        folder.mkdir(parents=True)
        (folder/'result.json').write_text(json.dumps({'id':run_id,'modelHash':model_hash,'snapshot':snapshot.model_dump(exclude_none=True)}))
    other = model.model_copy(deep=True)
    other.modelId = 'unrelated'
    record('unrelated', other, semantic_hash(model))
    assert asyncio.run(service.latest(model.modelId)) == {'result':None}
    record('matching', model, semantic_hash(model))
    assert asyncio.run(service.latest(model.modelId))['result']['id'] == 'matching'
    model.duration += 1
    workspace.save(tmp_path, model)
    assert asyncio.run(service.latest(model.modelId)) == {'result':None}

def test_api_documents_omit_unset_optional_values(tmp_path, monkeypatch):
    from server import app as service
    monkeypatch.setattr(service, 'PROJECT_DIR', tmp_path)
    model = workspace.save(tmp_path, feedback())
    current = asyncio.run(service.load_project())['project']
    loaded = asyncio.run(service.load_model(model.modelId))['project']
    assert current == loaded
    for block in current['blocks']:
        for port in block['definition']['ports']:
            assert port.get('offset', 50) is not None
        for param in block['definition']['parameters']:
            assert param.get('min', 0) is not None
    a = asyncio.run(service.load_example('foc'))['project']
    workspace.save(tmp_path, Project.model_validate(a))
    b = asyncio.run(service.load_example('foc'))['project']
    assert a['modelId'] != b['modelId']
    assert a['name'] != b['name']
    assert all(v is not None for block in b['blocks'] for port in block['definition']['ports'] for v in port.values())


def test_new_blank_model_preserves_current_document_and_uses_independent_identity(tmp_path):
    templates = Path(__file__).parents[1]/'models/examples'
    existing = workspace.save(tmp_path, feedback())
    before = (tmp_path/'models'/f'{existing.modelId}.json').read_text()
    blank = workspace.new_model(tmp_path, templates, '  My circuit  ')
    assert blank.name == 'My circuit'
    assert blank.modelId != existing.modelId
    assert blank.blocks == blank.wires == blank.junctions == blank.nets == blank.plots == []
    assert blank.exampleId is None
    assert workspace.load_current(tmp_path).modelId == blank.modelId
    assert (tmp_path/'models'/f'{existing.modelId}.json').read_text() == before
    second = workspace.new_model(tmp_path, templates, 'My circuit')
    assert second.name == 'My circuit (2)'
    assert second.modelId != blank.modelId

@pytest.mark.parametrize('template', ['dc', 'foc', 'buck', 'flyback'])
def test_new_model_templates_are_saved_independent_documents(tmp_path, template):
    templates = Path(__file__).parents[1]/'models/examples'
    before = (templates/f'{template}.json').read_text()
    created = workspace.new_model(tmp_path, templates, 'My example', template)
    validate_simulation(created)
    assert created.blocks and created.wires
    assert created.modelId
    assert len(workspace.saved_models(tmp_path)) == 1
    assert (templates/f'{template}.json').read_text() == before

@pytest.mark.parametrize('name,template', [(' ', 'blank'), ('Circuit', '../workspace')])
def test_new_model_rejects_invalid_requests_without_touching_workspace(tmp_path, name, template):
    templates = Path(__file__).parents[1]/'models/examples'
    with pytest.raises(ValueError): workspace.new_model(tmp_path, templates, name, template)
    assert not (tmp_path/'workspace.json').exists()


def test_background_save_does_not_activate_or_replace_another_document(tmp_path):
    a = workspace.save(tmp_path, feedback())
    token = workspace.save_version(a)
    b = workspace.new_model(tmp_path, Path('models/examples'), 'Blank model')
    a.name = 'Renamed in another tab'
    a.revision += 1
    workspace.save_document(tmp_path, a, token)
    assert workspace.load_current(tmp_path).modelId == b.modelId
    assert workspace.saved_models(tmp_path)[a.modelId].name == a.name
    assert workspace.saved_models(tmp_path)[b.modelId].blocks == []
    workspace.activate(tmp_path, a.modelId)
    assert workspace.load_current(tmp_path).name == a.name


def test_stale_same_revision_edit_is_rejected_and_can_be_saved_as_copy(tmp_path):
    model = workspace.save(tmp_path, feedback())
    token = workspace.save_version(model)
    left, right = model.model_copy(deep=True), model.model_copy(deep=True)
    left.name = 'First tab'
    right.name = 'Second tab'
    left.revision += 1
    right.revision += 1
    workspace.save_document(tmp_path, left, token)
    with pytest.raises(workspace.SaveConflict):
        workspace.save_document(tmp_path, right, token)
    assert workspace.load_current(tmp_path).name == 'First tab'
    copied = workspace.copy_model(tmp_path, right, 'Recovered edits')
    assert copied.modelId != model.modelId
    assert copied.blocks == right.blocks
    assert workspace.saved_models(tmp_path)[model.modelId].name == 'First tab'
    assert workspace.load_current(tmp_path).name == 'Recovered edits'


def test_retry_after_lost_response_is_idempotent(tmp_path):
    model = workspace.save(tmp_path, feedback())
    token = workspace.save_version(model)
    model.name = 'Saved already'
    workspace.save_document(tmp_path, model, token)
    path = tmp_path/'models'/f'{model.modelId}.json'
    modified = path.stat().st_mtime_ns
    retry = workspace.save_document(tmp_path, model, token)
    assert workspace.save_version(retry) == workspace.save_version(model)
    assert path.stat().st_mtime_ns == modified


def test_current_snapshot_cannot_override_newer_canonical_document(tmp_path):
    model = workspace.save(tmp_path, feedback())
    snapshot = (tmp_path/'workspace.json').read_bytes()
    token = workspace.save_version(model)
    model.name = 'New name'
    workspace.save_document(tmp_path, model, token)
    assert (tmp_path/'workspace.json').read_bytes() == snapshot
    assert workspace.load_current(tmp_path).name == 'New name'
    assert workspace.saved_models(tmp_path)[model.modelId].name == 'New name'


def test_creating_model_preserves_a_workspace_only_legacy_document(tmp_path):
    original = json.loads(FIXTURE.read_text())
    original.pop('modelId', None)
    original.pop('exampleId', None)
    (tmp_path/'workspace.json').write_text(json.dumps(original))
    old = workspace.load_current(tmp_path)
    workspace.new_model(tmp_path, Path('models/examples'), 'Untitled model')
    assert workspace.saved_models(tmp_path)[old.modelId].blocks == old.blocks
    assert (tmp_path/'models'/f'{old.modelId}.json').exists()


def test_opening_model_does_not_change_last_saved_time(tmp_path):
    model = workspace.save(tmp_path, feedback())
    summary = workspace.model_summaries(tmp_path)[0]
    workspace.activate(tmp_path, model.modelId)
    assert workspace.model_summaries(tmp_path)[0] == summary
    assert summary['blocks'] == len(model.blocks)


def test_model_api_returns_save_versions_and_conflicts(tmp_path, monkeypatch):
    from server import app as service
    from server.models import SaveModelRequest, CopyModelRequest, NewModelRequest
    from fastapi import HTTPException
    monkeypatch.setattr(service, 'PROJECT_DIR', tmp_path)
    response = asyncio.run(service.create_model(NewModelRequest()))
    blank = Project.model_validate(response['project'])
    assert blank.name == 'Untitled model'
    assert blank.blocks == []
    assert len(response['saveVersion']) == 64
    request = SaveModelRequest(project=blank, expectedVersion=response['saveVersion'])
    request.project.name = 'My circuit'
    saved = asyncio.run(service.update_model(blank.modelId, request))
    assert saved['saveVersion'] != response['saveVersion']
    request.project.name = 'Stale edits'
    with pytest.raises(HTTPException) as failure:
        asyncio.run(service.update_model(blank.modelId, request))
    assert failure.value.status_code == 409
    with pytest.raises(HTTPException) as legacy_failure:
        asyncio.run(service.save_project(request.project))
    assert legacy_failure.value.status_code == 409
    copied = asyncio.run(service.copy_model(CopyModelRequest(project=request.project, name='My circuit')))
    assert copied['project']['name'] == 'My circuit (2)'
    asyncio.run(service.activate_model(blank.modelId))
    assert asyncio.run(service.load_project())['project']['name'] == 'My circuit'
    assert len(asyncio.run(service.list_models())['models']) == 2


def test_trash_is_recoverable_and_legacy_files_do_not_resurrect_it(tmp_path, monkeypatch):
    from server import app as service
    from fastapi import HTTPException
    monkeypatch.setattr(service, 'PROJECT_DIR', tmp_path)
    legacy = tmp_path/'examples/dc.json'
    legacy.parent.mkdir()
    legacy.write_text(FIXTURE.read_text())
    model = next(iter(workspace.saved_models(tmp_path).values()))
    active = workspace.new_model(tmp_path, Path('models/examples'), 'Current model')
    workspace.trash_model(tmp_path, model.modelId)
    assert model.modelId not in workspace.saved_models(tmp_path)
    assert legacy.exists()
    assert workspace.model_summaries(tmp_path, True)[0]['id'] == model.modelId
    with pytest.raises(workspace.SaveConflict):
        workspace.save_document(tmp_path, model, workspace.save_version(model))
    with pytest.raises(HTTPException) as legacy_failure:
        asyncio.run(service.save_project(model))
    assert legacy_failure.value.status_code == 409
    assert not (tmp_path/'models'/f'{model.modelId}.json').exists()
    restored = workspace.restore_model(tmp_path, model.modelId)
    assert restored == model
    assert workspace.load_current(tmp_path).modelId == active.modelId
    assert workspace.model_summaries(tmp_path, True) == []
    assert model.modelId in workspace.saved_models(tmp_path)
    with pytest.raises(workspace.SaveConflict):
        workspace.trash_model(tmp_path, active.modelId)
