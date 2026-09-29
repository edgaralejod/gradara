# SPDX-License-Identifier: Apache-2.0
"""Copy the parts of an OpenModelica Windows installation that Gradara needs.

The official installer carries OMEdit, Qt, Boost, Python, LLVM and most of
MSYS2 (about 9 GB). Simulating from a script needs far less: omc and the DLLs
it and the simulation runtime load, OpenModelica's headers and libraries, and
the MSYS2 ucrt64 C toolchain (gcc, make, OpenBLAS) that Compile.bat drives.

    python trim_windows.py --om C:\\OM --out build\\engine [--objdump PATH]

Selection:
- OpenModelica's own `bin`: omc.exe, the runtime DLLs simulations link
  against (those with an import library in lib/omc), and every DLL they load,
  found by reading PE import tables.
- `tools/msys`: the MSYS2 packages (from its pacman database) that provide the
  C toolchain and those DLLs, with their dependency closure, plus a minimal
  MSYS base (sh, coreutils) for the makefiles.
- `include/omc`, `lib/omc`, `share/omc` in full, less the C++ and FMI-export
  runtimes Gradara does not use.
"""
from __future__ import annotations

import argparse
import json
import os
import re
import shutil
import subprocess
from pathlib import Path

# MSYS2 packages the C toolchain needs (dependencies are added from the database).
TOOLCHAIN = ['mingw-w64-ucrt-x86_64-gcc', 'mingw-w64-ucrt-x86_64-make', 'mingw-w64-ucrt-x86_64-openblas',
             'mingw-w64-ucrt-x86_64-gcc-libgfortran', 'mingw-w64-ucrt-x86_64-expat']
MSYS_BASE = ['bash', 'coreutils', 'msys2-runtime', 'sed', 'grep']
# Parts of OpenModelica Gradara never uses: the C++/OMSI targets, the GUI tools'
# static libraries (OMEdit, OMPlot/Qwt, OMOptim, OMSimulator), dynamic
# optimization (Ipopt), and a second copy of the compiler DLL (omc loads bin/).
SKIP_OM = re.compile(r'^(lib/omc/(cpp|omsicpp|omsi|omsic)/|include/omc/(cpp|omsicpp|omsi|omsic)/|share/doc/'
                     r'|lib/omc/[^/]*\.dll$'
                     r'|lib/omc/lib(omqwt|OMSimulator|OMOptim|OMPlot|OMParser|omcfrontendcpp|OpenCL|ParModelica'
                     r'|antlr4|ipopt|colpack|OMCDLL)[^/]*$)', re.I)
# The simulation runtime and what it loads; other DLLs in bin/ belong to the GUI tools.
RUNTIME_ROOTS = ['omc.exe', 'libSimulationRuntimeC.dll', 'libOpenModelicaRuntimeC.dll', 'libomcgc-1.dll']
# Toolchain files not needed to compile C: the C++ and LTO compilers, C++ headers.
SKIP_MSYS = re.compile(r'^ucrt64/(lib/gcc/[^/]+/[^/]+/(cc1plus|lto1)\.exe|include/c\+\+/|share/(doc|man|info|locale)/)', re.I)
SYSTEM_DLL = re.compile(r'^(api-ms-win-|ext-ms-)|^(kernel32|user32|advapi32|ws2_32|shell32|ole32|oleaut32|gdi32|'
                        r'msvcrt|ucrtbase|ntdll|bcrypt|crypt32|secur32|shlwapi|comdlg32|winmm|version|iphlpapi|'
                        r'dbghelp|psapi|userenv|rpcrt4|mswsock|comctl32|imm32|setupapi|cfgmgr32|dnsapi|'
                        r'normaliz|wldap32|netapi32|ncrypt|winhttp|dwrite|d3d11|dxgi|opengl32|uxtheme|'
                        r'dwmapi|mpr|wtsapi32|authz|powrprof|hid|winspool\.drv)\.dll$', re.I)


def pe_imports(path: Path, objdump: str) -> list[str]:
    out = subprocess.run([objdump, '-p', str(path)], capture_output=True, text=True, errors='replace').stdout
    return re.findall(r'DLL Name:\s*(\S+)', out)


def read_packages(msys: Path) -> dict[str, dict]:
    packages = {}
    for folder in (msys/'var'/'lib'/'pacman'/'local').iterdir():
        desc = folder/'desc'
        if not desc.exists():
            continue
        fields, key = {}, None
        for line in desc.read_text(encoding='utf-8', errors='replace').splitlines():
            if line.startswith('%') and line.endswith('%'):
                key = line.strip('%')
                fields[key] = []
            elif line and key:
                fields[key].append(line)
        files = []
        listing = folder/'files'
        if listing.exists():
            section = None
            for line in listing.read_text(encoding='utf-8', errors='replace').splitlines():
                if line.startswith('%'):
                    section = line
                elif line and section == '%FILES%' and not line.endswith('/'):
                    files.append(line)
        name = (fields.get('NAME') or [folder.name])[0]
        packages[name] = {'depends': fields.get('DEPENDS', []), 'provides': fields.get('PROVIDES', []),
                          'files': files, 'version': (fields.get('VERSION') or [''])[0],
                          'license': fields.get('LICENSE', []), 'url': (fields.get('URL') or [''])[0]}
    return packages


def closure(packages: dict[str, dict], roots: list[str]) -> set[str]:
    provided = {}
    for name, info in packages.items():
        for entry in info['provides']:
            provided.setdefault(re.split(r'[<>=]', entry)[0], name)
    keep, todo = set(), list(roots)
    while todo:
        name = re.split(r'[<>=]', todo.pop())[0].strip()
        real = name if name in packages else provided.get(name)
        if not real or real in keep:
            continue
        keep.add(real)
        todo.extend(packages[real]['depends'])
    return keep


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument('--om', required=True, type=Path)
    parser.add_argument('--out', required=True, type=Path)
    parser.add_argument('--objdump', default=None)
    args = parser.parse_args()
    om, out = args.om.resolve(), args.out.resolve()
    msys = om/'tools'/'msys'
    ucrt_bin = msys/'ucrt64'/'bin'
    objdump = args.objdump or (str(ucrt_bin/'objdump.exe') if (ucrt_bin/'objdump.exe').exists() else 'objdump')
    packages = read_packages(msys)
    owner = {}
    for name, info in packages.items():
        for f in info['files']:
            owner[f.lower()] = name

    # 1. DLL closure from omc.exe and the linkable runtime DLLs.
    om_bin = om/'bin'
    roots = [om_bin/name for name in RUNTIME_ROOTS if (om_bin/name).exists()]
    search = [om_bin, ucrt_bin]
    found: dict[str, Path] = {}
    todo = list(roots)
    missing = set()
    while todo:
        path = todo.pop()
        key = path.name.lower()
        if key in found:
            continue
        found[key] = path
        for dll in pe_imports(path, objdump):
            if dll.lower() in found or SYSTEM_DLL.search(dll):
                continue
            hit = next((d/dll for d in search if (d/dll).exists()), None)
            if hit is None:
                hit = next((p for d in search for p in d.glob('*.dll') if p.name.lower() == dll.lower()), None)
            if hit is None:
                missing.add(dll)
            else:
                todo.append(hit)

    # 2. MSYS2 packages: the toolchain, whatever owns a DLL we load, and a small shell base.
    wanted = list(TOOLCHAIN) + list(MSYS_BASE)
    for key, path in found.items():
        if path.parent == ucrt_bin:
            name = owner.get(f'ucrt64/bin/{path.name}'.lower())
            if name:
                wanted.append(name)
    keep_packages = closure(packages, wanted)

    if out.exists():
        shutil.rmtree(out)
    copied = 0

    def copy(src: Path, rel: str) -> None:
        nonlocal copied
        dst = out/rel
        dst.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(src, dst)
        copied += src.stat().st_size

    for key, path in found.items():
        if path.parent == om_bin:
            copy(path, f'bin/{path.name}')
    for sub in ('include/omc', 'lib/omc', 'share/omc'):
        base = om/sub
        for path in base.rglob('*'):
            rel = path.relative_to(om).as_posix()
            if path.is_file() and not SKIP_OM.search(rel + ('/' if path.is_dir() else '')):
                copy(path, rel)
    om_dlls = {p.name.lower() for p in found.values() if p.parent == om_bin}
    all_files = {f.lower() for name in keep_packages for f in packages[name]['files']}
    for name in sorted(keep_packages):
        for f in packages[name]['files']:
            src = msys/f
            if not src.is_file() or SKIP_MSYS.search(f):
                continue
            # Static archives beside an import library: simulations link dynamically.
            if f.endswith('.a') and not f.endswith('.dll.a') and f[:-2].lower() + '.dll.a' in all_files:
                continue
            # OpenBLAS is loaded only by simulations, which find OpenModelica's copy in bin/.
            if f.lower() == 'ucrt64/bin/libopenblas.dll' and 'libopenblas.dll' in om_dlls:
                continue
            copy(src, f'tools/msys/{f}')
    for extra in ('OSMC-License.txt', 'COPYING'):
        if (om/extra).exists():
            copy(om/extra, extra)

    inventory = [{'name': n, 'version': packages[n]['version'], 'license': ' '.join(packages[n]['license']),
                  'url': packages[n]['url']} for n in sorted(keep_packages)]
    (out/'packages.json').write_text(json.dumps(inventory, indent=1), encoding='utf-8')
    print(f'OpenModelica DLLs: {sum(1 for p in found.values() if p.parent == om_bin)}, '
          f'MSYS2 packages: {len(keep_packages)}, copied {copied / 1e6:.0f} MB')
    if missing:
        print('Imports not found (system DLLs?):', ', '.join(sorted(missing)))


if __name__ == '__main__':
    main()
