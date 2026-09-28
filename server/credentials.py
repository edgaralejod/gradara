# SPDX-License-Identifier: Apache-2.0
"""Secrets (provider API keys, the Gradara AI device token) in the OS keychain.

macOS Keychain, Windows Credential Manager, or the Linux Secret Service are used
through `keyring`. If no keychain is available (headless Linux, tests), secrets
fall back to a file readable only by the current user in the data folder. Secrets
never go into settings.json, logs, model files, or API responses.
"""
from __future__ import annotations

import json
import os
from pathlib import Path

from .paths import DATA

SERVICE = 'Gradara'
FALLBACK = DATA/'.credentials.json'
NAMES = {'openai_api_key', 'anthropic_api_key', 'gradara_token'}


def _keyring():
    if os.environ.get('GRADARA_CREDENTIAL_STORE') == 'file':
        return None
    try:
        import keyring
        from keyring.backends import fail
        backend = keyring.get_keyring()
        if isinstance(backend, fail.Keyring) or 'fail' in type(backend).__module__ or 'null' in type(backend).__module__:
            return None
        return keyring
    except Exception:
        return None


def _read_file() -> dict:
    try:
        return json.loads(FALLBACK.read_text(encoding='utf-8'))
    except (OSError, ValueError):
        return {}


def _write_file(data: dict) -> None:
    FALLBACK.parent.mkdir(parents=True, exist_ok=True)
    temporary = FALLBACK.with_suffix('.tmp')
    fd = os.open(temporary, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
    with os.fdopen(fd, 'w', encoding='utf-8') as stream:
        json.dump(data, stream)
    os.replace(temporary, FALLBACK)
    try:
        os.chmod(FALLBACK, 0o600)
    except OSError:
        pass


def get(name: str) -> str | None:
    assert name in NAMES
    ring = _keyring()
    if ring is not None:
        try:
            value = ring.get_password(SERVICE, name)
            if value:
                return value
        except Exception:
            pass
    return _read_file().get(name) or None


def put(name: str, value: str) -> None:
    assert name in NAMES
    ring = _keyring()
    if ring is not None:
        try:
            ring.set_password(SERVICE, name, value)
            data = _read_file()
            if name in data:
                data.pop(name)
                _write_file(data)
            return
        except Exception:
            pass
    data = _read_file()
    data[name] = value
    _write_file(data)


def delete(name: str) -> None:
    assert name in NAMES
    ring = _keyring()
    if ring is not None:
        try:
            ring.delete_password(SERVICE, name)
        except Exception:
            pass
    data = _read_file()
    if name in data:
        data.pop(name)
        _write_file(data)


def present(name: str) -> bool:
    return bool(get(name))


def storage_kind() -> str:
    return 'system keychain' if _keyring() is not None else 'private file in the data folder'


__all__ = ['get', 'put', 'delete', 'present', 'storage_kind', 'Path']
