# SPDX-License-Identifier: Apache-2.0
"""Structured generation for Gradara's AI features, routed to the chosen provider.

Providers:
* ``gradara``   hosted Gradara AI (sign in, prepaid credits)
* ``openai``    the user's own OpenAI API key
* ``anthropic`` the user's own Anthropic API key
* ``codex``     the user's signed-in Codex CLI (developer option)
* ``off``       AI features disabled

All AI features call :func:`generate`. A top-level operation (one block, one
model build, one C export) sets :data:`current_job` so the hosted service can
charge once per operation, including its internal repair attempts.
"""
from __future__ import annotations

import contextlib
import contextvars
import json
import os

from .. import credentials, settings
from ..paths import AGENT_DIR
from .codex import codex_available
from .providers import DEFAULT_MODELS, Generation, ProviderError, make_provider

current_job: contextvars.ContextVar[dict | None] = contextvars.ContextVar('gradara_job', default=None)

LABELS = {'gradara': 'Gradara AI', 'openai': 'OpenAI (your key)', 'anthropic': 'Anthropic (your key)',
          'codex': 'Codex CLI', 'off': 'Off'}
KEY_NAMES = {'openai': 'openai_api_key', 'anthropic': 'anthropic_api_key'}


@contextlib.contextmanager
def job_part(part: str):
    """Label provider calls for one priced part of the current job, such as a generated block."""
    job = current_job.get()
    token = current_job.set({**job, 'part': part} if job else None)
    try:
        yield
    finally:
        current_job.reset(token)


def _keep_transcript(attempt_id: str, prompt: str, generation: Generation) -> None:
    """Optional local debugging copy. Off by default; never sent anywhere."""
    if os.environ.get('GRADARA_KEEP_AI_TRANSCRIPTS') != '1':
        return
    folder = AGENT_DIR/attempt_id
    folder.mkdir(parents=True, exist_ok=True)
    (folder/'prompt.txt').write_text(prompt)
    (folder/'response.json').write_text(json.dumps(generation.data, indent=2))


async def generate(prompt: str, schema: dict, attempt_id: str, *, task: str) -> dict:
    provider = settings.ai_provider()
    if provider == 'off':
        raise ProviderError('AI features are turned off. Choose a provider in Settings → AI.', 400)
    if provider == 'codex':
        from . import codex
        return (await codex.generate(prompt, schema, attempt_id)).data
    if provider == 'gradara':
        from . import gradara
        job = current_job.get() or {'id': attempt_id, 'kind': task.split('-')[0]}
        generation = await gradara.generate(prompt, schema, task=task, job=job)
    elif provider in KEY_NAMES:
        key = credentials.get(KEY_NAMES[provider])
        if not key:
            raise ProviderError(f'Add your {LABELS[provider].split(" ")[0]} API key in Settings → AI.', 400)
        model = settings.load()['ai'].get(f'{provider}Model') or DEFAULT_MODELS[provider]
        generation = await make_provider(provider, key, model).generate(prompt, schema)
    else:
        raise ProviderError(f'Unknown AI provider: {provider}', 400)
    _keep_transcript(attempt_id, prompt, generation)
    return generation.data


def status() -> dict:
    provider = settings.ai_provider()
    ready = provider != 'off'
    if provider in KEY_NAMES:
        ready = credentials.present(KEY_NAMES[provider])
    elif provider == 'gradara':
        ready = credentials.present('gradara_token')
    elif provider == 'codex':
        ready = codex_available()
    ai = settings.load()['ai']
    return {
        'provider': provider, 'label': LABELS.get(provider, provider), 'ready': ready,
        'keys': {name: credentials.present(key) for name, key in KEY_NAMES.items()},
        'models': {name: ai.get(f'{name}Model') or '' for name in KEY_NAMES},
        'defaultModels': DEFAULT_MODELS,
        'signedIn': credentials.present('gradara_token'),
        'codexAvailable': codex_available(),
        'gateway': settings.gateway_url(),
        'credentialStorage': credentials.storage_kind(),
    }
