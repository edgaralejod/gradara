#!/usr/bin/env python3
"""Build server/msl_index.json from a Modelica Standard Library 4.1.0 checkout.

The index lists the MSL classes Gradara may instantiate as library blocks, with
their modifiable parameters and their connectors (name, direction, domain). The
emitter refuses any class not in the index, and tests check every wrapper block
against it, so a typo in a class, parameter, or connector fails without running
OpenModelica.

    git clone --depth 1 --branch v4.1.0 https://github.com/modelica/ModelicaStandardLibrary msl
    python3 scripts/msl-index.py msl/Modelica > server/msl_index.json

The parser is deliberately small: it understands class headers, extends,
imports, parameter declarations, and component declarations, which is all the
index needs from MSL's regular formatting.
"""
from __future__ import annotations

import json
import re
import sys
from pathlib import Path

PACKAGES = (
    'Modelica.Electrical.Analog', 'Modelica.Electrical.Polyphase', 'Modelica.Electrical.Machines',
    'Modelica.Electrical.PowerConverters', 'Modelica.Mechanics.Rotational', 'Modelica.Mechanics.Translational',
    'Modelica.Thermal.HeatTransfer', 'Modelica.Magnetic.FluxTubes', 'Modelica.Blocks', 'Modelica.Electrical.Batteries',
)
SKIP = ('.Examples', '.Interfaces', '.Internal', '.BaseClasses', '.Icons', '.UsersGuide', '.Types', '.Utilities',
        '.Functions', '.Records', '.Tables', '.Material', '.Shapes', '.Losses', 'Machines.Thermal', '.ThermalAmbient')

HEADER = re.compile(r'^\s*(?:(?:redeclare|replaceable|encapsulated|final|inner|outer)\s+)*(partial\s+)?'
                    r'(?:operator\s+|expandable\s+|pure\s+|impure\s+)*'
                    r'(model|block|connector|record|package|class|type|function)\s+([A-Za-z_]\w*)\b(.*)$')
END = re.compile(r'^\s*end\s+([A-Za-z_]\w*)\s*;')


class Cls:
    def __init__(self, path, kind, partial, header_rest):
        self.path, self.kind, self.partial = path, kind, partial
        self.lines: list[str] = []
        self.short = None
        rest = header_rest.strip()
        if rest.startswith('='):
            self.short = rest[1:].strip()


def clean(text: str) -> str:
    """Drop comments and replace string literals with "" in one pass (strings may contain //)."""
    out, i, n = [], 0, len(text)
    while i < n:
        ch = text[i]
        if ch == '"':
            i += 1
            while i < n and text[i] != '"':
                i += 2 if text[i] == '\\' else 1
            out.append('""')
            i += 1
        elif text.startswith('//', i):
            while i < n and text[i] != '\n':
                i += 1
        elif text.startswith('/*', i):
            end = text.find('*/', i + 2)
            i = n if end < 0 else end + 2
            out.append(' ')
        else:
            out.append(ch)
            i += 1
    return ''.join(out)


def scan(root: Path) -> dict[str, Cls]:
    classes: dict[str, Cls] = {}
    for file in sorted(root.rglob('*.mo')):
        text = clean(file.read_text(encoding='utf-8', errors='replace'))
        within = re.search(r'^\s*within\s+([\w.]*)\s*;', text, re.M)
        prefix = within.group(1) if within else ''
        stack: list[Cls] = []
        for line in text.splitlines():
            m = HEADER.match(line)
            if m and not line.strip().startswith('end '):
                parent = stack[-1].path if stack else prefix
                cls = Cls(f'{parent}.{m.group(3)}' if parent else m.group(3), m.group(2), bool(m.group(1)), m.group(4))
                classes[cls.path] = cls
                if cls.short is not None:
                    continue  # short class definition: no body
                stack.append(cls)
                continue
            e = END.match(line)
            if e and stack and stack[-1].path.rsplit('.', 1)[-1] == e.group(1):
                stack.pop()
                continue
            if stack:
                stack[-1].lines.append(line)
    return classes


def imports_of(cls: Cls) -> dict[str, str]:
    found = {}
    for line in cls.lines:
        m = re.match(r'\s*import\s+(\w+)\s*=\s*([\w.]+)\s*;', line)
        if m:
            found[m.group(1)] = m.group(2)
            continue
        m = re.match(r'\s*import\s+([\w.]+)\s*;', line)
        if m:
            found[m.group(1).split('.')[-1]] = m.group(1)
    return found


def resolve(classes, scope: str, name: str) -> str | None:
    name = name.lstrip('.')
    if name.startswith('Modelica.'):
        return name if name in classes else None
    parts = scope.split('.')
    first = name.split('.')[0]
    for i in range(len(parts), 0, -1):
        enclosing = '.'.join(parts[:i])
        cls = classes.get(enclosing)
        if cls:
            imp = imports_of(cls)
            if first in imp:
                candidate = imp[first] + name[len(first):]
                if candidate in classes:
                    return candidate
        candidate = f'{enclosing}.{name}'
        if candidate in classes:
            return candidate
    return name if name in classes else None


def body(cls: Cls) -> str:
    text = '\n'.join(cls.lines)
    # Only the declaration section matters.
    return re.split(r'^\s*(?:initial\s+)?(?:equation|algorithm)\b', text, flags=re.M)[0]


def statements(text: str):
    depth, current = 0, []
    for ch in text:
        if ch in '({[':
            depth += 1
        elif ch in ')}]':
            depth -= 1
        if ch == ';' and depth == 0:
            yield ''.join(current).strip()
            current = []
        else:
            current.append(ch)


def connector_domain(classes, path: str) -> tuple[str, str] | None:
    """(domain, direction) for connector classes Gradara can wire."""
    table = [
        ('Modelica.Blocks.Interfaces.RealInput', ('signal', 'input')),
        ('Modelica.Blocks.Interfaces.RealOutput', ('signal', 'output')),
        ('Modelica.Blocks.Interfaces.BooleanInput', ('boolean', 'input')),
        ('Modelica.Blocks.Interfaces.BooleanOutput', ('boolean', 'output')),
        ('Modelica.Electrical.Analog.Interfaces.', ('electrical', 'physical')),
        ('Modelica.Electrical.Polyphase.Interfaces.', ('threePhase', 'physical')),
        ('Modelica.Mechanics.Rotational.Interfaces.', ('mechanical', 'physical')),
        ('Modelica.Mechanics.Translational.Interfaces.', ('translational', 'physical')),
        ('Modelica.Thermal.HeatTransfer.Interfaces.', ('thermal', 'physical')),
        ('Modelica.Magnetic.FluxTubes.Interfaces.', ('magnetic', 'physical')),
    ]
    for prefix, result in table:
        if path == prefix or (prefix.endswith('.') and path.startswith(prefix)):
            return result
    return None


def top_level_finals(stmt: str) -> list[str]:
    start = stmt.find('(')
    if start < 0:
        return []
    depth, names, token = 0, [], []
    for ch in stmt[start:]:
        if ch == '(':
            depth += 1
            if depth == 1:
                continue
        elif ch == ')':
            depth -= 1
        if depth == 1 and ch == ',':
            names.append(''.join(token)); token = []
        elif depth == 1:
            token.append(ch)
    names.append(''.join(token))
    return [m.group(1) for part in names if (m := re.match(r'\s*final\s+(\w+)\s*=', part))]


def describe(classes, path: str, seen=None) -> dict:
    seen = seen or set()
    if path in seen:
        return {'parameters': {}, 'connectors': {}}
    seen.add(path)
    cls = classes[path]
    result = {'parameters': {}, 'connectors': {}}
    if cls.short:
        base = re.match(r'([\w.]+)', cls.short)
        if base:
            target = resolve(classes, path.rsplit('.', 1)[0], base.group(1))
            if target:
                return describe(classes, target, seen)
        return result
    hidden = False
    for stmt in statements(body(cls)):
        stmt = re.sub(r'\s+', ' ', stmt.replace('""', ' ')).strip()
        while True:
            m = re.match(r'(protected|public)\b\s*(.*)', stmt)
            if not m:
                break
            hidden, stmt = m.group(1) == 'protected', m.group(2)
        if hidden:
            continue
        m = re.match(r'extends ([\w.]+)', stmt)
        if m:
            target = resolve(classes, path, m.group(1))
            if target:
                inherited = describe(classes, target, seen)
                # A top-level `final x = ...` in the extends modifier fixes an inherited parameter.
                for name in top_level_finals(stmt):
                    inherited['parameters'].pop(name, None)
                for name, value in inherited['parameters'].items():
                    result['parameters'].setdefault(name, value)
                result['connectors'].update(inherited['connectors'])
            continue
        m = re.match(r'(?:(?:replaceable|redeclare|inner|outer|protected|public) )*(final )?parameter ([\w.]+)(\[[^\]]*\])? (.*)', stmt)
        if m:
            if m.group(1):
                continue
            decl = re.sub(r'\([^()]*(?:\([^()]*\)[^()]*)*\)', '', m.group(4))
            for part in decl.split(','):
                name = re.match(r'\s*(\w+)(\[[^\]]*\])?', part)
                if name:
                    array = bool(m.group(3) or name.group(2))
                    result['parameters'][name.group(1)] = {'type': m.group(2) + ('[]' if array else '')}
            continue
        m = re.match(r'(?:(?:input|output|flow|stream|discrete|inner|outer|replaceable) )*([A-Z][\w.]*)(\[[^\]]*\])?(?:\([^;]*?\))? (\w+)(\[[^\]]*\])?(.*)', stmt)
        if m:
            target = resolve(classes, path, m.group(1))
            if target and classes[target].kind == 'connector':
                domain = connector_domain(classes, target)
                if domain:
                    conditional = bool(re.search(r'\bif\b', m.group(5)))
                    array = bool(m.group(2) or m.group(4))
                    result['connectors'][m.group(3)] = {'type': target, 'domain': domain[0], 'direction': domain[1],
                                                        'conditional': conditional, 'array': array}
    return result


def main():
    root = Path(sys.argv[1])
    classes = scan(root.parent if root.name == 'Modelica' else root)
    index = {}
    for path, cls in sorted(classes.items()):
        if cls.partial or cls.kind not in ('model', 'block') or not path.startswith(PACKAGES):
            continue
        if any(part in path for part in SKIP):
            continue
        info = describe(classes, path)
        if not info['connectors']:
            continue
        index[path] = {'parameters': {k: v['type'] for k, v in sorted(info['parameters'].items())},
                       'connectors': {k: [v['domain'], v['direction']] + (['conditional'] if v['conditional'] else [])
                                      + (['array'] if v['array'] else [])
                                      for k, v in sorted(info['connectors'].items())}}
    json.dump({'msl': '4.1.0', 'classes': index}, sys.stdout, indent=0, sort_keys=True, separators=(',', ':'))
    sys.stdout.write('\n')


if __name__ == '__main__':
    main()
