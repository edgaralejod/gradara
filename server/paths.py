# SPDX-License-Identifier: Apache-2.0
"""Where Gradara reads bundled resources and writes user data.

Source checkouts keep the historical layout: user data lives in the ignored
`projects/` folder beside the code. Installed desktop builds pass
GRADARA_DATA_DIR (the Electron shell uses the OS application-data folder) and
GRADARA_RESOURCES (read-only files shipped with the app).
"""
from __future__ import annotations

import os
import sys
from pathlib import Path

FROZEN = bool(getattr(sys, 'frozen', False))


def restore_library_path() -> None:
    """Give programs the service starts the library path the user had.

    PyInstaller's Linux bootloader points LD_LIBRARY_PATH at the app's bundled
    libraries (readline, zlib, … from the build machine) and keeps the original in
    LD_LIBRARY_PATH_ORIG. Every child inherits it, so on a newer distribution the
    system's /bin/sh, make, or gcc load those older copies and fail ("symbol lookup
    error" on Arch). This process no longer needs it: the loader reads the variable
    once, at start-up.
    """
    if not FROZEN or not sys.platform.startswith('linux'):
        return
    original = os.environ.pop('LD_LIBRARY_PATH_ORIG', None)
    if original:
        os.environ['LD_LIBRARY_PATH'] = original
    else:
        os.environ.pop('LD_LIBRARY_PATH', None)


def _source_root() -> Path:
    if FROZEN and hasattr(sys, '_MEIPASS'):
        return Path(sys._MEIPASS)  # type: ignore[attr-defined]
    return Path(__file__).resolve().parent.parent


def default_user_data_dir(app: str = 'Gradara') -> Path:
    home = Path.home()
    if sys.platform == 'darwin':
        return home/'Library'/'Application Support'/app/'data'
    if os.name == 'nt':
        base = os.environ.get('APPDATA')
        return (Path(base) if base else home/'AppData'/'Roaming')/app/'data'
    base = os.environ.get('XDG_DATA_HOME')
    return (Path(base) if base else home/'.local'/'share')/app.lower()


ROOT = _source_root()
# A personal-feature layer this service was loaded from (see packaging/backend_entry.py), or None.
LAYER = Path(os.environ['GRADARA_LAYER_DIR']) if os.environ.get('GRADARA_LAYER_DIR') else None


def shipped(*parts: str) -> Path:
    """A data file shipped with the code: the layer's copy when this service runs from a layer."""
    if LAYER is not None and (LAYER.joinpath(*parts)).is_file():
        return LAYER.joinpath(*parts)
    return ROOT.joinpath(*parts)


def layer_info() -> dict | None:
    """The layer's ID, base version and features, for /api/health."""
    if LAYER is None:
        return None
    import json
    try:
        manifest = json.loads((LAYER/'manifest.json').read_text(encoding='utf-8'))
    except (OSError, ValueError):
        return {'id': 'unknown', 'base': '', 'features': []}
    return {'id': manifest.get('id', ''), 'base': manifest.get('base', ''),
            'features': [f.get('title', '') for f in manifest.get('features', []) if isinstance(f, dict)]}


RESOURCES = Path(os.environ.get('GRADARA_RESOURCES') or ROOT)
if os.environ.get('GRADARA_DATA_DIR'):
    DATA = Path(os.environ['GRADARA_DATA_DIR'])
elif FROZEN:
    DATA = default_user_data_dir()
else:
    DATA = ROOT/'projects'

EXAMPLES = RESOURCES/'models'/'examples'
RUNS = DATA/'runs'
AGENT_DIR = DATA/'agent'
EXPORTS = DATA/'exports'
SETTINGS_FILE = DATA/'settings.json'
LOGS = Path(os.environ.get('GRADARA_LOG_DIR') or (DATA/'logs'))
# Built workbench (static files). Only installed builds serve it from FastAPI;
# source checkouts use the Vite dev server.
STATIC = Path(os.environ['GRADARA_STATIC_DIR']) if os.environ.get('GRADARA_STATIC_DIR') else None

for folder in (DATA, RUNS, AGENT_DIR, EXPORTS):
    folder.mkdir(parents=True, exist_ok=True)
