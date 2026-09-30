# SPDX-License-Identifier: Apache-2.0
"""Print the Debian packages whose libraries the Linux engine bundle must carry.

Walks Depends/Pre-Depends from the given roots with `apt-cache show`, taking the
first alternative of each choice, and stops at the system libraries every
supported distribution has (glibc, the gcc runtime, zlib, OpenSSL). Output is
deterministic: it does not depend on what the build machine has installed.
"""
import re
import subprocess
import sys

# Provided by every system Gradara supports; bundling them would shadow the
# system's own (and newer) copies.
SYSTEM = {'libc6', 'libgcc-s1', 'libstdc++6', 'zlib1g', 'libssl3', 'libssl3t64', 'libcrypt1', 'libzstd1',
          'liblzma5', 'libc-bin', 'debconf', 'debconf-2.0', 'cdebconf', 'dpkg', 'perl-base', 'adduser',
          'libselinux1', 'libpcre2-8-0', 'libgcc1', 'gcc-12-base', 'gcc-11-base', 'gcc-14-base'}


def show(package: str) -> dict | None:
    out = subprocess.run(['apt-cache', 'show', '--no-all-versions', package], capture_output=True, text=True, encoding='utf-8', errors='replace').stdout
    if not out.strip():
        return None
    fields, key = {}, None
    for line in out.split('\n\n')[0].splitlines():
        if line[:1] in (' ', '\t') and key:
            fields[key] += ' ' + line.strip()
        elif ':' in line:
            key, value = line.split(':', 1)
            fields[key] = value.strip()
    return fields


def provider(name: str) -> str | None:
    """A real package for a (possibly virtual) name."""
    if show(name):
        return name
    out = subprocess.run(['apt-cache', 'showpkg', name], capture_output=True, text=True, encoding='utf-8', errors='replace').stdout
    section = out.split('Reverse Provides:', 1)[-1].strip().splitlines()
    return section[0].split()[0] if section and section[0].strip() else None


def main(roots: list[str]) -> None:
    seen: set[str] = set()
    todo = list(roots)
    while todo:
        name = todo.pop()
        if name in seen or name in SYSTEM:
            continue
        real = provider(name)
        if real is None or real in SYSTEM:
            seen.add(name)
            continue
        seen.add(name)
        seen.add(real)
        fields = show(real) or {}
        for field in ('Pre-Depends', 'Depends'):
            for choice in filter(None, (c.strip() for c in fields.get(field, '').split(','))):
                first = re.split(r'\s*\|\s*', choice)[0]
                dep = re.sub(r'\s*\(.*?\)|:\S+', '', first).strip()
                if dep and dep not in seen:
                    todo.append(dep)
    for name in sorted(n for n in seen if n not in SYSTEM and show(n)):
        print(name)


if __name__ == '__main__':
    main(sys.argv[1:])
