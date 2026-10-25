# SPDX-License-Identifier: Apache-2.0
"""Local, non-secret preferences stored beside the user's models."""
from __future__ import annotations

import json
import os
import threading
from typing import Any

from .paths import SETTINGS_FILE, FROZEN
from .workspace import atomic_write

DEFAULT_GATEWAY = 'https://api.gradara.app'
_lock = threading.Lock()

DEFAULTS: dict[str, Any] = {
    'engine': 'auto',              # auto | bundled | native | docker
    'ai': {
        # gradara (hosted, prepaid credits) | openai | anthropic | codex | off
        'provider': None,          # None: chosen by default_provider()
        # Model per role (server/llm/roles.py); empty: the provider's default for that role.
        'openaiPlannerModel': '',
        'openaiExecutorModel': '',
        'anthropicPlannerModel': '',
        'anthropicExecutorModel': '',
    },
    'gatewayUrl': '',              # empty: GRADARA_GATEWAY_URL or DEFAULT_GATEWAY
    'workshop': {'repository': ''},  # empty: the main repository (server/workshop.py)
    'setupDismissed': False,
}


def _merge(base: dict, update: dict) -> dict:
    merged = dict(base)
    for key, value in update.items():
        if isinstance(value, dict) and isinstance(merged.get(key), dict):
            merged[key] = _merge(merged[key], value)
        else:
            merged[key] = value
    return merged


def _migrate(stored: dict) -> dict:
    """Settings from before planner and executor roles: the one model becomes the planner model."""
    ai = stored.get('ai')
    if isinstance(ai, dict):
        for name in ('openai', 'anthropic'):
            old = ai.pop(f'{name}Model', None)
            if old and not ai.get(f'{name}PlannerModel'):
                ai[f'{name}PlannerModel'] = old
    return stored


def load() -> dict:
    try:
        stored = json.loads(SETTINGS_FILE.read_text(encoding='utf-8'))
    except (OSError, ValueError):
        stored = {}
    return _merge(DEFAULTS, _migrate(stored) if isinstance(stored, dict) else {})


def update(changes: dict) -> dict:
    with _lock:
        current = _merge(load(), changes)
        atomic_write(SETTINGS_FILE, json.dumps(current, indent=2))
        return current


def gateway_url() -> str:
    return (os.environ.get('GRADARA_GATEWAY_URL') or load().get('gatewayUrl') or DEFAULT_GATEWAY).rstrip('/')


def default_provider() -> str:
    """Installed builds default to Gradara AI; source checkouts keep Codex when present."""
    from .llm.codex import codex_available
    if not FROZEN and codex_available():
        return 'codex'
    return 'gradara'


def ai_provider() -> str:
    return os.environ.get('GRADARA_AI_PROVIDER') or load()['ai'].get('provider') or default_provider()


def ai_model(provider: str, role: str) -> str:
    """The model a key provider uses for ``role``: the user's choice, else the default for that role."""
    from .llm.providers import DEFAULT_MODELS
    return load()['ai'].get(f'{provider}{role.capitalize()}Model') or DEFAULT_MODELS[provider][role]
