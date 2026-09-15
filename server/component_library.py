"""Local, immutable reusable definitions; models always retain embedded copies."""
import hashlib
import json
from datetime import datetime, timezone
from pathlib import Path
from .models import Definition
from .workspace import atomic_write, saved_models


def save_component(directory: Path, definition: Definition, checked: bool = True):
    if not definition.generated:
        raise ValueError('Only generated definitions belong in the AI library.')
    content = definition.model_dump(exclude_none=True)
    key = 'ai_' + hashlib.sha256(json.dumps(content, sort_keys=True, separators=(',', ':')).encode()).hexdigest()
    path = directory/'components'/f'{key}.json'
    if path.exists():
        entry = json.loads(path.read_text())
        if checked and not entry['checked']:
            entry['checked'] = True
            atomic_write(path, json.dumps(entry, indent=2))
        return entry
    entry = dict(id=key, definition=content, checked=checked, createdAt=datetime.now(timezone.utc).isoformat())
    atomic_write(path, json.dumps(entry, indent=2))
    return entry


def list_components(directory: Path):
    # Recover existing user-authored blocks once, without claiming a new compiler check.
    marker = directory/'components'/'.imported-models'
    if not marker.exists():
        for project in saved_models(directory).values():
            for block in project.blocks:
                if block.definition.generated:
                    save_component(directory, block.definition, checked=False)
        atomic_write(marker, '1')
    entries = [json.loads(p.read_text()) for p in (directory/'components').glob('ai_*.json')]
    return sorted(entries, key=lambda entry: entry['createdAt'], reverse=True)
