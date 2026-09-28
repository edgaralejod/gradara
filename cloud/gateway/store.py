# SPDX-License-Identifier: Apache-2.0
"""Account, sign-in, and credit operations. All balance changes are atomic."""
from __future__ import annotations

import hashlib
import hmac
import secrets
from dataclasses import dataclass
from datetime import timedelta

from sqlalchemy import and_, delete, func, insert, select, update
from sqlalchemy.engine import Engine
from sqlalchemy.exc import IntegrityError

from .config import STRIPE_EVENT_RETENTION_DAYS, TERMS_VERSION, Config
from .db import (access_tokens, accounts, deleted_identities, device_codes, job_parts, jobs, ledger, now, purchases,
                 stripe_events, usage)

USER_ALPHABET = 'BCDFGHJKLMNPQRSTVWXZ'   # no vowels or look-alikes
DEVICE_TTL = timedelta(minutes=10)


def digest(value: str) -> str:
    return hashlib.sha256(value.encode()).hexdigest()


@dataclass
class Account:
    id: int
    public_id: str
    email: str | None
    balance: int


class InsufficientCredits(Exception):
    pass


class _Retry(Exception):
    pass


class Store:
    def __init__(self, engine: Engine, config: Config):
        self.engine, self.config = engine, config

    # ------------------------------------------------------------ accounts

    def markers(self, identity: str | None, email: str | None) -> list[str]:
        """Keyed hashes of a sign-in id and email. Without the pepper they cannot be reversed or matched."""
        values = [f'identity:{identity}' if identity else None, f'email:{email.strip().lower()}' if email else None]
        return [hmac.new(self.config.pepper, v.encode(), hashlib.sha256).hexdigest() for v in values if v]

    def account_for_identity(self, identity: str, email: str) -> Account:
        """Find or create the account for a verified identity and record the accepted Terms version.

        New accounts get the welcome grant, unless the same sign-in id or email
        belonged to an account that was deleted: that person can sign in again
        but starts with no free credits.
        """
        terms = {'terms_version': TERMS_VERSION, 'terms_accepted_at': now()}
        with self.engine.begin() as db:
            row = db.execute(select(accounts).where(accounts.c.identity == identity)).mappings().first()
            if row:
                db.execute(update(accounts).where(accounts.c.id == row['id']).values(email=email, **terms))
                return Account(row['id'], row['public_id'], email, row['balance'])
            public_id = 'acct_' + secrets.token_hex(10)
            returning = db.execute(select(func.count()).select_from(deleted_identities).where(
                deleted_identities.c.marker.in_(self.markers(identity, email)))).scalar_one()
            grant = 0 if returning else self.config.free_credits
            account_id = db.execute(insert(accounts).values(public_id=public_id, identity=identity, email=email,
                                                            balance=grant, created_at=now(), **terms)
                                    ).inserted_primary_key[0]
            if grant:
                db.execute(insert(ledger).values(account_id=account_id, delta=grant, reason='welcome',
                                                 ref=f'welcome:{public_id}', created_at=now()))
            return Account(account_id, public_id, email, grant)

    def account(self, account_id: int) -> Account | None:
        with self.engine.connect() as db:
            row = db.execute(select(accounts).where(accounts.c.id == account_id, accounts.c.deleted_at.is_(None))).mappings().first()
        return Account(row['id'], row['public_id'], row['email'], row['balance']) if row else None

    def account_by_public_id(self, public_id: str) -> Account | None:
        with self.engine.connect() as db:
            row = db.execute(select(accounts).where(accounts.c.public_id == public_id)).mappings().first()
        return Account(row['id'], row['public_id'], row['email'], row['balance']) if row else None

    # ----------------------------------------------------- device sign-in

    def start_device(self, client: str) -> tuple[str, str]:
        device_code = secrets.token_urlsafe(32)
        for _ in range(8):
            raw = ''.join(secrets.choice(USER_ALPHABET) for _ in range(8))
            user_code = f'{raw[:4]}-{raw[4:]}'
            try:
                with self.engine.begin() as db:
                    db.execute(insert(device_codes).values(device_hash=digest(device_code), user_code=user_code,
                                                           client=client[:80], status='pending', created_at=now(),
                                                           expires_at=now() + DEVICE_TTL))
                return device_code, user_code
            except IntegrityError:
                continue
        raise RuntimeError('Could not allocate a sign-in code.')

    def device_by_user_code(self, user_code: str):
        code = user_code.strip().upper().replace(' ', '')
        if len(code) == 8:
            code = f'{code[:4]}-{code[4:]}'
        with self.engine.connect() as db:
            return db.execute(select(device_codes).where(device_codes.c.user_code == code)).mappings().first()

    def approve_device(self, user_code: str, account: Account) -> bool:
        row = self.device_by_user_code(user_code)
        if not row or row['status'] != 'pending' or row['expires_at'] < now():
            return False
        with self.engine.begin() as db:
            result = db.execute(update(device_codes).where(device_codes.c.id == row['id'], device_codes.c.status == 'pending')
                                .values(status='approved', account_id=account.id))
        return result.rowcount == 1

    def redeem_device(self, device_code: str) -> tuple[str, str | None, Account | None]:
        """Return (status, access token or None, account). Tokens are issued exactly once."""
        with self.engine.begin() as db:
            row = db.execute(select(device_codes).where(device_codes.c.device_hash == digest(device_code))).mappings().first()
            if not row:
                return 'expired', None, None
            if row['status'] == 'pending':
                return ('expired', None, None) if row['expires_at'] < now() else ('pending', None, None)
            if row['status'] != 'approved':
                return row['status'], None, None
            claimed = db.execute(update(device_codes).where(device_codes.c.id == row['id'], device_codes.c.status == 'approved')
                                 .values(status='consumed'))
            if claimed.rowcount != 1:
                return 'consumed', None, None
            token = 'gra_' + secrets.token_urlsafe(32)
            db.execute(insert(access_tokens).values(account_id=row['account_id'], token_hash=digest(token),
                                                    client=row['client'], created_at=now()))
        return 'approved', token, self.account(row['account_id'])

    def account_for_token(self, token: str) -> Account | None:
        today = now().replace(hour=0, minute=0, second=0, microsecond=0)
        with self.engine.begin() as db:
            row = db.execute(select(access_tokens.c.id, access_tokens.c.account_id, access_tokens.c.last_used_on)
                             .where(access_tokens.c.token_hash == digest(token), access_tokens.c.revoked_at.is_(None))).mappings().first()
            if not row:
                return None
            if row['last_used_on'] != today:
                db.execute(update(access_tokens).where(access_tokens.c.id == row['id']).values(last_used_on=today))
        return self.account(row['account_id'])

    def revoke_token(self, token: str) -> None:
        with self.engine.begin() as db:
            db.execute(update(access_tokens).where(access_tokens.c.token_hash == digest(token)).values(revoked_at=now()))

    # --------------------------------------------------------------- credits

    def _charge(self, db, account: Account, price: int, ref: str) -> None:
        paid = db.execute(update(accounts).where(accounts.c.id == account.id, accounts.c.balance >= price,
                                                 accounts.c.deleted_at.is_(None))
                          .values(balance=accounts.c.balance - price))
        if paid.rowcount != 1:
            raise InsufficientCredits(price)
        db.execute(insert(ledger).values(account_id=account.id, delta=-price, reason='charge', ref=ref, created_at=now()))

    def begin_job_call(self, account: Account, job_id: str, kind: str, part: str | None = None) -> dict:
        """Register one provider call. A job pays its price once, on its first call.

        Repair attempts inside the same job are included. If a job was refunded
        because its first call failed, the next call pays again. A call labelled
        with a priced part (a generated block, or the edit stage of a fix) also
        pays that part's price once, on the part's first call, in the same
        transaction, so a job is never charged for half of a call.
        """
        price = self.config.prices[kind]
        limit = self.config.max_calls[kind]
        with self.engine.begin() as db:
            row = db.execute(select(jobs).where(jobs.c.account_id == account.id, jobs.c.job_id == job_id)).mappings().first()
            if row is None:
                self._charge(db, account, price, f'job:{account.id}:{job_id}:1')
                job_row = db.execute(insert(jobs).values(account_id=account.id, job_id=job_id, kind=kind, calls=1,
                                                         succeeded=False, charged=price, created_at=now())).inserted_primary_key[0]
                call = {'row': job_row, 'charged': price, 'first': True}
            else:
                if row['kind'] != kind:
                    raise ValueError('This operation id was already used for a different kind of request.')
                if row['calls'] >= limit:
                    raise PermissionError('This operation reached its retry limit.')
                charged = 0
                if not row['charged']:
                    self._charge(db, account, price, f'job:{account.id}:{job_id}:{row["calls"] + 1}')
                    charged = price
                db.execute(update(jobs).where(jobs.c.id == row['id']).values(calls=jobs.c.calls + 1,
                                                                            charged=jobs.c.charged + charged))
                call = {'row': row['id'], 'charged': charged, 'first': bool(charged)}
            if part:
                call |= self._charge_part(db, account, call['row'], job_id, part)
                call['charged'] += call['partCharged']
            call['jobCharged'] = self._job_total(db, call['row'])
            return call

    def _charge_part(self, db, account: Account, job_row: int, job_id: str, part: str) -> dict:
        family = part.split(':')[0]
        price = self.config.part_price(family)
        existing = db.execute(select(job_parts).where(job_parts.c.job_row == job_row,
                                                      job_parts.c.part == part)).mappings().first()
        if existing is None:
            limit = self.config.max_parts.get(family)
            if limit is not None:
                used = db.execute(select(func.count()).select_from(job_parts).where(
                    job_parts.c.job_row == job_row, job_parts.c.part.like(family + ':%'))).scalar_one()
                if used >= limit:
                    raise PermissionError(f'This operation can generate at most {limit} blocks.')
            self._charge(db, account, price, f'part:{account.id}:{job_id}:{part}:1'[:120])
            part_row = db.execute(insert(job_parts).values(job_row=job_row, part=part, succeeded=False, charged=price,
                                                           created_at=now())).inserted_primary_key[0]
            return {'part': part_row, 'partCharged': price, 'partFirst': True}
        if not existing['charged']:
            # Refunded after a failed first call: the next call for this part pays again.
            self._charge(db, account, price, f'part:{account.id}:{job_id}:{part}:{secrets.token_hex(4)}'[:120])
            db.execute(update(job_parts).where(job_parts.c.id == existing['id']).values(charged=price))
            return {'part': existing['id'], 'partCharged': price, 'partFirst': True}
        return {'part': existing['id'], 'partCharged': 0, 'partFirst': False}

    def _job_total(self, db, job_row: int) -> int:
        base = db.execute(select(jobs.c.charged).where(jobs.c.id == job_row)).scalar_one()
        parts = db.execute(select(func.coalesce(func.sum(job_parts.c.charged), 0)).where(
            job_parts.c.job_row == job_row)).scalar_one()
        return base + parts

    def finish_job_call(self, account: Account, call: dict, ok: bool) -> None:
        """Refund a job or part whose first call failed on our side, before any output was delivered."""
        with self.engine.begin() as db:
            job = db.execute(select(jobs).where(jobs.c.id == call['row'])).mappings().first()
            if ok:
                if not job['succeeded']:
                    db.execute(update(jobs).where(jobs.c.id == call['row']).values(succeeded=True))
                if call.get('part'):
                    db.execute(update(job_parts).where(job_parts.c.id == call['part']).values(succeeded=True))
                return
            if call.get('partFirst'):
                part = db.execute(select(job_parts).where(job_parts.c.id == call['part'])).mappings().first()
                if not part['succeeded'] and part['charged']:
                    refund = part['charged']
                    db.execute(update(job_parts).where(job_parts.c.id == part['id']).values(charged=0))
                    db.execute(update(accounts).where(accounts.c.id == account.id).values(balance=accounts.c.balance + refund))
                    db.execute(insert(ledger).values(account_id=account.id, delta=refund, reason='refund',
                                                     ref=f'refund:{account.id}:{job["job_id"]}:{part["part"]}:{secrets.token_hex(4)}'[:120],
                                                     created_at=now()))
            if call['first'] and not job['succeeded'] and job['charged']:
                refund = job['charged']
                db.execute(update(jobs).where(jobs.c.id == call['row']).values(charged=0))
                db.execute(update(accounts).where(accounts.c.id == account.id).values(balance=accounts.c.balance + refund))
                db.execute(insert(ledger).values(account_id=account.id, delta=refund, reason='refund',
                                                 ref=f'refund:{account.id}:{job["job_id"]}:{job["calls"]}', created_at=now()))

    def record_usage(self, account: Account, job_id: str, task: str, model: str, input_tokens: int,
                     output_tokens: int, latency_ms: int, ok: bool, error: str | None = None) -> None:
        with self.engine.begin() as db:
            db.execute(insert(usage).values(account_id=account.id, job_id=job_id[:80], task=task, model=model[:80],
                                            input_tokens=input_tokens, output_tokens=output_tokens,
                                            latency_ms=latency_ms, ok=ok, error=error, created_at=now()))

    def calls_last_minute(self, account: Account) -> int:
        with self.engine.connect() as db:
            return db.execute(select(func.count()).select_from(usage).where(
                usage.c.account_id == account.id, usage.c.created_at >= now() - timedelta(minutes=1))).scalar_one()

    def grant_purchase(self, account: Account, credits: int, session_id: str, payment_intent: str | None = None) -> bool:
        """Credit a paid Checkout Session exactly once (idempotent on the session id)."""
        try:
            with self.engine.begin() as db:
                db.execute(insert(ledger).values(account_id=account.id, delta=credits, reason='purchase',
                                                 ref=f'stripe:{session_id}', created_at=now()))
                db.execute(insert(purchases).values(account_id=account.id, session_id=session_id,
                                                    payment_intent=payment_intent, credits=credits, reversed=0,
                                                    created_at=now()))
                db.execute(update(accounts).where(accounts.c.id == account.id).values(balance=accounts.c.balance + credits))
            return True
        except IntegrityError:
            if payment_intent:
                self.link_payment_intent(session_id, payment_intent)
            return False

    def link_payment_intent(self, session_id: str, payment_intent: str) -> None:
        with self.engine.begin() as db:
            db.execute(update(purchases).where(purchases.c.session_id == session_id,
                                               purchases.c.payment_intent.is_(None)).values(payment_intent=payment_intent))

    def find_purchase(self, session_id: str | None = None, payment_intent: str | None = None) -> dict | None:
        """The purchase for a Checkout Session or PaymentIntent id.

        Purchases credited before the purchases table existed are found through
        their ledger entry and copied into it on first lookup.
        """
        with self.engine.begin() as db:
            if session_id:
                row = db.execute(select(purchases).where(purchases.c.session_id == session_id)).mappings().first()
            elif payment_intent:
                row = db.execute(select(purchases).where(purchases.c.payment_intent == payment_intent)).mappings().first()
            else:
                return None
            if row or not session_id:
                return dict(row) if row else None
            legacy = db.execute(select(ledger).where(ledger.c.ref == f'stripe:{session_id}',
                                                     ledger.c.reason == 'purchase')).mappings().first()
            if not legacy:
                return None
            db.execute(insert(purchases).values(account_id=legacy['account_id'], session_id=session_id,
                                                payment_intent=payment_intent, credits=legacy['delta'], reversed=0,
                                                created_at=legacy['created_at']))
            return dict(db.execute(select(purchases).where(purchases.c.session_id == session_id)).mappings().first())

    def reverse_purchase(self, session_id: str, covered: int) -> dict:
        """Remove the credits of a refunded or disputed purchase.

        ``covered`` is how many of the purchase's credits the refunds and
        disputes so far account for (it only grows), so repeated or overlapping
        Stripe events never remove credits twice. At most the account's unspent
        balance is removed; the balance never goes below zero.
        """
        for _ in range(5):
            try:
                with self.engine.begin() as db:
                    row = db.execute(select(purchases).where(purchases.c.session_id == session_id)).mappings().first()
                    if row is None:
                        return {'found': False, 'removed': 0}
                    target = max(0, min(covered, row['credits']))
                    if target <= row['reversed']:
                        return {'found': True, 'removed': 0, 'reversed': row['reversed'], 'account_id': row['account_id']}
                    claimed = db.execute(update(purchases).where(purchases.c.id == row['id'],
                                                                 purchases.c.reversed == row['reversed'])
                                         .values(reversed=target))
                    if claimed.rowcount != 1:
                        continue
                    wanted = target - row['reversed']
                    balance = db.execute(select(accounts.c.balance).where(accounts.c.id == row['account_id'])).scalar_one()
                    removed = max(0, min(wanted, balance))
                    if removed:
                        taken = db.execute(update(accounts).where(accounts.c.id == row['account_id'],
                                                                  accounts.c.balance >= removed)
                                           .values(balance=accounts.c.balance - removed))
                        if taken.rowcount != 1:
                            raise _Retry()
                        db.execute(insert(ledger).values(account_id=row['account_id'], delta=-removed, reason='reversal',
                                                         ref=f'reversal:{session_id}:{target}'[:120], created_at=now()))
                    return {'found': True, 'removed': removed, 'reversed': target, 'account_id': row['account_id']}
            except _Retry:
                continue
        raise RuntimeError('Could not reverse the purchase; try again.')

    def adjust(self, account: Account, delta: int, reason: str, ref: str | None = None) -> None:
        with self.engine.begin() as db:
            db.execute(insert(ledger).values(account_id=account.id, delta=delta, reason=reason, ref=ref, created_at=now()))
            db.execute(update(accounts).where(accounts.c.id == account.id).values(balance=accounts.c.balance + delta))

    def event_known(self, event_id: str) -> bool:
        with self.engine.connect() as db:
            return db.execute(select(stripe_events.c.id).where(stripe_events.c.id == event_id)).first() is not None

    def event_seen(self, event_id: str) -> bool:
        try:
            with self.engine.begin() as db:
                db.execute(insert(stripe_events).values(id=event_id, created_at=now()))
            return False
        except IntegrityError:
            return True

    # ---------------------------------------------------- privacy operations

    def summary(self, account: Account) -> dict:
        since = now() - timedelta(days=30)
        with self.engine.connect() as db:
            rows = db.execute(select(usage.c.task, func.count(), func.sum(usage.c.input_tokens + usage.c.output_tokens))
                              .where(usage.c.account_id == account.id, usage.c.created_at >= since)
                              .group_by(usage.c.task)).all()
            spent = db.execute(select(func.coalesce(func.sum(ledger.c.delta), 0)).where(
                ledger.c.account_id == account.id, ledger.c.reason == 'charge', ledger.c.created_at >= since)).scalar_one()
        return {'last30Days': {'creditsUsed': -int(spent), 'calls': {task: count for task, count, _ in rows}}}

    def export(self, account: Account) -> dict:
        with self.engine.connect() as db:
            entries = db.execute(select(ledger.c.delta, ledger.c.reason, ledger.c.created_at)
                                 .where(ledger.c.account_id == account.id).order_by(ledger.c.id)).all()
            calls = db.execute(select(usage.c.task, usage.c.model, usage.c.input_tokens, usage.c.output_tokens,
                                      usage.c.ok, usage.c.created_at).where(usage.c.account_id == account.id)
                               .order_by(usage.c.id)).all()
            terms = db.execute(select(accounts.c.terms_version, accounts.c.terms_accepted_at)
                               .where(accounts.c.id == account.id)).mappings().first()
            tokens = db.execute(select(access_tokens.c.client, access_tokens.c.created_at, access_tokens.c.last_used_on,
                                       access_tokens.c.revoked_at).where(access_tokens.c.account_id == account.id)).all()
        iso = lambda value: value.isoformat() + 'Z' if value else None
        return {
            'account': {'id': account.public_id, 'email': account.email, 'balance': account.balance,
                        'termsVersion': terms['terms_version'], 'termsAcceptedAt': iso(terms['terms_accepted_at'])},
            'ledger': [{'delta': d, 'reason': r, 'at': iso(t)} for d, r, t in entries],
            'usage': [{'task': t, 'model': m, 'inputTokens': i, 'outputTokens': o, 'ok': ok, 'at': iso(at)}
                      for t, m, i, o, ok, at in calls],
            'devices': [{'client': c, 'signedInAt': iso(a), 'lastUsedOn': iso(u), 'revokedAt': iso(r)} for c, a, u, r in tokens],
            'notStored': ('Prompts, models, equations, and AI responses are not stored or logged by Gradara AI. '
                          'Its AI provider, Anthropic, may keep them briefly for abuse and safety monitoring.'),
        }

    def delete_account(self, account: Account) -> str | None:
        """Erase personal data; unspent credits are forfeited.

        What remains is pseudonymous: the ledger and purchases rows (amounts,
        dates, Stripe ids) stay under the internal account id for accounting,
        and keyed hashes of the sign-in id and email stay in deleted_identities
        so signing in again does not grant welcome credits a second time.
        """
        with self.engine.begin() as db:
            row = db.execute(select(accounts.c.identity, accounts.c.email)
                             .where(accounts.c.id == account.id)).mappings().first()
            identity = row['identity'] if row else None
            for marker in self.markers(identity, row['email'] if row else None):
                if not db.execute(select(deleted_identities.c.marker).where(deleted_identities.c.marker == marker)).first():
                    db.execute(insert(deleted_identities).values(marker=marker, created_at=now()))
            db.execute(update(access_tokens).where(access_tokens.c.account_id == account.id, access_tokens.c.revoked_at.is_(None))
                       .values(revoked_at=now()))
            db.execute(delete(usage).where(usage.c.account_id == account.id))
            db.execute(delete(job_parts).where(job_parts.c.job_row.in_(
                select(jobs.c.id).where(jobs.c.account_id == account.id))))
            db.execute(delete(jobs).where(jobs.c.account_id == account.id))
            db.execute(delete(device_codes).where(device_codes.c.account_id == account.id))
            if account.balance:
                db.execute(insert(ledger).values(account_id=account.id, delta=-account.balance, reason='forfeit',
                                                 ref=f'forfeit:{account.public_id}', created_at=now()))
            db.execute(update(accounts).where(accounts.c.id == account.id)
                       .values(identity=None, email=None, balance=0, deleted_at=now(), terms_accepted_at=None))
        return identity

    def purge(self) -> dict:
        """Retention: usage rows expire; sign-in codes, finished job counters, and Stripe event ids are short-lived."""
        cutoff = now() - timedelta(days=self.config.usage_retention_days)
        with self.engine.begin() as db:
            old_usage = db.execute(delete(usage).where(usage.c.created_at < cutoff)).rowcount
            old_codes = db.execute(delete(device_codes).where(device_codes.c.expires_at < now() - timedelta(days=1))).rowcount
            finished = select(jobs.c.id).where(jobs.c.created_at < now() - timedelta(days=7))
            db.execute(delete(job_parts).where(job_parts.c.job_row.in_(finished)))
            old_jobs = db.execute(delete(jobs).where(jobs.c.created_at < now() - timedelta(days=7))).rowcount
            old_tokens = db.execute(delete(access_tokens).where(and_(access_tokens.c.revoked_at.is_not(None),
                                                                     access_tokens.c.revoked_at < now() - timedelta(days=30)))).rowcount
            old_events = db.execute(delete(stripe_events).where(
                stripe_events.c.created_at < now() - timedelta(days=STRIPE_EVENT_RETENTION_DAYS))).rowcount
        return {'usage': old_usage, 'deviceCodes': old_codes, 'jobs': old_jobs, 'revokedTokens': old_tokens,
                'stripeEvents': old_events}
