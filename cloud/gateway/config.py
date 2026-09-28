# SPDX-License-Identifier: Apache-2.0
"""Gateway configuration, read once from environment variables.

Secrets (provider API keys, Stripe keys) arrive as environment variables from
the hosting platform's secret manager; they are never written to disk or logs.
"""
from __future__ import annotations

import json
import os
from dataclasses import dataclass, field


def _int(name: str, default: int) -> int:
    return int(os.environ.get(name, default))


def _bool(name: str, default: bool = False) -> bool:
    return os.environ.get(name, str(default)).lower() in {'1', 'true', 'yes', 'on'}


# Credits per operation, charged once per job with repairs included. An edit
# also pays surcharges['edit']['block'] per generated block; a fix pays
# diagnose plus the edit price.
DEFAULT_PRICES = {'component': 2, 'model': 20, 'export': 2, 'edit': 4, 'diagnose': 2}

# Version of the Terms and Privacy notice shown on the sign-in page. Signing in
# records it on the account; change it whenever site/public/terms.html or
# site/public/privacy.html changes materially.
TERMS_VERSION = '2026-09-28'

# Stripe webhook event ids are kept this long for de-duplication, then purged.
STRIPE_EVENT_RETENTION_DAYS = 90

DEFAULT_PACKS = [
    {'id': 'starter', 'credits': 100, 'amount': 1000, 'currency': 'usd', 'label': '100 credits'},
    {'id': 'pro', 'credits': 550, 'amount': 5000, 'currency': 'usd', 'label': '550 credits'},
]


@dataclass(frozen=True)
class Config:
    env: str = 'development'
    public_url: str = 'http://127.0.0.1:8900'
    database_url: str = 'sqlite:///./gateway.db'
    auth_mode: str = 'dev'                      # firebase | dev
    firebase_project_id: str = ''
    firebase_web_api_key: str = ''
    firebase_auth_domain: str = ''
    llm_provider: str = 'anthropic'             # anthropic | openai | fake (tests only)
    llm_model: str = ''
    llm_api_key: str = ''
    stripe_secret_key: str = ''
    stripe_webhook_secret: str = ''
    stripe_automatic_tax: bool = False
    packs: list = field(default_factory=lambda: list(DEFAULT_PACKS))
    prices: dict = field(default_factory=lambda: dict(DEFAULT_PRICES))
    # Extra credits for priced parts of a job; the edit stage of a fix costs prices['edit'].
    surcharges: dict = field(default_factory=lambda: {'edit': {'block': 2}})
    max_calls: dict = field(default_factory=lambda: {'component': 4, 'model': 24, 'export': 3, 'edit': 12, 'diagnose': 14})
    max_parts: dict = field(default_factory=lambda: {'block': 3})
    free_credits: int = 20
    rate_per_minute: int = 20
    max_concurrent: int = 3
    usage_retention_days: int = 400
    admin_token: str = ''
    # Secret key for the salted hashes of deleted identities (blocks a second
    # welcome grant). Falls back to admin_token; never change it once set.
    identity_pepper: str = ''
    support_email: str = 'support@virtu-services.us'
    download_base: str = 'https://github.com/edgaralejod/gradara/releases/latest/download'
    source_url: str = 'https://github.com/edgaralejod/gradara'

    @property
    def production(self) -> bool:
        return self.env == 'production'

    def part_price(self, family: str) -> int:
        return self.prices['edit'] if family == 'edit' else self.surcharges['edit'][family]

    @property
    def pepper(self) -> bytes:
        return (self.identity_pepper or self.admin_token or 'gradara-development-pepper').encode()

    def pack(self, pack_id: str) -> dict | None:
        return next((p for p in self.packs if p['id'] == pack_id), None)

    def validate(self) -> None:
        if self.production:
            problems = []
            if self.auth_mode != 'firebase':
                problems.append('AUTH_MODE must be firebase in production')
            if not self.firebase_project_id:
                problems.append('FIREBASE_PROJECT_ID is required')
            if self.llm_provider not in {'anthropic', 'openai'} or not self.llm_api_key:
                problems.append('LLM_PROVIDER (anthropic|openai) and its API key are required')
            if not self.stripe_secret_key or not self.stripe_webhook_secret:
                problems.append('STRIPE_SECRET_KEY and STRIPE_WEBHOOK_SECRET are required')
            if any(not p.get('priceId') for p in self.packs):
                problems.append('every credit pack in CREDIT_PACKS needs a Stripe priceId')
            if self.database_url.startswith('sqlite'):
                problems.append('use a managed database (DATABASE_URL), not SQLite, in production')
            if not self.identity_pepper and not self.admin_token:
                problems.append('IDENTITY_PEPPER (or ADMIN_TOKEN) is required')
            if not self.public_url.startswith('https://'):
                problems.append('PUBLIC_URL must be https')
            if problems:
                raise RuntimeError('Gateway configuration is not production-ready: ' + '; '.join(problems))


def load() -> Config:
    provider = os.environ.get('LLM_PROVIDER', 'anthropic')
    key_var = {'anthropic': 'ANTHROPIC_API_KEY', 'openai': 'OPENAI_API_KEY'}.get(provider, 'LLM_API_KEY')
    packs = json.loads(os.environ['CREDIT_PACKS']) if os.environ.get('CREDIT_PACKS') else list(DEFAULT_PACKS)
    # Overrides merge onto the defaults, so a new operation kind always has a price.
    prices = {**DEFAULT_PRICES, **json.loads(os.environ['CREDIT_PRICES'])} if os.environ.get('CREDIT_PRICES') else None
    surcharges = json.loads(os.environ['CREDIT_SURCHARGES']) if os.environ.get('CREDIT_SURCHARGES') else None
    config = Config(
        env=os.environ.get('GATEWAY_ENV', 'development'),
        public_url=os.environ.get('PUBLIC_URL', 'http://127.0.0.1:8900').rstrip('/'),
        database_url=os.environ.get('DATABASE_URL', 'sqlite:///./gateway.db'),
        auth_mode=os.environ.get('AUTH_MODE', 'dev'),
        firebase_project_id=os.environ.get('FIREBASE_PROJECT_ID', ''),
        firebase_web_api_key=os.environ.get('FIREBASE_WEB_API_KEY', ''),
        firebase_auth_domain=os.environ.get('FIREBASE_AUTH_DOMAIN', ''),
        llm_provider=provider,
        llm_model=os.environ.get('LLM_MODEL', ''),
        llm_api_key=os.environ.get(key_var, os.environ.get('LLM_API_KEY', '')),
        stripe_secret_key=os.environ.get('STRIPE_SECRET_KEY', ''),
        stripe_webhook_secret=os.environ.get('STRIPE_WEBHOOK_SECRET', ''),
        stripe_automatic_tax=_bool('STRIPE_AUTOMATIC_TAX'),
        packs=packs,
        free_credits=_int('FREE_CREDITS', 20),
        rate_per_minute=_int('RATE_PER_MINUTE', 20),
        max_concurrent=_int('MAX_CONCURRENT', 3),
        usage_retention_days=_int('USAGE_RETENTION_DAYS', 400),
        admin_token=os.environ.get('ADMIN_TOKEN', ''),
        identity_pepper=os.environ.get('IDENTITY_PEPPER', ''),
        support_email=os.environ.get('SUPPORT_EMAIL', 'support@virtu-services.us'),
        download_base=os.environ.get('DOWNLOAD_BASE', 'https://github.com/edgaralejod/gradara/releases/latest/download'),
        source_url=os.environ.get('SOURCE_URL', 'https://github.com/edgaralejod/gradara'),
        **({'prices': prices} if prices else {}),
        **({'surcharges': surcharges} if surcharges else {}),
    )
    config.validate()
    return config
