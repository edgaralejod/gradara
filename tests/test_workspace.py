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

@pytest.mark.parametrize('template', ['dc', 'foc', 'buck'])
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
