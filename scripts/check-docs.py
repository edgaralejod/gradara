#!/usr/bin/env python3
"""Check relative Markdown file links in tracked and non-ignored repo files."""
from pathlib import Path
import re
import subprocess
import sys
from urllib.parse import unquote, urlsplit

ROOT = Path(__file__).resolve().parent.parent


def main():
    paths = subprocess.check_output(
        ['git', 'ls-files', '--cached', '--others', '--exclude-standard', '-z'], cwd=ROOT,
    ).decode().split('\0')
    failures = []
    count = 0
    # Deliberately small: inline links and reference definitions, not a Markdown parser.
    inline = re.compile(r'!?\[[^\]\n]*\]\(\s*(?:<([^>]+)>|([^\s)]+))')
    reference = re.compile(r'^\s*\[[^\]]+\]:\s*(?:<([^>]+)>|(\S+))', re.MULTILINE)
    for name in sorted(set(paths)):
        path = ROOT / name
        if path.suffix.lower() != '.md' or not path.is_file():
            continue
        count += 1
        text = re.sub(r'^(```|~~~).*?^\1[^\n]*$', '', path.read_text(encoding='utf-8'),
                      flags=re.MULTILINE | re.DOTALL)
        for pattern in (inline, reference):
            for match in pattern.finditer(text):
                target = match.group(1) or match.group(2)
                url = urlsplit(target)
                if url.scheme or url.netloc or not url.path:
                    continue
                destination = (path.parent / unquote(url.path)).resolve()
                if not destination.is_relative_to(ROOT) or not destination.exists():
                    failures.append(f'{name}: missing or non-portable link: {target}')
    for failure in failures:
        print(failure, file=sys.stderr)
    print(f'Checked local file links in {count} Markdown files; {len(failures)} problems.')
    return bool(failures)


if __name__ == '__main__':
    sys.exit(main())
