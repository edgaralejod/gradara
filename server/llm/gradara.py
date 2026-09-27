# SPDX-License-Identifier: Apache-2.0
"""Client for the hosted Gradara AI service (prepaid credits).

The local service holds the device token (in the OS keychain) and forwards one
structured-generation request at a time. The gateway runs the model call, keeps
only billing metadata (task, token counts, credits), and never stores prompts
or responses. Sign-in uses a device-code flow: the user approves this computer
in their browser; no password ever passes through Gradara.
"""
from __future__ import annotations

import os

import httpx

from .. import credentials, settings
from .providers import Generation, ProviderError, Usage

VERSION = os.environ.get('GRADARA_VERSION', '0.2.0')
TIMEOUT = httpx.Timeout(connect=15.0, read=330.0, write=60.0, pool=15.0)


class NotSignedIn(ProviderError):
    def __init__(self):
        super().__init__('Sign in to Gradara AI in Settings → AI to use AI features.', 401)


def _headers(token: str | None = None) -> dict:
    headers = {'User-Agent': f'Gradara/{VERSION}', 'X-Gradara-Version': VERSION}
    if token:
        headers['Authorization'] = f'Bearer {token}'
    return headers


OUTDATED_SERVICE = ('Gradara AI does not offer this feature yet: the service is older than this version of '
                    'Gradara. Try again later, or use your own API key in Settings → AI.')


def _detail(response: httpx.Response, path: str = '') -> str:
    try:
        detail = response.json().get('detail')
    except (ValueError, AttributeError):
        detail = None
    if isinstance(detail, str):
        return detail
    if isinstance(detail, list):
        # FastAPI request validation. A task or operation kind the gateway rejects means
        # the deployed service predates this app; say so instead of showing field errors.
        fields = {str(item.get('loc', ['', ''])[-1]) for item in detail if isinstance(item, dict)}
        if path == '/v1/generate' and fields & {'task', 'kind', 'part'}:
            return OUTDATED_SERVICE
        messages = [str(item.get('msg', '')) for item in detail if isinstance(item, dict) and item.get('msg')]
        if messages:
            return 'Gradara AI rejected the request: ' + '; '.join(messages[:3])
    return f'Gradara AI returned {response.status_code}.'


async def request(method: str, path: str, *, auth: bool = True, json: dict | None = None,
                  timeout: httpx.Timeout = TIMEOUT) -> dict:
    token = credentials.get('gradara_token') if auth else None
    if auth and not token:
        raise NotSignedIn()
    try:
        async with httpx.AsyncClient(timeout=timeout) as client:
            response = await client.request(method, settings.gateway_url() + path, headers=_headers(token), json=json)
    except httpx.TimeoutException as exc:
        raise ProviderError('Gradara AI did not answer in time. Try again.', 504, True) from exc
    except httpx.HTTPError as exc:
        raise ProviderError('Could not reach Gradara AI. Check your internet connection.', 503, True) from exc
    if response.status_code == 401 and auth:
        credentials.delete('gradara_token')
        raise ProviderError('Your Gradara AI sign-in expired or was revoked. Sign in again in Settings → AI.', 401)
    if response.status_code >= 400:
        raise ProviderError(_detail(response, path), response.status_code, response.status_code in (429, 503))
    return response.json()


async def generate(prompt: str, schema: dict, *, task: str, job: dict) -> Generation:
    data = await request('POST', '/v1/generate', json={
        'task': task, 'job': job, 'prompt': prompt, 'schema': schema,
    })
    usage = data.get('usage') or {}
    generation = Generation(data['data'], 'gradara', data.get('model', ''),
                            Usage(usage.get('inputTokens', 0), usage.get('outputTokens', 0)),
                            data.get('jobCharged'))
    return generation


async def start_sign_in() -> dict:
    return await request('POST', '/v1/device/start', auth=False, json={'client': f'Gradara desktop {VERSION}'},
                         timeout=httpx.Timeout(20.0))


async def poll_sign_in(device_code: str) -> dict:
    data = await request('POST', '/v1/device/token', auth=False, json={'deviceCode': device_code},
                         timeout=httpx.Timeout(20.0))
    if data.get('status') == 'approved' and data.get('token'):
        credentials.put('gradara_token', data.pop('token'))
    data.pop('token', None)
    return data


async def account() -> dict:
    return await request('GET', '/v1/account', timeout=httpx.Timeout(20.0))


async def checkout(pack: str) -> dict:
    return await request('POST', '/v1/billing/checkout', json={'pack': pack}, timeout=httpx.Timeout(30.0))


async def sign_out() -> None:
    if credentials.get('gradara_token'):
        try:
            await request('POST', '/v1/auth/signout', timeout=httpx.Timeout(15.0))
        except ProviderError:
            pass
    credentials.delete('gradara_token')


async def delete_account() -> dict:
    data = await request('DELETE', '/v1/account', timeout=httpx.Timeout(30.0))
    credentials.delete('gradara_token')
    return data
