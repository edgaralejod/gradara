# SPDX-License-Identifier: Apache-2.0
"""Identity verification for the browser sign-in page.

Production uses Firebase Authentication (Google sign-in or passwordless email
links). The gateway only verifies Firebase ID tokens; it never sees passwords.
Development mode accepts a typed email so the full flow can be exercised
locally; ``Config.validate`` refuses that mode in production.
"""
from __future__ import annotations

import re
from dataclasses import dataclass

from .config import Config

EMAIL = re.compile(r'^[^@\s]{1,64}@[^@\s]{1,255}\.[^@\s]{2,}$')


class IdentityError(Exception):
    pass


@dataclass
class Identity:
    subject: str       # stable provider id, e.g. firebase:<uid>
    email: str


def verify(config: Config, id_token: str | None = None, dev_email: str | None = None) -> Identity:
    if config.auth_mode == 'dev':
        if config.production:
            raise IdentityError('Development sign-in is disabled.')
        email = (dev_email or '').strip().lower()
        if not EMAIL.match(email):
            raise IdentityError('Enter a valid email address.')
        return Identity('dev:' + email, email)
    if not id_token:
        raise IdentityError('Sign in first.')
    from google.auth.transport import requests as google_requests
    from google.oauth2 import id_token as google_id_token
    try:
        claims = google_id_token.verify_firebase_token(id_token, google_requests.Request(),
                                                       audience=config.firebase_project_id)
    except Exception as exc:
        raise IdentityError('Your sign-in could not be verified. Try again.') from exc
    if not claims or claims.get('iss') != f'https://securetoken.google.com/{config.firebase_project_id}':
        raise IdentityError('Your sign-in could not be verified. Try again.')
    if not claims.get('email') or not claims.get('email_verified'):
        raise IdentityError('Use a verified email address to sign in.')
    return Identity('firebase:' + claims['sub'], claims['email'].lower())


def delete_remote_identity(config: Config, subject: str | None) -> None:
    """Best-effort removal of the Firebase user when an account is deleted."""
    if not subject or not subject.startswith('firebase:') or config.auth_mode != 'firebase':
        return
    try:
        import firebase_admin
        from firebase_admin import auth
        app = firebase_admin.get_app() if firebase_admin._apps else firebase_admin.initialize_app(
            options={'projectId': config.firebase_project_id})
        auth.delete_user(subject.split(':', 1)[1], app=app)
    except Exception:
        # Reported in the operations runbook; the local account data is already erased.
        pass
