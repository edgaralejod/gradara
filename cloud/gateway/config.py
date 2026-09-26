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
    prices: dict = field(default_factory=lambda: {'component': 2, 'model': 20, 'export': 2})
    max_calls: dict = field(default_factory=lambda: {'component': 4, 'model': 24, 'export': 3})
    free_credits: int = 10
    rate_per_minute: int = 20
    max_concurrent: int = 3
    usage_retention_days: int = 400
    admin_token: str = ''
    support_email: str = 'support@virtu-services.us'

    @property
    def production(self) -> bool:
        return self.env == 'production'

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
            if not self.public_url.startswith('https://'):
                problems.append('PUBLIC_URL must be https')
            if problems:
                raise RuntimeError('Gateway configuration is not production-ready: ' + '; '.join(problems))


def load() -> Config:
    provider = os.environ.get('LLM_PROVIDER', 'anthropic')
    key_var = {'anthropic': 'ANTHROPIC_API_KEY', 'openai': 'OPENAI_API_KEY'}.get(provider, 'LLM_API_KEY')
    packs = json.loads(os.environ['CREDIT_PACKS']) if os.environ.get('CREDIT_PACKS') else list(DEFAULT_PACKS)
    prices = json.loads(os.environ['CREDIT_PRICES']) if os.environ.get('CREDIT_PRICES') else None
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
        free_credits=_int('FREE_CREDITS', 10),
        rate_per_minute=_int('RATE_PER_MINUTE', 20),
        max_concurrent=_int('MAX_CONCURRENT', 3),
        usage_retention_days=_int('USAGE_RETENTION_DAYS', 400),
        admin_token=os.environ.get('ADMIN_TOKEN', ''),
        support_email=os.environ.get('SUPPORT_EMAIL', 'support@virtu-services.us'),
        **({'prices': prices} if prices else {}),
    )
    config.validate()
    return config
