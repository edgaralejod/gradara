# SPDX-License-Identifier: Apache-2.0
"""Stored runs on this computer: read one run at full resolution, and the files kept beside it."""
from __future__ import annotations

import csv
import json
import math
import threading
from collections import OrderedDict
from pathlib import Path

from .paths import RUNS


class RunUnavailable(LookupError):
    """The run does not exist, or its full data is gone."""


def folder_of(run_id: str, runs: Path | None = None) -> Path:
    if not run_id or not run_id.isalnum():
        raise RunUnavailable('Invalid run ID.')
    return (runs or RUNS)/run_id


def run_name(folder: Path) -> str:
    """The name the user gave a stored run; empty when it has none."""
    try:
        name = json.loads((folder/'meta.json').read_text(encoding='utf-8')).get('name', '')
    except (OSError, ValueError, AttributeError):
        return ''
    return name if isinstance(name, str) else ''


def model_of(result: dict) -> str:
    """The model a stored result belongs to (runs saved before model IDs existed get a legacy ID)."""
    snapshot = result.get('snapshot', {})
    return snapshot.get('modelId') or f"legacy-{snapshot.get('exampleId') or 'workspace'}"


# A few recently read runs: the Run summary and Explain results read the same runs again and again.
_CACHE: OrderedDict = OrderedDict()
_CACHE_SIZE = 6
_LOCK = threading.Lock()


def _stamp(folder: Path) -> tuple:
    return tuple((folder/name).stat().st_mtime_ns if (folder/name).exists() else 0
                 for name in ('result.json', 'simulation_res.csv', 'meta.json'))


def load_full(run_id: str, runs: Path | None = None) -> dict:
    """The stored result with every sample of every series, as the solver wrote it.

    Rows beyond the requested stop time (DASSL can write one) are dropped, as
    when the run finished. Raises RunUnavailable or ValueError. The caller gets
    its own dictionaries, but the sample lists are shared with the cache: never
    change them in place.
    """
    folder = folder_of(run_id, runs)
    if not (folder/'result.json').exists() or not (folder/'simulation_res.csv').exists():
        raise RunUnavailable('Results are unavailable.')
    key = (str(folder), _stamp(folder))
    with _LOCK:
        if key in _CACHE:
            _CACHE.move_to_end(key)
            return _copy(_CACHE[key])
    result = _read(folder)
    with _LOCK:
        _CACHE[key] = result
        while len(_CACHE) > _CACHE_SIZE:
            _CACHE.popitem(last=False)
    return _copy(result)


def _copy(result: dict) -> dict:
    return {**result, 'series': [dict(s) for s in result['series']]}


def _read(folder: Path) -> dict:
    result = json.loads((folder/'result.json').read_text(encoding='utf-8'))
    with (folder/'simulation_res.csv').open(encoding='utf-8') as stream:
        rows = [row for row in csv.DictReader(stream)
                if float(row['time']) <= result['duration'] + max(1e-12, result['duration']*1e-12)]
    result['time'] = [float(row['time']) for row in rows]
    from .engine import result_columns
    column = result_columns(folder, rows)  # constants and aliases are not CSV columns
    for series in result['series']:
        values = column(series['key'])
        if values is None:
            raise ValueError(f"Stored results lack {series['key']}.")
        series['values'] = values
    if not all(math.isfinite(v) for v in result['time']) or not all(math.isfinite(v) for s in result['series'] for v in s['values']):
        raise ValueError('Non-finite samples in stored results.')
    result['name'] = run_name(folder)
    result['finished'] = round((folder/'result.json').stat().st_mtime * 1000)
    return result
