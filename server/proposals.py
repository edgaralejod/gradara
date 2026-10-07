# SPDX-License-Identifier: Apache-2.0
"""The Proposals tab, kept per model on this computer so it survives a model switch and a restart.

The workbench owns the entries (requests, proposals, block and model drafts,
diagnoses, results discussions); this module stores them as one JSON file per
model, bounds their size, and removes discussions of a run when the run is
deleted. Nothing here is sent anywhere.
"""
from __future__ import annotations

import json
import os
import re
import tempfile
from pathlib import Path

from .paths import DATA

MODEL_ID = re.compile(r'^[A-Za-z0-9_-]{1,120}$')
MAX_ENTRIES = 60
MAX_BYTES = 6_000_000


def folder() -> Path:
    return DATA/'proposals'


def path_for(model_id: str) -> Path:
    if not MODEL_ID.fullmatch(model_id or ''):
        raise ValueError('Invalid model ID.')
    return folder()/f'{model_id}.json'


def load(model_id: str) -> list[dict]:
    try:
        data = json.loads(path_for(model_id).read_text(encoding='utf-8'))
    except (OSError, ValueError):
        return []
    entries = data.get('entries') if isinstance(data, dict) else None
    return [e for e in entries if isinstance(e, dict)] if isinstance(entries, list) else []


def bounded(entries: list[dict]) -> list[dict]:
    """The newest entries that fit the limits; the oldest go first."""
    entries = [e for e in entries if isinstance(e, dict)][-MAX_ENTRIES:]
    while entries and len(json.dumps(entries)) > MAX_BYTES:
        entries = entries[1:]
    return entries


def save(model_id: str, entries: list[dict]) -> list[dict]:
    target = path_for(model_id)
    kept = bounded(entries)
    target.parent.mkdir(parents=True, exist_ok=True)
    # Write then rename, so a crash never leaves half a file.
    handle, temporary = tempfile.mkstemp(dir=target.parent, prefix='.proposals-', suffix='.json')
    try:
        with os.fdopen(handle, 'w', encoding='utf-8') as stream:
            json.dump({'entries': kept}, stream)
        os.replace(temporary, target)
    except BaseException:
        Path(temporary).unlink(missing_ok=True)
        raise
    return kept


def forget_run(run_id: str) -> int:
    """Remove every results discussion that involves a deleted run. Returns how many were removed."""
    removed = 0
    if not folder().exists():
        return 0
    for file in folder().glob('*.json'):
        model_id = file.stem
        if not MODEL_ID.fullmatch(model_id):
            continue
        entries = load(model_id)
        kept = [e for e in entries if not (e.get('kind') == 'results' and run_id in (e.get('runIds') or []))]
        if len(kept) != len(entries):
            removed += len(entries) - len(kept)
            save(model_id, kept)
    return removed
