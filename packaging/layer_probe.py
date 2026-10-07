# SPDX-License-Identifier: Apache-2.0
"""Turn an unpacked layer into a probe for the loading test (CI only, never shipped).

Adds a module the frozen base does not contain, and an endpoint that imports it,
so the smoke test proves that the bundled service runs the layer's `server`
package and not its own: the failure the layer design has to rule out on
macOS, Windows and Linux.
"""
from __future__ import annotations

import sys
from pathlib import Path

MARKER = '# ------------------------------------------------------ installed workbench'


def main() -> None:
    layer = Path(sys.argv[1])
    server = layer/'server'
    (server/'layer_probe.py').write_text(
        '"""Present only in the loading test\'s layer."""\n'
        'import json\n\n\n'
        'def probe() -> dict:\n'
        '    return {"probe": "loaded from the layer", "json": json.dumps([1])}\n',
        encoding='utf-8')
    app = (server/'app.py').read_text(encoding='utf-8')
    if MARKER not in app:
        raise SystemExit('server/app.py has no workbench marker to insert the probe before.')
    route = ('@app.get("/api/layer-probe")\n'
             'async def layer_probe():\n'
             '    from .layer_probe import probe\n'
             '    return probe()\n\n')
    (server/'app.py').write_text(app.replace(MARKER, route + MARKER, 1), encoding='utf-8')
    print(f'Probe added to {layer}')


if __name__ == '__main__':
    main()
