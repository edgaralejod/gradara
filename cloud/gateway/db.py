# SPDX-License-Identifier: Apache-2.0
"""Relational storage for accounts, sign-in tokens, and the credit ledger.

What is stored (and nothing else):
* accounts: an internal id, the identity provider's user id, email, credit
  balance, and the Terms version accepted at sign-in
* access_tokens / device_codes: SHA-256 hashes only, never the raw tokens
* ledger: credit grants, purchases (Stripe session id), charges, and reversals
* purchases: Stripe Checkout Session and PaymentIntent ids, credits bought, and
  credits reversed after a refund or dispute
* deleted_identities: keyed hashes of deleted accounts' sign-in ids and emails,
  so a deleted account cannot collect a second welcome grant
* stripe_events: processed webhook event ids, purged after 90 days
* jobs / usage: task name, model, token counts, latency, success flag

Prompts, model files, generated equations, and AI responses are never written.
SQLite serves development and tests; production uses PostgreSQL.
"""
from __future__ import annotations

from datetime import datetime, timezone

from sqlalchemy import (Boolean, Column, DateTime, ForeignKey, Integer, MetaData, String, Table,
                        UniqueConstraint, create_engine, event, inspect, text)
from sqlalchemy.engine import Engine

metadata = MetaData()


def now() -> datetime:
    return datetime.now(timezone.utc).replace(tzinfo=None)


accounts = Table(
    'accounts', metadata,
    Column('id', Integer, primary_key=True),
    Column('public_id', String(40), unique=True, nullable=False),
    Column('identity', String(160), unique=True, nullable=True),   # e.g. firebase:<uid>
    Column('email', String(320), nullable=True),
    Column('balance', Integer, nullable=False, default=0),
    Column('created_at', DateTime, nullable=False, default=now),
    Column('deleted_at', DateTime, nullable=True),
    Column('terms_version', String(16), nullable=True),
    Column('terms_accepted_at', DateTime, nullable=True),
)

access_tokens = Table(
    'access_tokens', metadata,
    Column('id', Integer, primary_key=True),
    Column('account_id', Integer, ForeignKey('accounts.id'), nullable=False, index=True),
    Column('token_hash', String(64), unique=True, nullable=False),
    Column('client', String(80), nullable=False, default=''),
    Column('created_at', DateTime, nullable=False, default=now),
    Column('last_used_on', DateTime, nullable=True),              # day resolution only
    Column('revoked_at', DateTime, nullable=True),
)

device_codes = Table(
    'device_codes', metadata,
    Column('id', Integer, primary_key=True),
    Column('device_hash', String(64), unique=True, nullable=False),
    Column('user_code', String(16), unique=True, nullable=False),
    Column('client', String(80), nullable=False, default=''),
    Column('status', String(16), nullable=False, default='pending'),  # pending|approved|consumed|denied
    Column('account_id', Integer, ForeignKey('accounts.id'), nullable=True),
    Column('created_at', DateTime, nullable=False, default=now),
    Column('expires_at', DateTime, nullable=False),
)

ledger = Table(
    'ledger', metadata,
    Column('id', Integer, primary_key=True),
    Column('account_id', Integer, ForeignKey('accounts.id'), nullable=False, index=True),
    Column('delta', Integer, nullable=False),
    Column('reason', String(24), nullable=False),     # welcome|purchase|charge|refund|adjust|forfeit|reversal
    Column('ref', String(120), unique=True, nullable=True),
    Column('created_at', DateTime, nullable=False, default=now),
)

jobs = Table(
    'jobs', metadata,
    Column('id', Integer, primary_key=True),
    Column('account_id', Integer, ForeignKey('accounts.id'), nullable=False),
    Column('job_id', String(80), nullable=False),
    Column('kind', String(24), nullable=False),
    Column('calls', Integer, nullable=False, default=0),
    Column('succeeded', Boolean, nullable=False, default=False),
    Column('charged', Integer, nullable=False, default=0),
    Column('created_at', DateTime, nullable=False, default=now),
    UniqueConstraint('account_id', 'job_id', name='uq_jobs_account_job'),
)

# Priced parts of one job, e.g. each generated block of a model edit. Each part pays once.
job_parts = Table(
    'job_parts', metadata,
    Column('id', Integer, primary_key=True),
    Column('job_row', Integer, ForeignKey('jobs.id'), nullable=False, index=True),
    Column('part', String(40), nullable=False),
    Column('succeeded', Boolean, nullable=False, default=False),
    Column('charged', Integer, nullable=False, default=0),
    Column('created_at', DateTime, nullable=False, default=now),
    UniqueConstraint('job_row', 'part', name='uq_job_parts_job_part'),
)

usage = Table(
    'usage', metadata,
    Column('id', Integer, primary_key=True),
    Column('account_id', Integer, ForeignKey('accounts.id'), nullable=False, index=True),
    Column('job_id', String(80), nullable=False),
    Column('task', String(32), nullable=False),
    Column('model', String(80), nullable=False, default=''),
    Column('input_tokens', Integer, nullable=False, default=0),
    Column('output_tokens', Integer, nullable=False, default=0),
    Column('latency_ms', Integer, nullable=False, default=0),
    Column('ok', Boolean, nullable=False),
    Column('error', String(40), nullable=True),       # short code, never provider text
    Column('created_at', DateTime, nullable=False, default=now, index=True),
)

# One row per paid Checkout Session, so a Stripe refund or dispute (which names
# the PaymentIntent) can find the credits it bought.
purchases = Table(
    'purchases', metadata,
    Column('id', Integer, primary_key=True),
    Column('account_id', Integer, ForeignKey('accounts.id'), nullable=False, index=True),
    Column('session_id', String(120), unique=True, nullable=False),
    Column('payment_intent', String(120), nullable=True, index=True),
    Column('credits', Integer, nullable=False),
    Column('reversed', Integer, nullable=False, default=0),   # credits covered by refunds/disputes so far
    Column('created_at', DateTime, nullable=False, default=now),
)

deleted_identities = Table(
    'deleted_identities', metadata,
    Column('marker', String(64), primary_key=True),   # HMAC-SHA256(IDENTITY_PEPPER, sign-in id or email)
    Column('created_at', DateTime, nullable=False, default=now),
)

stripe_events = Table(
    'stripe_events', metadata,
    Column('id', String(80), primary_key=True),
    Column('created_at', DateTime, nullable=False, default=now),
)


def connect(url: str) -> Engine:
    if url.startswith('sqlite'):
        engine = create_engine(url, connect_args={'check_same_thread': False})

        @event.listens_for(engine, 'connect')
        def _pragmas(connection, _):
            cursor = connection.cursor()
            cursor.execute('PRAGMA foreign_keys=ON')
            cursor.execute('PRAGMA journal_mode=WAL')
            cursor.close()
    else:
        engine = create_engine(url, pool_pre_ping=True, pool_size=5, max_overflow=5)
    metadata.create_all(engine)
    migrate(engine)
    return engine


# Columns added after a table was first created. ``create_all`` creates missing
# tables but never alters existing ones, so each addition is applied here once.
ADDED_COLUMNS = {
    'accounts': [('terms_version', 'VARCHAR(16)'), ('terms_accepted_at', 'TIMESTAMP')],
}


def migrate(engine: Engine) -> None:
    inspector = inspect(engine)
    for table, columns in ADDED_COLUMNS.items():
        present = {c['name'] for c in inspector.get_columns(table)}
        missing = [(name, kind) for name, kind in columns if name not in present]
        if missing:
            with engine.begin() as db:
                for name, kind in missing:
                    db.execute(text(f'ALTER TABLE {table} ADD COLUMN {name} {kind}'))
