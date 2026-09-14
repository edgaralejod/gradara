"""Local documents have identity independent of the example they started from."""
import json
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
    return document(data, data.get('exampleId') or 'workspace')


def saved_models(directory: Path):
    models = {}
    for path in sorted((directory/'examples').glob('*.json')):
        project = document(json.loads(path.read_text()), path.stem)
        models[project.modelId] = project
    for path in sorted((directory/'models').glob('*.json')):
        project = document(json.loads(path.read_text()))
        models[project.modelId] = project
    current = load_current(directory)
    if current: models[current.modelId] = current
    return models


def save(directory: Path, project: Project):
    project = document(project.model_dump(exclude_none=True))
    source = emit_project(project)  # Validate emission before touching saved files.
    data = project.model_dump_json(indent=2, exclude_none=True)
    (directory/'models').mkdir(parents=True, exist_ok=True)
    for path, content in [(directory/'models'/f'{project.modelId}.json', data),
                          (directory/'workspace.mo', source),
                          (directory/'workspace.json', data)]:
        temporary = path.with_suffix(path.suffix + '.tmp')
        temporary.write_text(content)
        temporary.replace(path)
    return project


def new_model(directory: Path, templates: Path, name: str, template: str = 'blank') -> Project:
    if template not in {'blank', 'dc', 'foc', 'buck'}:
        raise ValueError('Unknown model template.')
    name = name.strip()
    if not name: raise ValueError('Enter a model name.')
    if template == 'blank':
        data = {'version':1,'name':name,'duration':1,'revision':0,'blocks':[],'wires':[],'junctions':[],'nets':[]}
    else:
        data = json.loads((templates/f'{template}.json').read_text())
    names = {p.name for p in saved_models(directory).values()}
    unique, number = name, 2
    while unique in names:
        unique = f'{name} ({number})'
        number += 1
    data.update(name=unique,modelId=uuid.uuid4().hex,revision=0)
    return save(directory, document(data))
