"""Every text file the backend and tools read or write is UTF-8, whatever the OS locale.

Windows defaults to a legacy code page, so a bare read_text() or open() breaks on names
like "100 µF capacitor". Pass encoding='utf-8' (or open in binary mode).
"""
import ast
import subprocess
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def mode_of(call: ast.Call, index: int):
    for keyword in call.keywords:
        if keyword.arg == 'mode':
            return keyword.value
    return call.args[index] if len(call.args) > index else None


def is_binary(mode) -> bool:
    return isinstance(mode, ast.Constant) and isinstance(mode.value, str) and 'b' in mode.value


def unencoded(tree: ast.AST):
    for call in ast.walk(tree):
        if not isinstance(call, ast.Call) or any(k.arg == 'encoding' for k in call.keywords):
            continue
        func = call.func
        if isinstance(func, ast.Attribute) and func.attr in ('read_text', 'write_text'):
            yield call
        elif isinstance(func, ast.Name) and func.id == 'open' and not is_binary(mode_of(call, 1)):
            yield call
        elif isinstance(func, ast.Attribute) and func.attr == 'fdopen' and not is_binary(mode_of(call, 1)):
            yield call
        elif (isinstance(func, ast.Attribute) and func.attr == 'open'
              and isinstance(func.value, (ast.Name, ast.BinOp, ast.Call, ast.Attribute))
              and ast.unparse(func.value) not in ('os', 'webbrowser')
              and not is_binary(mode_of(call, 0))):
            yield call
        elif any(k.arg in ('text', 'universal_newlines') and isinstance(k.value, ast.Constant) and k.value.value is True
                 for k in call.keywords):
            yield call


def test_text_io_names_its_encoding():
    files = subprocess.run(['git', 'ls-files', '*.py'], cwd=ROOT, capture_output=True, text=True,
                           check=True, encoding='utf-8').stdout.split()
    found = [f'{name}:{call.lineno}'
             for name in files
             for call in unencoded(ast.parse((ROOT/name).read_text(encoding='utf-8')))]
    assert not found, "pass encoding='utf-8' at: " + ', '.join(found)
