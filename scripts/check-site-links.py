#!/usr/bin/env python3
"""Check that every link between pages of the website resolves.

Pages are resolved the way Firebase Hosting serves them (site/firebase.json:
cleanUrls, no trailing slash, redirects), so a relative link that only works from
a trailing-slash address is caught: `docs/blocks/index.html` is served at
`/docs/blocks`, where `resistor.html` would mean `/docs/resistor.html`.
Run from the repository root: `python3 scripts/check-site-links.py`.
"""
from __future__ import annotations

import json
import re
import sys
from html.parser import HTMLParser
from pathlib import Path
from urllib.parse import urljoin, urlparse

ROOT = Path(__file__).resolve().parents[1]
PUBLIC = ROOT/'site'/'public'
CONFIG = json.loads((ROOT/'site'/'firebase.json').read_text(encoding='utf-8'))['hosting']
ORIGIN = 'https://gradara.app'


class Links(HTMLParser):
    def __init__(self):
        super().__init__()
        self.links: list[str] = []

    def handle_starttag(self, tag, attrs):
        for key, value in attrs:
            if key in ('href', 'src') and value:
                self.links.append(value)


def served_path(file: Path) -> str:
    """The address Firebase serves a file at (cleanUrls, no trailing slash)."""
    rel = '/' + file.relative_to(PUBLIC).as_posix()
    if rel.endswith('/index.html'):
        return rel[: -len('/index.html')] or '/'
    return rel[: -len('.html')] if rel.endswith('.html') else rel


def redirect(path: str) -> str | None:
    for rule in CONFIG.get('redirects', []):
        if 'source' in rule and rule['source'] == path:
            return rule['destination']
        if 'regex' in rule:
            m = re.match(rule['regex'].replace('(?P<', '(?P<'), path)
            if m:
                dest = rule['destination']
                for name, value in m.groupdict().items():
                    dest = dest.replace(f':{name}', value)
                return dest
    return None


def exists(path: str) -> bool:
    for _ in range(5):
        target = redirect(path)
        if target is None:
            break
        path = target
    path = path.rstrip('/') or '/'
    candidates = [path, path + '.html', path + '/index.html'] if path != '/' else ['/index.html']
    if path.endswith('.html'):
        candidates.append(path)
    return any((PUBLIC/c.lstrip('/')).is_file() for c in candidates)


def main() -> int:
    broken = []
    pages = sorted(PUBLIC.rglob('*.html'))
    for page in pages:
        if page.name == '404.html':
            continue
        parser = Links()
        parser.feed(page.read_text(encoding='utf-8'))
        base = ORIGIN + served_path(page)
        for link in parser.links:
            url = urlparse(urljoin(base, link))
            if f'{url.scheme}://{url.netloc}' != ORIGIN or not url.path:
                continue
            if not exists(url.path):
                broken.append(f'{page.relative_to(ROOT)}: {link} -> {url.path}')
    # Addresses that existed before and must keep working.
    # Retired blocks (Scope, Display, Terminator) send their old pages to the index.
    for old in ['/docs', '/docs/blocks', '/docs/constant.html', '/docs/blocks/constant.html',
                '/docs/blocks/scope', '/docs/scope.html', '/docs/blocks/display', '/docs/blocks/terminator']:
        if not exists(old):
            broken.append(f'old address {old} no longer resolves')
    for line in broken:
        print(line)
    print(f'Checked links in {len(pages)} pages; {len(broken)} broken.')
    return 1 if broken else 0


if __name__ == '__main__':
    sys.exit(main())
