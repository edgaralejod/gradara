# SPDX-License-Identifier: Apache-2.0
"""Operator commands. Run with the production DATABASE_URL in the environment.

  python -m gateway.admin balance someone@example.com
  python -m gateway.admin adjust someone@example.com 50 --reason goodwill
  python -m gateway.admin refund someone@example.com 100 --ref cs_live_123   (after a Stripe refund)
  python -m gateway.admin purge
"""
from __future__ import annotations

import argparse
import json

from sqlalchemy import select

from .config import load
from .db import accounts, connect
from .store import Account, Store


def find(store: Store, email: str) -> Account:
    with store.engine.connect() as db:
        row = db.execute(select(accounts).where(accounts.c.email == email.lower(),
                                                accounts.c.deleted_at.is_(None))).mappings().first()
    if not row:
        raise SystemExit(f'No active account for {email}')
    return Account(row['id'], row['public_id'], row['email'], row['balance'])


def main() -> None:
    parser = argparse.ArgumentParser(prog='gateway.admin')
    sub = parser.add_subparsers(dest='command', required=True)
    sub.add_parser('balance').add_argument('email')
    adjust = sub.add_parser('adjust')
    adjust.add_argument('email')
    adjust.add_argument('credits', type=int)
    adjust.add_argument('--reason', default='adjust')
    refund = sub.add_parser('refund')
    refund.add_argument('email')
    refund.add_argument('credits', type=int, help='credits to remove after a Stripe refund')
    refund.add_argument('--ref', required=True, help='Stripe Checkout Session or refund id')
    sub.add_parser('purge')
    args = parser.parse_args()
    config = load()
    store = Store(connect(config.database_url), config)
    if args.command == 'purge':
        print(json.dumps(store.purge()))
        return
    account = find(store, args.email)
    if args.command == 'adjust':
        store.adjust(account, args.credits, args.reason[:24])
    elif args.command == 'refund':
        store.adjust(account, -abs(args.credits), 'refund', f'stripe-refund:{args.ref}')
    account = store.account(account.id)
    print(json.dumps({'account': account.public_id, 'email': account.email, 'balance': account.balance}))


if __name__ == '__main__':
    main()
