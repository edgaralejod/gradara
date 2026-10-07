# SPDX-License-Identifier: Apache-2.0
"""The workshop client: request personal features from a GitHub repository's workshop pipeline.

Settings → Personal features names a repository (the main repository for its
maintainer, or the user's own fork) and holds a GitHub token in the keychain.
This module starts the `.github/workflows/workshop.yml` pipeline there, follows
its runs, reads their reports, and lists the layers it published for this
version of Gradara. It never installs anything: the desktop shell downloads a
layer and checks its signature itself. Requests go only to api.github.com.
"""
from __future__ import annotations

import io
import json
import re
import secrets
import time
import zipfile

import httpx

from . import credentials, settings
from .llm.providers import ProviderError

API = 'https://api.github.com'
WORKFLOW = 'workshop.yml'
DEFAULT_REPOSITORY = 'edgaralejod/gradara'
REPOSITORY = re.compile(r'^[A-Za-z0-9_.-]{1,100}/[A-Za-z0-9_.-]{1,100}$')
REQUEST_ID = re.compile(r'^[fs]-[a-z0-9][a-z0-9-]{2,60}$')
TIMEOUT = httpx.Timeout(20.0)

# Pipeline steps as the app shows them, in order.
STAGES = [
    ('Start the branch', 'Preparing'),
    ('Implement the request', 'Implementing'),
    ('Gate', 'Checking'),
    ('Build the layer', 'Building the layer'),
    ('Download the released app', 'Testing in the app'),
    ('Sign', 'Signing'),
    ('Publish', 'Publishing'),
    ('Scope the request', 'Scoping'),
]


class WorkshopError(ProviderError):
    pass


def repository() -> str:
    value = (settings.load().get('workshop') or {}).get('repository') or DEFAULT_REPOSITORY
    return value if REPOSITORY.fullmatch(value) else DEFAULT_REPOSITORY


def set_repository(value: str) -> str:
    value = value.strip().removeprefix('https://github.com/').strip('/')
    if value and not REPOSITORY.fullmatch(value):
        raise WorkshopError('Name the repository as owner/name, for example edgaralejod/gradara.', 422)
    settings.update({'workshop': {'repository': value}})
    return repository()


def new_id(kind: str, title: str = '') -> str:
    slug = re.sub(r'[^a-z0-9]+', '-', title.lower()).strip('-')[:30].strip('-')
    stamp = time.strftime('%y%m%d')
    return f"{kind}-{slug + '-' if slug else ''}{stamp}-{secrets.token_hex(3)}"


def _headers(token: str | None) -> dict:
    headers = {'Accept': 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28', 'User-Agent': 'Gradara'}
    if token:
        headers['Authorization'] = f'Bearer {token}'
    return headers


async def github(method: str, path: str, *, json_body: dict | None = None, auth: bool = True,
                 accept: str | None = None, raw: bool = False):
    token = credentials.get('github_token') if auth else None
    if auth and not token:
        raise WorkshopError('Add a GitHub token in Settings → Personal features to use the workshop.', 401)
    headers = _headers(token)
    if accept:
        headers['Accept'] = accept
    try:
        async with httpx.AsyncClient(timeout=TIMEOUT, follow_redirects=True) as client:
            response = await client.request(method, API + path, headers=headers, json=json_body)
    except httpx.HTTPError as exc:
        raise WorkshopError(f'Could not reach GitHub: {type(exc).__name__}.', 503, True) from exc
    if response.status_code == 401:
        raise WorkshopError('GitHub refused the token. Create a new one and save it in Settings → Personal features.', 401)
    if response.status_code == 403 and 'rate limit' in response.text.lower():
        raise WorkshopError('GitHub’s rate limit was reached. Try again in a few minutes.', 429, True)
    if response.status_code in (403, 404):
        raise WorkshopError(f'GitHub answered {response.status_code} for {repository()}: the repository, its workshop '
                            'workflow, or the token’s access to it (Actions and Contents) is missing.', response.status_code)
    if response.status_code >= 400:
        try:
            message = response.json().get('message', '')
        except ValueError:
            message = ''
        raise WorkshopError(f'GitHub answered {response.status_code}: {message}'.strip(), response.status_code)
    if raw:
        return response.content
    return response.json() if response.content else {}


async def status() -> dict:
    repo = repository()
    saved = credentials.present('github_token')
    login, problem = '', ''
    if saved:
        try:
            login = (await github('GET', '/user')).get('login', '')
        except WorkshopError as exc:
            problem = str(exc)
    return {'repository': repo, 'defaultRepository': DEFAULT_REPOSITORY, 'tokenSaved': saved, 'login': login,
            'problem': problem}


async def save_token(token: str) -> dict:
    token = token.strip()
    if not re.fullmatch(r'[A-Za-z0-9_]{20,255}', token):
        raise WorkshopError('That does not look like a GitHub token.', 422)
    async with httpx.AsyncClient(timeout=TIMEOUT) as client:
        try:
            response = await client.get(API + '/user', headers=_headers(token))
        except httpx.HTTPError as exc:
            raise WorkshopError(f'Could not reach GitHub: {type(exc).__name__}.', 503, True) from exc
    if response.status_code != 200:
        raise WorkshopError('GitHub did not accept that token.', 422)
    credentials.put('github_token', token)
    return await status()


def forget_token() -> None:
    credentials.delete('github_token')


async def dispatch(mode: str, request_id: str, *, request: str = '', title: str = '', base: str = '',
                   stack: list[dict] | None = None, budget: float = 5.0) -> str:
    if mode not in {'scope', 'build', 'rebuild'}:
        raise WorkshopError('Unknown workshop mode.', 422)
    if not REQUEST_ID.fullmatch(request_id):
        raise WorkshopError('Invalid request ID.', 422)
    repo = repository()
    default_branch = (await github('GET', f'/repos/{repo}')).get('default_branch', 'main')
    inputs = {'mode': mode, 'request_id': request_id, 'request': request[:8000], 'title': title[:120], 'base': base,
              'stack': json.dumps(stack or [], separators=(',', ':')), 'budget': f'{budget:.2f}'}
    await github('POST', f'/repos/{repo}/actions/workflows/{WORKFLOW}/dispatches',
                 json_body={'ref': default_branch, 'inputs': inputs})
    return request_id


async def find_run(request_id: str) -> dict | None:
    repo = repository()
    data = await github('GET', f'/repos/{repo}/actions/workflows/{WORKFLOW}/runs?event=workflow_dispatch&per_page=40')
    for run in data.get('workflow_runs', []):
        if request_id in (run.get('display_title') or run.get('name') or ''):
            return run
    return None


def stage_of(jobs: list[dict]) -> str:
    """The step a run is on, in the app's words."""
    current = ''
    for job in jobs:
        for step in job.get('steps', []):
            if step.get('status') in ('in_progress', 'completed'):
                for prefix, label in STAGES:
                    if step.get('name', '').startswith(prefix):
                        current = label
    return current or 'Queued'


async def artifact(run_id: int, name: str) -> dict:
    """The JSON files of one of the run's artifacts, by file name."""
    repo = repository()
    listing = await github('GET', f'/repos/{repo}/actions/runs/{run_id}/artifacts?per_page=50')
    found = next((a for a in listing.get('artifacts', []) if a.get('name') == name and not a.get('expired')), None)
    if not found:
        return {}
    data = await github('GET', f"/repos/{repo}/actions/artifacts/{found['id']}/zip", raw=True)
    files = {}
    with zipfile.ZipFile(io.BytesIO(data)) as archive:
        for info in archive.infolist():
            if info.filename.endswith('.json') and info.file_size < 2_000_000:
                try:
                    files[info.filename.rsplit('/', 1)[-1]] = json.loads(archive.read(info))
                except ValueError:
                    continue
    return files


async def progress(request_id: str) -> dict:
    """Where a request is: queued, its stage while running, and its reports once finished."""
    if not REQUEST_ID.fullmatch(request_id):
        raise WorkshopError('Invalid request ID.', 422)
    run = await find_run(request_id)
    if run is None:
        return {'requestId': request_id, 'status': 'queued', 'stage': 'Queued'}
    repo = repository()
    jobs = (await github('GET', f"/repos/{repo}/actions/runs/{run['id']}/jobs?per_page=50")).get('jobs', [])
    out = {'requestId': request_id, 'runId': run['id'], 'url': run.get('html_url', ''), 'status': run.get('status'),
           'conclusion': run.get('conclusion'), 'stage': stage_of(jobs), 'started': run.get('run_started_at')}
    if run.get('status') == 'completed':
        files = await artifact(run['id'], f'workshop-{request_id}')
        out['report'] = files.get('report.json') or {}
        out['scope'] = files.get('scope.json')
        out['cost'] = files.get('cost.json')
        out['review'] = files.get('review-verdict.json')
        out['layer'] = files.get('layer.json')
    return out


async def layers(version: str) -> list[dict]:
    """Layers this repository published for this exact Gradara version, newest first."""
    repo = repository()
    releases = await github('GET', f'/repos/{repo}/releases?per_page=100')
    found = []
    suffix = f'-v{version}'
    for release in releases:
        tag = release.get('tag_name', '')
        if not (tag.startswith('layer-') and tag.endswith(suffix)) or release.get('draft'):
            continue
        assets = {a['name']: a['browser_download_url'] for a in release.get('assets', [])}
        archive = next((name for name in assets if name.endswith('.tar.gz')), None)
        if not archive or f'{archive}.sig' not in assets or 'layer.json' not in assets:
            continue
        found.append({'tag': tag, 'id': tag[len('layer-'):-len(suffix)], 'title': release.get('name', ''),
                      'published': release.get('published_at'), 'archiveUrl': assets[archive],
                      'signatureUrl': assets[f'{archive}.sig'], 'manifestUrl': assets['layer.json'],
                      'url': release.get('html_url', '')})
    for layer in found[:20]:
        try:
            async with httpx.AsyncClient(timeout=TIMEOUT, follow_redirects=True) as client:
                response = await client.get(layer['manifestUrl'], headers={'User-Agent': 'Gradara'})
            manifest = response.json() if response.status_code == 200 else {}
        except (httpx.HTTPError, ValueError):
            manifest = {}
        layer['features'] = [{'id': f.get('id', ''), 'title': f.get('title', ''), 'commit': f.get('commit', '')}
                             for f in manifest.get('features', []) if isinstance(f, dict)]
    return found
