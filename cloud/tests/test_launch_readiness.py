# SPDX-License-Identifier: Apache-2.0
"""Refunds, disputes, failure refunds, deleted identities, retention, and Terms acceptance."""
from __future__ import annotations

import json
import sqlite3
from datetime import timedelta
from types import SimpleNamespace

import pytest
from sqlalchemy import insert, select, update

from gateway import admin
from gateway.config import TERMS_VERSION
from gateway.db import accounts, connect, deleted_identities, ledger, now, purchases, stripe_events
from test_gateway import SECRET_PROMPT, auth, balance, generate, make, sign_in


class FakeStripe:
    sessions_by_intent: dict = {}
    charges: dict = {}

    def __init__(self, key):
        sessions = SimpleNamespace(
            create=lambda params: SimpleNamespace(url='https://checkout.stripe.test/c/1'),
            list=lambda params: SimpleNamespace(data=[{'id': s} for s in
                                                      [FakeStripe.sessions_by_intent.get(params['payment_intent'])] if s]))
        charges = SimpleNamespace(retrieve=lambda cid: SimpleNamespace(payment_intent=FakeStripe.charges.get(cid)))
        self.v1 = SimpleNamespace(checkout=SimpleNamespace(sessions=sessions), charges=charges)

    def construct_event(self, payload, signature, secret):
        if signature != 'good':
            raise ValueError('bad signature')
        data = json.loads(payload)
        obj = SimpleNamespace(to_dict=lambda: data['data']['object'])
        return SimpleNamespace(id=data['id'], type=data['type'], data=SimpleNamespace(object=obj))


@pytest.fixture
def stripe_fake(monkeypatch):
    import stripe
    FakeStripe.sessions_by_intent, FakeStripe.charges = {}, {}
    monkeypatch.setattr(stripe, 'StripeClient', FakeStripe)
    return FakeStripe


def send(client, event_id, kind, obj):
    body = {'id': event_id, 'type': kind, 'data': {'object': obj}}
    response = client.post('/v1/billing/webhook', content=json.dumps(body), headers={'Stripe-Signature': 'good'})
    assert response.status_code == 200, response.text
    return response.json()


def buy(client, app, token, session='cs_1', intent='pi_1', event='evt_buy'):
    public_id = client.get('/v1/account/export', headers=auth(token)).json()['account']['id']
    send(client, event, 'checkout.session.completed', {
        'id': session, 'payment_status': 'paid', 'payment_intent': intent,
        'metadata': {'account': public_id, 'pack': 'starter', 'credits': '100'}})
    return public_id


def test_full_refund_removes_the_purchased_credits_once(tmp_path, stripe_fake):
    client, app, _ = make(tmp_path)
    token = sign_in(client)
    buy(client, app, token)
    assert balance(client, token) == 110
    refund = {'id': 'ch_1', 'payment_intent': 'pi_1', 'amount': 1000, 'amount_refunded': 1000, 'refunded': True}
    send(client, 'evt_r1', 'charge.refunded', refund)
    assert balance(client, token) == 10
    assert send(client, 'evt_r1', 'charge.refunded', refund) == {'received': True, 'duplicate': True}
    send(client, 'evt_r1b', 'charge.refunded', refund)  # a different event for the same refund
    assert balance(client, token) == 10


def test_partial_refund_is_proportional_and_never_goes_below_zero(tmp_path, stripe_fake):
    client, app, _ = make(tmp_path, free_credits=0, rate_per_minute=100)
    token = sign_in(client)
    buy(client, app, token)
    send(client, 'evt_p1', 'charge.refunded', {'id': 'ch_1', 'payment_intent': 'pi_1', 'amount': 1000,
                                               'amount_refunded': 250, 'refunded': False})
    assert balance(client, token) == 75
    for n in range(35):  # spend 70 credits
        assert generate(client, token, job=f'comp-{n:04d}').status_code == 200
    assert balance(client, token) == 5
    send(client, 'evt_p2', 'charge.dispute.created', {'id': 'dp_1', 'charge': 'ch_1', 'payment_intent': 'pi_1',
                                                      'amount': 750})
    assert balance(client, token) == 0
    with app.state.store.engine.connect() as db:
        assert db.execute(select(purchases.c.reversed)).scalar_one() == 100
        reversals = db.execute(select(ledger.c.delta).where(ledger.c.reason == 'reversal')).scalars().all()
    assert reversals == [-25, -5]


def test_dispute_without_payment_intent_resolves_through_the_charge(tmp_path, stripe_fake):
    client, app, _ = make(tmp_path)
    token = sign_in(client)
    buy(client, app, token)
    stripe_fake.charges['ch_9'] = 'pi_1'
    send(client, 'evt_d1', 'charge.dispute.created', {'id': 'dp_9', 'charge': 'ch_9', 'amount': 1000})
    assert balance(client, token) == 10


def test_refund_of_a_purchase_made_before_intents_were_recorded(tmp_path, stripe_fake):
    client, app, _ = make(tmp_path)
    token = sign_in(client)
    public_id = client.get('/v1/account/export', headers=auth(token)).json()['account']['id']
    account = app.state.store.account_by_public_id(public_id)
    with app.state.store.engine.begin() as db:  # the shape of a purchase credited by the previous release
        db.execute(insert(ledger).values(account_id=account.id, delta=100, reason='purchase', ref='stripe:cs_old',
                                         created_at=now()))
        db.execute(update(accounts).where(accounts.c.id == account.id).values(balance=accounts.c.balance + 100))
    stripe_fake.sessions_by_intent['pi_old'] = 'cs_old'
    send(client, 'evt_o1', 'charge.refunded', {'id': 'ch_o', 'payment_intent': 'pi_old', 'amount': 1000,
                                               'amount_refunded': 1000, 'refunded': True})
    assert balance(client, token) == 10


def test_refund_for_an_unknown_payment_is_ignored(tmp_path, stripe_fake):
    client, *_ = make(tmp_path)
    token = sign_in(client)
    send(client, 'evt_u1', 'charge.refunded', {'id': 'ch_x', 'payment_intent': 'pi_x', 'amount': 500,
                                               'amount_refunded': 500, 'refunded': True})
    assert balance(client, token) == 10


def test_admin_refund_by_session_after_account_deletion(tmp_path, stripe_fake):
    client, app, _ = make(tmp_path)
    token = sign_in(client)
    buy(client, app, token)
    store = app.state.store
    partial = admin.run(store, ['refund', 'cs_1', '30'])
    assert partial['removed'] == 30 and balance(client, token) == 80
    # A Stripe refund of the whole purchase afterwards removes only the rest.
    send(client, 'evt_a1', 'charge.refunded', {'id': 'ch_1', 'payment_intent': 'pi_1', 'amount': 1000,
                                               'amount_refunded': 1000, 'refunded': True})
    assert balance(client, token) == 10
    client.delete('/v1/account', headers=auth(token))
    after = admin.run(store, ['refund', 'cs_1'])
    assert after['removed'] == 0 and after['deleted'] is True
    with pytest.raises(SystemExit):
        admin.run(store, ['refund', 'cs_missing'])


def test_admin_refund_by_email(tmp_path, stripe_fake):
    client, app, _ = make(tmp_path)
    token = sign_in(client)
    buy(client, app, token)
    result = admin.run(app.state.store, ['refund', 'engineer@example.com', '100', '--ref', 're_1'])
    assert result['balance'] == 10
    with pytest.raises(SystemExit):
        admin.run(app.state.store, ['refund', 'engineer@example.com', '5'])


@pytest.mark.parametrize('error', [RuntimeError('bug'), KeyError('data'), TypeError('shape')])
def test_any_failure_in_the_ai_call_is_refunded(tmp_path, error):
    def failing(prompt, schema):
        raise error
    client, *_ = make(tmp_path, failing)
    token = sign_in(client)
    response = generate(client, token, job='comp-0100')
    assert response.status_code == 502 and 'not charged' in response.json()['detail']
    assert SECRET_PROMPT not in response.text
    assert balance(client, token) == 10


def test_failure_after_the_provider_answers_is_refunded(tmp_path, monkeypatch):
    client, app, _ = make(tmp_path)
    token = sign_in(client)
    store = app.state.store
    original = store.finish_job_call

    def broken(account, call, ok):
        if ok:
            raise RuntimeError('database hiccup')
        return original(account, call, ok)
    monkeypatch.setattr(store, 'finish_job_call', broken)
    assert generate(client, token, job='comp-0101').status_code == 502
    assert balance(client, token) == 10


def test_deleted_identity_gets_no_second_welcome_grant(tmp_path):
    client, app, _ = make(tmp_path)
    token = sign_in(client, 'someone@example.com')
    client.delete('/v1/account', headers=auth(token))
    with app.state.store.engine.connect() as db:
        markers = db.execute(select(deleted_identities.c.marker)).scalars().all()
    assert len(markers) == 2 and all(len(m) == 64 for m in markers)
    with app.state.store.engine.connect() as db:
        assert db.execute(select(accounts.c.identity, accounts.c.email)).all() == [(None, None)]
    again = sign_in(client, 'Someone@Example.com')
    assert balance(client, again) == 0
    other = sign_in(client, 'another@example.com')
    assert balance(client, other) == 10
    # A deletion by a different sign-in id with the same email is also caught.
    assert app.state.store.account_for_identity('firebase:new-uid', 'someone@example.com').balance == 0


def test_markers_depend_on_the_pepper(tmp_path):
    (tmp_path/'a').mkdir()
    (tmp_path/'b').mkdir()
    _, app_a, _ = make(tmp_path/'a', identity_pepper='one')
    _, app_b, _ = make(tmp_path/'b', identity_pepper='two')
    assert app_a.state.store.markers('dev:x', 'x@example.com') != app_b.state.store.markers('dev:x', 'x@example.com')


def test_sign_in_records_the_terms_version(tmp_path):
    client, app, _ = make(tmp_path)
    token = sign_in(client)
    exported = client.get('/v1/account/export', headers=auth(token)).json()['account']
    assert exported['termsVersion'] == TERMS_VERSION and exported['termsAcceptedAt']


def test_existing_database_gains_the_new_columns(tmp_path):
    path = tmp_path/'old.db'
    with sqlite3.connect(path) as raw:
        raw.execute('CREATE TABLE accounts (id INTEGER PRIMARY KEY, public_id VARCHAR(40) UNIQUE NOT NULL, '
                    'identity VARCHAR(160) UNIQUE, email VARCHAR(320), balance INTEGER NOT NULL, '
                    'created_at DATETIME NOT NULL, deleted_at DATETIME)')
        raw.execute("INSERT INTO accounts VALUES (1, 'acct_1', 'dev:a@example.com', 'a@example.com', 5, "
                    "'2026-01-01 00:00:00', NULL)")
    engine = connect(f'sqlite:///{path}')
    connect(f'sqlite:///{path}')  # running the migration twice is harmless
    with engine.connect() as db:
        row = db.execute(select(accounts)).mappings().first()
    assert row['balance'] == 5 and row['terms_version'] is None


def test_purge_removes_old_stripe_events(tmp_path):
    client, app, _ = make(tmp_path)
    store = app.state.store
    store.event_seen('evt_old')
    store.event_seen('evt_new')
    with store.engine.begin() as db:
        db.execute(update(stripe_events).where(stripe_events.c.id == 'evt_old')
                   .values(created_at=now() - timedelta(days=91)))
    assert admin.run(store, ['purge'])['stripeEvents'] == 1
    with store.engine.connect() as db:
        assert db.execute(select(stripe_events.c.id)).scalars().all() == ['evt_new']


def test_production_requires_a_pepper_or_admin_token():
    from gateway.config import Config
    with pytest.raises(RuntimeError, match='IDENTITY_PEPPER'):
        Config(env='production').validate()


def test_sign_in_rate_limit_forgets_ip_addresses(tmp_path, monkeypatch):
    import gateway.app as gateway_app
    client, app, _ = make(tmp_path)
    clock = {'t': 1000.0}
    monkeypatch.setattr(gateway_app.time, 'monotonic', lambda: clock['t'])
    client.post('/v1/device/start', json={}, headers={'X-Forwarded-For': '203.0.113.7'})
    assert '203.0.113.7' in app.state.ip_starts
    clock['t'] += 61
    client.post('/v1/device/start', json={}, headers={'X-Forwarded-For': '198.51.100.2'})
    assert set(app.state.ip_starts) == {'198.51.100.2'}
