#!/usr/bin/env python3
"""Check that documentation still matches the repository.

Runs in Core CI (documentation-and-hygiene). Each check is deliberately small
and literal so a failure points at one line to fix:

- relative Markdown links resolve to files in the repository;
- backticked repository paths (`server/engines.py`, `cloud/deploy.sh`) exist;
- `npm run <script>` commands exist in package.json or desktop/package.json;
- `cloud/deploy.sh <command>` subcommands exist in the script;
- every GRADARA_* environment variable the code reads is documented somewhere,
  and every GRADARA_* variable the docs mention is still read by the code.
"""
from pathlib import Path
import json
import re
import subprocess
import sys
from urllib.parse import unquote, urlsplit

ROOT = Path(__file__).resolve().parent.parent

# Top-level folders whose backticked paths must be tracked in git (from the repository
# root or the document's own folder). Git-ignored build outputs are allowed. Data folders that only
# exist at run time (projects/, .runtime/, build outputs) are not listed.
PATH_ROOTS = ('app', 'components', 'lib', 'server', 'scripts', 'packaging', 'desktop', 'cloud',
              'site', 'docs', 'models', 'tests', 'patches', '.github', 'hooks', 'public')
BACKTICK_PATH = re.compile(r'`((?:%s)/[A-Za-z0-9_.\-/]*)`' % '|'.join(re.escape(r) for r in PATH_ROOTS))
# Code that reads configuration from the environment.
ENV_SOURCES = ('server/', 'packaging/', 'desktop/main.cjs', 'cloud/gateway/', 'scripts/')
ENV_VAR = re.compile(r'\bGRADARA_[A-Z0-9_]+\b')
FENCE = re.compile(r'^(```|~~~).*?^\1[^\n]*$', re.MULTILINE | re.DOTALL)


def tracked() -> list[str]:
    out = subprocess.check_output(['git', 'ls-files', '--cached', '--others', '--exclude-standard', '-z'], cwd=ROOT)
    return sorted({name for name in out.decode().split('\0') if name and (ROOT/name).is_file()})


def check_links(name: str, text: str) -> list[str]:
    failures = []
    inline = re.compile(r'!?\[[^\]\n]*\]\(\s*(?:<([^>]+)>|([^\s)]+))')
    reference = re.compile(r'^\s*\[[^\]]+\]:\s*(?:<([^>]+)>|(\S+))', re.MULTILINE)
    prose = FENCE.sub('', text)
    for pattern in (inline, reference):
        for match in pattern.finditer(prose):
            target = match.group(1) or match.group(2)
            url = urlsplit(target)
            if url.scheme or url.netloc or not url.path:
                continue
            destination = ((ROOT/name).parent/unquote(url.path)).resolve()
            if not destination.is_relative_to(ROOT) or not destination.exists():
                failures.append(f'{name}: missing or non-portable link: {target}')
    return failures


def in_repo(path: str, files: set[str], folders: set[str]) -> bool:
    """A tracked file or a folder containing tracked files (not whatever is on disk)."""
    return path.rstrip('/') in files or path.rstrip('/') in folders


def ignored(path: str) -> bool:
    """Build outputs and run-time folders (desktop/dist/, projects/) are git-ignored."""
    return subprocess.run(['git', 'check-ignore', '-q', '--no-index', path], cwd=ROOT).returncode == 0


def check_paths(name: str, text: str, files: set[str], folders: set[str]) -> list[str]:
    failures = []
    base = str(Path(name).parent)
    for match in BACKTICK_PATH.finditer(text):
        path = match.group(1).rstrip('.,:;')
        if any(ch in path for ch in '*<>{}'):
            continue  # a pattern or placeholder, not a concrete path
        relative = str(Path(base)/path) if base != '.' else path
        if in_repo(path, files, folders) or in_repo(relative, files, folders) or ignored(path):
            continue
        failures.append(f'{name}: path does not exist in the repository: {path}')
    return failures


def check_commands(name: str, text: str, scripts: set[str], deploy_commands: set[str]) -> list[str]:
    failures = []
    for script in re.findall(r'npm run ([a-z0-9:_\-]+)', text):
        if script not in scripts:
            failures.append(f'{name}: `npm run {script}` is not a script in package.json or desktop/package.json')
    for command in re.findall(r'cloud/deploy\.sh ([a-z]+)', text):
        if command not in deploy_commands:
            failures.append(f'{name}: `cloud/deploy.sh {command}` is not a deploy.sh command')
    return failures


def main() -> int:
    files = tracked()
    docs = [name for name in files if name.endswith('.md')]
    scripts = set(json.loads((ROOT/'package.json').read_text(encoding='utf-8'))['scripts'])
    scripts |= set(json.loads((ROOT/'desktop'/'package.json').read_text(encoding='utf-8'))['scripts'])
    deploy = (ROOT/'cloud'/'deploy.sh').read_text(encoding='utf-8')
    deploy_commands = set(re.findall(r'^\s{2}([a-z]+)\)', deploy, re.MULTILINE))

    file_set = set(files)
    folders = {str(parent) for f in files for parent in Path(f).parents if str(parent) != '.'}
    failures: list[str] = []
    documented: set[str] = set()
    for name in docs:
        text = (ROOT/name).read_text(encoding='utf-8')
        failures += check_links(name, text)
        failures += check_paths(name, text, file_set, folders)
        failures += check_commands(name, text, scripts, deploy_commands)
        documented |= set(ENV_VAR.findall(text))
    documented |= set(ENV_VAR.findall((ROOT/'.env.example').read_text(encoding='utf-8')))

    used: set[str] = set()
    for name in files:
        if name.startswith(ENV_SOURCES) and name.endswith(('.py', '.cjs', '.js', '.ts', '.sh')):
            used |= set(ENV_VAR.findall((ROOT/name).read_text(encoding='utf-8', errors='ignore')))
    for var in sorted(used - documented):
        failures.append(f'{var} is read by the code but not documented (add it to .env.example or a guide)')
    for var in sorted(documented - used):
        failures.append(f'{var} is documented but no longer read by the code (remove or rename it in the docs)')

    for failure in failures:
        print(failure, file=sys.stderr)
    print(f'Checked links, paths, commands, and environment variables in {len(docs)} Markdown files; '
          f'{len(failures)} problems.')
    return 1 if failures else 0


if __name__ == '__main__':
    sys.exit(main())
