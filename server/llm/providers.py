# SPDX-License-Identifier: Apache-2.0
"""Vendor-neutral structured generation over HTTPS.

Shared by the local service (bring-your-own-key) and the Gradara AI gateway
(``cloud/``). Each provider returns one JSON object that matches the requested
schema, plus normalized token usage. Nothing here logs or stores prompts or
responses; callers decide what metadata to keep.

Privacy-relevant request settings:
* OpenAI Responses API requests set ``store: false`` so responses are not
  retained for later retrieval.
* Anthropic Messages API requests carry no retention-extending features.
Organization-level data controls (zero data retention agreements) are
configured in each vendor account; see docs/PRIVACY.md.
"""
from __future__ import annotations

import asyncio
import json
import random
from dataclasses import dataclass, field
from typing import Any, Protocol

import httpx

from .schema import strict_schema

DEFAULT_MODELS = {'openai': 'gpt-6-sol', 'anthropic': 'claude-sonnet-5'}
TIMEOUT = httpx.Timeout(connect=15.0, read=300.0, write=60.0, pool=15.0)
MAX_OUTPUT_TOKENS = 32_000


class ProviderError(RuntimeError):
    """A failure the user can act on. ``status`` mirrors the upstream HTTP status."""

    def __init__(self, message: str, status: int = 502, retryable: bool = False):
        super().__init__(message)
        self.status = status
        self.retryable = retryable


@dataclass
class Usage:
    input_tokens: int = 0
    output_tokens: int = 0

    @property
    def total(self) -> int:
        return self.input_tokens + self.output_tokens


@dataclass
class Generation:
    data: dict[str, Any]
    provider: str
    model: str
    usage: Usage = field(default_factory=Usage)
    # Gradara AI only: credits charged to the whole job so far.
    job_charged: int | None = None


class Provider(Protocol):
    name: str

    async def generate(self, prompt: str, schema: dict, *, schema_name: str = 'gradara_result') -> Generation: ...


def _error_for(provider: str, response: httpx.Response) -> ProviderError:
    status = response.status_code
    try:
        detail = response.json()
        detail = detail.get('error', detail)
        message = detail.get('message') if isinstance(detail, dict) else str(detail)
    except ValueError:
        message = response.text[:300]
    label = provider.capitalize() if provider != 'openai' else 'OpenAI'
    if status in (401, 403):
        return ProviderError(f'{label} rejected the API key. Check the key in Settings → AI.', 401)
    if status == 404:
        return ProviderError(f'{label} does not recognize the model. Choose another model in Settings → AI. ({message})', 400)
    if status == 429:
        return ProviderError(f'{label} rate limit or quota reached. Try again shortly. ({message})', 429, True)
    if status >= 500:
        return ProviderError(f'{label} is temporarily unavailable ({status}).', 503, True)
    return ProviderError(f'{label} could not complete the request: {message}', 400)


def network_reason(exc: BaseException) -> str:
    """A short, specific reason for a failed request: what to fix is different for each."""
    text = f'{exc} {exc.__cause__ or ""} {exc.__context__ or ""}'.lower()
    if 'certificate' in text or 'ssl' in text:
        return ('the secure connection failed (certificate check). A proxy or security software that inspects '
                'HTTPS traffic can cause this')
    if 'name or service' in text or 'nodename' in text or 'getaddrinfo' in text or 'name resolution' in text:
        return 'the server name could not be resolved (DNS). Check your internet connection'
    if 'proxy' in text:
        return 'the HTTP proxy refused the connection. Check HTTPS_PROXY'
    if isinstance(exc, httpx.ConnectTimeout):
        return 'the connection timed out'
    if isinstance(exc, httpx.ConnectError):
        return 'the connection was refused or dropped. Check your internet connection or firewall'
    if isinstance(exc, (httpx.RemoteProtocolError, httpx.ReadError)):
        return 'the connection closed before the answer arrived'
    return type(exc).__name__


def _sent(exc: BaseException) -> bool:
    """False when the request certainly never reached the server (safe to repeat)."""
    return not isinstance(exc, (httpx.ConnectError, httpx.ConnectTimeout, httpx.PoolTimeout))


async def _post(provider: str, url: str, headers: dict, body: dict, client: httpx.AsyncClient | None) -> dict:
    owned = client is None
    client = client or httpx.AsyncClient(timeout=TIMEOUT)
    label = {'openai': 'OpenAI', 'anthropic': 'Anthropic'}.get(provider, provider)
    try:
        for attempt in range(3):
            try:
                response = await client.post(url, headers=headers, json=body)
            except httpx.ReadTimeout as exc:
                # The request was sent and the model may still be working: repeating it
                # would pay twice for one answer.
                raise ProviderError(f'{label} did not answer within {int(TIMEOUT.read)} seconds. Try again, '
                                    'or ask for a smaller change.', 504, True) from exc
            except httpx.HTTPError as exc:
                error = ProviderError(f'Could not reach {label}: {network_reason(exc)}.', 503, True)
                if attempt == 2 or _sent(exc):
                    raise error from exc
                await asyncio.sleep(1.5 * (attempt + 1) + random.random())
                continue
            if response.status_code < 400:
                return response.json()
            error = _error_for(provider, response)
            if not error.retryable or attempt == 2:
                raise error
            retry_after = response.headers.get('retry-after')
            delay = float(retry_after) if retry_after and retry_after.replace('.', '', 1).isdigit() else 2.0 * (attempt + 1)
            await asyncio.sleep(min(delay, 20) + random.random())
        raise ProviderError('The AI provider is unavailable.', 503, True)
    finally:
        if owned:
            await client.aclose()


def _parse_json(provider: str, text: str) -> dict:
    try:
        value = json.loads(text)
    except (TypeError, ValueError) as exc:
        raise ProviderError(f'{provider} returned output that is not valid JSON.', 502) from exc
    if not isinstance(value, dict):
        raise ProviderError(f'{provider} returned JSON that is not an object.', 502)
    return value


class OpenAIProvider:
    name = 'openai'

    def __init__(self, api_key: str, model: str = '', base_url: str = 'https://api.openai.com/v1',
                 client: httpx.AsyncClient | None = None):
        self.api_key, self.model, self.base_url, self.client = api_key, model or DEFAULT_MODELS['openai'], base_url.rstrip('/'), client

    async def generate(self, prompt: str, schema: dict, *, schema_name: str = 'gradara_result') -> Generation:
        body = {
            'model': self.model,
            'input': [{'role': 'user', 'content': prompt}],
            'text': {'format': {'type': 'json_schema', 'name': schema_name, 'strict': True,
                                'schema': strict_schema(schema)}},
            'store': False,
            'max_output_tokens': MAX_OUTPUT_TOKENS,
        }
        data = await _post('openai', f'{self.base_url}/responses',
                           {'Authorization': f'Bearer {self.api_key}'}, body, self.client)
        if data.get('status') == 'incomplete':
            reason = (data.get('incomplete_details') or {}).get('reason', 'unknown')
            raise ProviderError(f'OpenAI stopped before finishing ({reason}).', 502)
        text = data.get('output_text')
        if not text:
            parts = []
            for item in data.get('output', []):
                for content in item.get('content', []) or []:
                    if content.get('type') == 'refusal':
                        raise ProviderError('OpenAI declined this request: ' + content.get('refusal', '')[:300], 400)
                    if content.get('type') == 'output_text':
                        parts.append(content.get('text', ''))
            text = ''.join(parts)
        usage = data.get('usage') or {}
        return Generation(_parse_json('OpenAI', text), 'openai', data.get('model', self.model),
                          Usage(int(usage.get('input_tokens', 0)), int(usage.get('output_tokens', 0))))


class AnthropicProvider:
    name = 'anthropic'

    def __init__(self, api_key: str, model: str = '', base_url: str = 'https://api.anthropic.com/v1',
                 client: httpx.AsyncClient | None = None):
        self.api_key, self.model, self.base_url, self.client = api_key, model or DEFAULT_MODELS['anthropic'], base_url.rstrip('/'), client

    async def generate(self, prompt: str, schema: dict, *, schema_name: str = 'gradara_result') -> Generation:
        body = {
            'model': self.model,
            'max_tokens': MAX_OUTPUT_TOKENS,
            'messages': [{'role': 'user', 'content': prompt}],
            'output_config': {'format': {'type': 'json_schema', 'schema': strict_schema(schema)}},
        }
        headers = {'x-api-key': self.api_key, 'anthropic-version': '2023-06-01'}
        data = await _post('anthropic', f'{self.base_url}/messages', headers, body, self.client)
        if data.get('stop_reason') == 'max_tokens':
            raise ProviderError('Anthropic stopped before finishing (output limit).', 502)
        if data.get('stop_reason') == 'refusal':
            raise ProviderError('Anthropic declined this request.', 400)
        text = ''.join(block.get('text', '') for block in data.get('content', []) if block.get('type') == 'text')
        usage = data.get('usage') or {}
        return Generation(_parse_json('Anthropic', text), 'anthropic', data.get('model', self.model),
                          Usage(int(usage.get('input_tokens', 0)), int(usage.get('output_tokens', 0))))


def make_provider(name: str, api_key: str, model: str = '', client: httpx.AsyncClient | None = None) -> Provider:
    if name == 'openai':
        return OpenAIProvider(api_key, model, client=client)
    if name == 'anthropic':
        return AnthropicProvider(api_key, model, client=client)
    raise ValueError(f'Unknown provider: {name}')


async def verify_key(name: str, api_key: str, client: httpx.AsyncClient | None = None) -> None:
    """Check a key with a free metadata request (lists models; no generation)."""
    if name == 'openai':
        url, headers = 'https://api.openai.com/v1/models', {'Authorization': f'Bearer {api_key}'}
    elif name == 'anthropic':
        url, headers = 'https://api.anthropic.com/v1/models', {'x-api-key': api_key, 'anthropic-version': '2023-06-01'}
    else:
        raise ValueError(name)
    owned = client is None
    client = client or httpx.AsyncClient(timeout=httpx.Timeout(20.0))
    try:
        try:
            response = await client.get(url, headers=headers)
        except httpx.HTTPError as exc:
            raise ProviderError('Could not reach the provider to check this key. Check your internet connection.', 503) from exc
        if response.status_code >= 400:
            raise _error_for(name, response)
    finally:
        if owned:
            await client.aclose()
