# SPDX-License-Identifier: Apache-2.0
"""Make command-line tools discoverable when Gradara starts from a GUI.

Apps opened from Finder, the Start menu, or a Linux desktop launcher do not
inherit the PATH a terminal would have, so Docker, Colima, OrbStack, and
OpenModelica can look missing even when installed. Append their conventional
locations (never prepend, so an explicit user PATH still wins).
"""
from __future__ import annotations

import glob
import os
import sys
from pathlib import Path


def candidate_dirs() -> list[str]:
    home = Path.home()
    if sys.platform == 'darwin':
        return ['/opt/homebrew/bin', '/usr/local/bin', str(home/'.orbstack'/'bin'),
                '/Applications/Docker.app/Contents/Resources/bin', '/opt/openmodelica/bin',
                str(home/'.colima'/'bin'), '/usr/bin', '/bin', '/usr/sbin', '/sbin']
    if os.name == 'nt':
        dirs = [r'C:\Program Files\Docker\Docker\resources\bin']
        home_om = os.environ.get('OPENMODELICAHOME')
        if home_om:
            dirs.append(str(Path(home_om)/'bin'))
        dirs += sorted(glob.glob(r'C:\Program Files\OpenModelica*\bin'), reverse=True)
        return dirs
    return ['/usr/local/bin', '/usr/bin', '/bin', '/snap/bin', str(home/'.local'/'bin')]


def extend_path() -> None:
    current = os.environ.get('PATH', '').split(os.pathsep) if os.environ.get('PATH') else []
    additions = [d for d in candidate_dirs() if d not in current and os.path.isdir(d)]
    if additions:
        os.environ['PATH'] = os.pathsep.join(current + additions)
