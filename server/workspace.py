"""Local documents have identity independent of the example they started from."""
import json
import hashlib
from datetime import datetime, timezone
import uuid
from pathlib import Path
from .models import Project
from .modelica import emit_project


def document(data: dict, legacy_id: str | None = None) -> Project:
    data = dict(data)
    if not data.get('modelId'):
        data['modelId'] = f'legacy-{legacy_id}' if legacy_id else uuid.uuid4().hex
    if data.get('exampleId') == 'wiring':
        data.pop('exampleId')
        if data.get('name') == 'Wiring playground':
            data['name'] = 'Feedback control'
            data['description'] = ''
    return Project.model_validate(data)


def load_current(directory: Path):
    path = directory/'workspace.json'
    if not path.exists(): return None
    data = json.loads(path.read_text())
    current = document(data, data.get('exampleId') or 'workspace')
    canonical = directory/'models'/f'{current.modelId}.json'
    return document(json.loads(canonical.read_text())) if canonical.exists() else current


def saved_models(directory: Path):
    models = {}
    for path in sorted((directory/'examples').glob('*.json')):
        project = document(json.loads(path.read_text()), path.stem)
        models[project.modelId] = project
    for path in sorted((directory/'models').glob('*.json')):
        project = document(json.loads(path.read_text()))
        models[project.modelId] = project
    current = load_current(directory)
    if current: models.setdefault(current.modelId, current)
    archived = {p.stem for p in (directory/'trash').glob('*.json')}
    return {key: value for key, value in models.items() if key not in archived}


class SaveConflict(ValueError):
    pass


def save_version(project: Project) -> str:
    content = json.dumps(project.model_dump(exclude_none=True), sort_keys=True, separators=(',', ':'))
    return hashlib.sha256(content.encode()).hexdigest()


def atomic_write(path: Path, content: str):
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_name(f'.{path.name}.{uuid.uuid4().hex}.tmp')
    try:
        temporary.write_text(content)
        temporary.replace(path)
    finally:
        temporary.unlink(missing_ok=True)


def write_document(directory: Path, project: Project):
    project = document(project.model_dump(exclude_none=True))
    source = emit_project(project)
    path = directory/'models'/f'{project.modelId}.json'
    content = project.model_dump_json(indent=2, exclude_none=True)
    if not path.exists() or path.read_text() != content:
        atomic_write(path, content)
    current = load_current(directory)
    if current and current.modelId == project.modelId:
        atomic_write(directory/'workspace.mo', source)
    return project


def activate(directory: Path, model_id: str):
    project = saved_models(directory).get(model_id)
    if project is None:
        raise KeyError('Saved model not found.')
    # Materialize legacy work before changing the active document.
    current = load_current(directory)
    if current and current.modelId != project.modelId:
        write_document(directory, current)
    project = write_document(directory, project)
    atomic_write(directory/'workspace.mo', emit_project(project))
    atomic_write(directory/'workspace.json', project.model_dump_json(indent=2, exclude_none=True))
    return project


def save_document(directory: Path, project: Project, expected_version: str | None):
    if not project.modelId:
        raise ValueError('A saved model needs a document ID.')
    if (directory/'trash'/f'{project.modelId}.json').exists():
        raise SaveConflict('This model is in Trash. Save your edits as a copy or restore it from the model browser.')
    existing = saved_models(directory).get(project.modelId)
    if existing and save_version(existing) == save_version(project):
        return existing  # Safe retry after an acknowledged response was lost.
    if existing and save_version(existing) != expected_version:
        raise SaveConflict('This model changed in another window. Save your edits as a copy or reload the saved version.')
    if not existing and expected_version is not None:
        raise SaveConflict('The saved model is no longer available. Save your edits as a copy.')
    return write_document(directory, project)


def save(directory: Path, project: Project):
    """Legacy save-and-activate route; modern autosave uses save_document."""
    project = write_document(directory, project)
    return activate(directory, project.modelId)


def unique_name(directory: Path, name: str):
    name = name.strip()
    if not name:
        raise ValueError('Enter a model name.')
    names = {p.name for p in saved_models(directory).values()}
    unique, number = name, 2
    while unique in names:
        suffix = f' ({number})'
        unique = name[:120-len(suffix)] + suffix
        number += 1
    return unique


def copy_model(directory: Path, project: Project, name: str):
    data = project.model_dump(exclude_none=True)
    data.update(name=unique_name(directory, name), modelId=uuid.uuid4().hex, revision=0)
    return save(directory, document(data))


def model_summaries(directory: Path, trashed: bool = False):
    summaries = []
    projects = [document(json.loads(path.read_text())) for path in (directory/'trash').glob('*.json')] if trashed else saved_models(directory).values()
    for project in projects:
        path = directory/('trash' if trashed else 'models')/f'{project.modelId}.json'
        if not path.exists():
            path = directory/'examples'/f'{project.modelId.removeprefix("legacy-")}.json'
        modified = path.stat().st_mtime if path.exists() else 0
        summaries.append({'id': project.modelId, 'name': project.name,
                          'blocks': len(project.blocks), 'exampleId': project.exampleId,
                          'updatedAt': datetime.fromtimestamp(modified, timezone.utc).isoformat()})
    return sorted(summaries, key=lambda item: item['updatedAt'], reverse=True)


def new_model(directory: Path, templates: Path, name: str, template: str = 'blank') -> Project:
    if template not in {'blank', 'dc', 'foc', 'buck'}:
        raise ValueError('Unknown model template.')
    name = name.strip()
    if not name: raise ValueError('Enter a model name.')
    if template == 'blank':
        data = {'version':1,'name':name,'duration':1,'revision':0,'blocks':[],'wires':[],'junctions':[],'nets':[]}
    else:
        data = json.loads((templates/f'{template}.json').read_text())
    data.update(name=unique_name(directory, name),modelId=uuid.uuid4().hex,revision=0)
    return save(directory, document(data))


def trash_model(directory: Path, model_id: str):
    project = saved_models(directory).get(model_id)
    if project is None:
        raise KeyError('Saved model not found.')
    current = load_current(directory)
    if current and current.modelId == model_id:
        raise SaveConflict('Open another model before moving the active model to Trash.')
    atomic_write(directory/'trash'/f'{project.modelId}.json', project.model_dump_json(indent=2, exclude_none=True))
    (directory/'models'/f'{project.modelId}.json').unlink(missing_ok=True)


def restore_model(directory: Path, model_id: str):
    # Resolve through validated documents instead of interpreting a requested ID as a path.
    for path in (directory/'trash').glob('*.json'):
        project = document(json.loads(path.read_text()))
        if project.modelId == model_id:
            write_document(directory, project)
            path.unlink()
            return project
    raise KeyError('Model not found in Trash.')
