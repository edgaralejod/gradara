# SPDX-License-Identifier: Apache-2.0
"""Operator commands. Run with the production DATABASE_URL in the environment.

  python -m gateway.admin balance someone@example.com
  python -m gateway.admin adjust someone@example.com 50 --reason goodwill
  python -m gateway.admin refund cs_live_123                   (remove a refunded purchase's credits)
  python -m gateway.admin refund cs_live_123 40                (only 40 of them, after a partial refund)
  python -m gateway.admin refund someone@example.com 100 --ref re_123
  python -m gateway.admin purge

Refunds and disputes made in Stripe are applied automatically by the webhook;
the refund command is for corrections. By Checkout Session id it shares the
webhook's bookkeeping, so the same credits are never removed twice, and it
still works after the account was deleted (when its email is gone).
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


def parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(prog='gateway.admin')
    sub = parser.add_subparsers(dest='command', required=True)
    sub.add_parser('balance').add_argument('email')
    adjust = sub.add_parser('adjust')
    adjust.add_argument('email')
    adjust.add_argument('credits', type=int)
    adjust.add_argument('--reason', default='adjust')
    refund = sub.add_parser('refund', help='remove credits after a Stripe refund')
    refund.add_argument('target', help='Stripe Checkout Session id (cs_…) or the account email')
    refund.add_argument('credits', type=int, nargs='?',
                        help='credits to remove; defaults to the whole purchase when a session id is given')
    refund.add_argument('--ref', help='Stripe refund id; required with an email')
    sub.add_parser('purge', help='apply retention now (usage, sign-in codes, jobs, revoked tokens, Stripe event ids)')
    return parser


def run(store: Store, argv: list[str] | None = None) -> dict:
    args = parser().parse_args(argv)
    if args.command == 'purge':
        return store.purge()
    if args.command == 'refund' and args.target.startswith('cs_'):
        purchase = store.find_purchase(session_id=args.target)
        if purchase is None:
            raise SystemExit(f'No purchase for {args.target}')
        extra = purchase['credits'] if args.credits is None else abs(args.credits)
        result = store.reverse_purchase(args.target, purchase['reversed'] + extra)
        account = store.account(purchase['account_id'])
        return {'session': args.target, 'removed': result['removed'], 'reversed': result.get('reversed'),
                'account': account.public_id if account else None, 'balance': account.balance if account else 0,
                'deleted': account is None}
    account = find(store, args.target if args.command == 'refund' else args.email)
    if args.command == 'adjust':
        store.adjust(account, args.credits, args.reason[:24])
    elif args.command == 'refund':
        if args.credits is None or not args.ref:
            raise SystemExit('With an email, give the credits to remove and --ref <Stripe refund id>.')
        store.adjust(account, -min(abs(args.credits), account.balance), 'refund', f'stripe-refund:{args.ref}')
    account = store.account(account.id)
    return {'account': account.public_id, 'email': account.email, 'balance': account.balance}


def main(argv: list[str] | None = None) -> None:
    config = load()
    print(json.dumps(run(Store(connect(config.database_url), config), argv)))


if __name__ == '__main__':
    main()
