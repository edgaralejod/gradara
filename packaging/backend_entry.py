# SPDX-License-Identifier: Apache-2.0
"""Entry point for the bundled local service (PyInstaller and desktop dev mode)."""
from __future__ import annotations

import argparse
import multiprocessing
import os
import sys
from pathlib import Path

if not getattr(sys, 'frozen', False):
    sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

# A personal-feature layer (chosen and checked by the desktop shell) carries a
# complete `server` package. Placed first on the import path, it replaces the
# bundled one; bundled dependencies still come from the app. The shell starts the
# shipped code again if the layered service does not become healthy.
_layer = os.environ.get('GRADARA_LAYER_DIR')
if _layer and (Path(_layer)/'server'/'__init__.py').is_file():
    sys.path.insert(0, _layer)


def main() -> None:
    parser = argparse.ArgumentParser(description='Gradara local service')
    parser.add_argument('--port', type=int, default=int(os.environ.get('GRADARA_PORT', '8765')))
    args = parser.parse_args()
    os.environ['GRADARA_PORT'] = str(args.port)
    from server.paths import restore_library_path
    restore_library_path()  # before anything starts a program (OpenModelica, gcc, Codex)
    import uvicorn
    from server.app import app
    # Loopback only. Access logs are off: they add noise and nothing useful locally.
    uvicorn.run(app, host='127.0.0.1', port=args.port, access_log=False, log_level='info')


if __name__ == '__main__':
    multiprocessing.freeze_support()
    main()
