# SPDX-License-Identifier: Apache-2.0
"""Gateway behavior: sign-in, credits, generation, billing, privacy operations."""
from __future__ import annotations

import io
import json
import logging
import sys
from pathlib import Path
from types import SimpleNamespace

import pytest
from fastapi.testclient import TestClient

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
sys.path.insert(0, str(Path(__file__).resolve().parents[2]))

from gateway.app import FakeProvider, create_app  # noqa: E402
from gateway.config import Config  # noqa: E402
from gateway.db import usage  # noqa: E402
from server.llm.providers import ProviderError  # noqa: E402

SCHEMA = {'type': 'object', 'properties': {'name': {'type': 'string'}}, 'required': ['name']}
SECRET_PROMPT = 'Design a PI controller for my confidential motor drive project, internal code ORCA-7.'


def make(tmp_path, responder=None, **overrides):
    packs = [{'id': 'starter', 'credits': 100, 'amount': 1000, 'currency': 'usd', 'label': '100 credits',
              'priceId': 'price_123'}]
    cfg = Config(database_url=f'sqlite:///{tmp_path}/gw.db', auth_mode='dev', llm_provider='fake',
                 public_url='https://ai.example.test', stripe_secret_key='sk_test_x',
                 stripe_webhook_secret='whsec_x', packs=packs, free_credits=10, **overrides)
    provider = FakeProvider(responder or (lambda prompt, schema: {'name': 'ok'}))
    app = create_app(cfg, provider)
    return TestClient(app), app, provider


def sign_in(client, email='engineer@example.com') -> str:
    start = client.post('/v1/device/start', json={'client': 'Gradara test'}).json()
    assert start['verificationUrl'].startswith('https://ai.example.test/activate?code=')
    assert client.post('/v1/device/token', json={'deviceCode': start['deviceCode']}).json() == {'status': 'pending'}
    approved = client.post('/v1/device/approve', json={'userCode': start['userCode'].lower().replace('-', ''),
                                                       'devEmail': email})
    assert approved.status_code == 200, approved.text
    token = client.post('/v1/device/token', json={'deviceCode': start['deviceCode']}).json()
    assert token['status'] == 'approved' and token['token'].startswith('gra_')
    again = client.post('/v1/device/token', json={'deviceCode': start['deviceCode']}).json()
    assert again == {'status': 'consumed'}, 'tokens are issued once'
    return token['token']


def auth(token):
    return {'Authorization': f'Bearer {token}'}


def generate(client, token, job='job-0001', kind='component', task='component', prompt=SECRET_PROMPT):
    return client.post('/v1/generate', headers=auth(token),
                       json={'task': task, 'job': {'id': job, 'kind': kind}, 'prompt': prompt, 'schema': SCHEMA})


def test_device_sign_in_and_welcome_credits(tmp_path):
    client, *_ = make(tmp_path)
    token = sign_in(client)
    account = client.get('/v1/account', headers=auth(token)).json()
    assert account['email'] == 'engineer@example.com' and account['balance'] == 10
    assert account['prices']['component'] == 2
    assert all('priceId' not in pack for pack in account['packs'])


def test_welcome_grant_is_once_per_identity(tmp_path):
    client, *_ = make(tmp_path)
    first = sign_in(client)
    generate(client, first)
    second = sign_in(client)
    assert client.get('/v1/account', headers=auth(second)).json()['balance'] == 8


def test_expired_or_unknown_code_is_refused(tmp_path):
    client, *_ = make(tmp_path)
    response = client.post('/v1/device/approve', json={'userCode': 'BCDF-GHJK', 'devEmail': 'a@example.com'})
    assert response.status_code == 410


def test_charging_and_insufficient_credits(tmp_path):
    client, *_ = make(tmp_path)
    token = sign_in(client)
    one = generate(client, token, job='comp-0001')
    assert one.status_code == 200 and one.json()['charged'] == 2 and one.json()['balance'] == 8
    repair = generate(client, token, job='comp-0001')
    assert repair.json()['charged'] == 0 and repair.json()['balance'] == 8
    model = generate(client, token, job='model-0001', kind='model', task='model-plan')
    assert model.status_code == 402 and 'Not enough credits' in model.json()['detail']


def test_retry_limit_per_job(tmp_path):
    client, *_ = make(tmp_path)
    token = sign_in(client)
    codes = [generate(client, token, job='comp-0002').status_code for _ in range(5)]
    assert codes == [200, 200, 200, 200, 429]


def test_task_and_kind_must_match(tmp_path):
    client, *_ = make(tmp_path)
    token = sign_in(client)
    assert generate(client, token, task='model-plan', kind='component').status_code == 422
    bad_schema = client.post('/v1/generate', headers=auth(token), json={
        'task': 'component', 'job': {'id': 'j-0001', 'kind': 'component'}, 'prompt': SECRET_PROMPT,
        'schema': {'type': 'string'}})
    assert bad_schema.status_code == 422


def test_provider_failure_refunds_first_call(tmp_path):
    def failing(prompt, schema):
        raise ProviderError('upstream said: ' + prompt, 503)
    client, *_ = make(tmp_path, failing)
    token = sign_in(client)
    response = generate(client, token, job='comp-0003')
    assert response.status_code == 503
    assert SECRET_PROMPT not in response.text
    assert client.get('/v1/account', headers=auth(token)).json()['balance'] == 10


def test_prompts_and_outputs_are_never_logged_or_stored(tmp_path, caplog):
    stream = io.StringIO()
    client, app, _ = make(tmp_path, lambda prompt, schema: {'name': 'ORCA-7 answer'})
    handler = logging.StreamHandler(stream)
    logging.getLogger('gradara.gateway').addHandler(handler)
    token = sign_in(client)
    assert generate(client, token, job='comp-0004').status_code == 200
    logs = stream.getvalue()
    assert 'rid' in logs and 'ORCA-7' not in logs and SECRET_PROMPT not in logs
    assert token not in logs
    database = (tmp_path/'gw.db').read_bytes() + b''.join(p.read_bytes() for p in tmp_path.glob('gw.db-*'))
    assert b'ORCA-7' not in database and b'confidential' not in database
    assert token.encode() not in database, 'only token hashes are stored'
    with app.state.store.engine.connect() as db:
        rows = db.execute(usage.select()).mappings().all()
    assert rows and set(rows[0].keys()) == {'id', 'account_id', 'job_id', 'task', 'model', 'input_tokens',
                                            'output_tokens', 'latency_ms', 'ok', 'error', 'created_at'}


def test_export_and_delete_account(tmp_path):
    client, app, _ = make(tmp_path)
    token = sign_in(client)
    generate(client, token, job='comp-0005')
    exported = client.get('/v1/account/export', headers=auth(token)).json()
    assert exported['account']['email'] == 'engineer@example.com' and exported['usage'][0]['task'] == 'component'
    assert client.delete('/v1/account', headers=auth(token)).json() == {'deleted': True}
    assert client.get('/v1/account', headers=auth(token)).status_code == 401
    database = (tmp_path/'gw.db').read_bytes() + b''.join(p.read_bytes() for p in tmp_path.glob('gw.db-*'))
    with app.state.store.engine.connect() as db:
        assert not db.execute(usage.select()).all()
    # A new sign-in with the same email is a fresh account (identity was erased).
    fresh = sign_in(client)
    assert client.get('/v1/account', headers=auth(fresh)).json()['balance'] == 10
    del database


def test_sign_out_revokes_token(tmp_path):
    client, *_ = make(tmp_path)
    token = sign_in(client)
    assert client.post('/v1/auth/signout', headers=auth(token)).status_code == 200
    assert client.get('/v1/account', headers=auth(token)).status_code == 401


def test_checkout_and_idempotent_webhook(tmp_path, monkeypatch):
    client, app, _ = make(tmp_path)
    token = sign_in(client)
    created = {}

    class Sessions:
        def create(self, params):
            created.update(params)
            return SimpleNamespace(url='https://checkout.stripe.test/c/1')

    class FakeStripe:
        def __init__(self, key):
            self.v1 = SimpleNamespace(checkout=SimpleNamespace(sessions=Sessions()))

        def construct_event(self, payload, signature, secret):
            if signature != 'good':
                raise ValueError('bad signature')
            data = json.loads(payload)
            obj = SimpleNamespace(to_dict=lambda: data['data']['object'])
            return SimpleNamespace(id=data['id'], type=data['type'], data=SimpleNamespace(object=obj))

    import stripe
    monkeypatch.setattr(stripe, 'StripeClient', FakeStripe)
    response = client.post('/v1/billing/checkout', headers=auth(token), json={'pack': 'starter'})
    assert response.json() == {'url': 'https://checkout.stripe.test/c/1'}
    assert created['line_items'][0]['price'] == 'price_123' and created['mode'] == 'payment'
    account_id = created['client_reference_id']
    event = {'id': 'evt_1', 'type': 'checkout.session.completed', 'data': {'object': {
        'id': 'cs_1', 'payment_status': 'paid', 'metadata': {'account': account_id, 'pack': 'starter', 'credits': '100'}}}}
    assert client.post('/v1/billing/webhook', content=json.dumps(event), headers={'Stripe-Signature': 'bad'}).status_code == 400
    for event_id in ('evt_1', 'evt_1', 'evt_2'):
        event['id'] = event_id
        assert client.post('/v1/billing/webhook', content=json.dumps(event), headers={'Stripe-Signature': 'good'}).status_code == 200
    assert client.get('/v1/account', headers=auth(token)).json()['balance'] == 110
    unpaid = dict(event, id='evt_3')
    unpaid['data'] = {'object': dict(event['data']['object'], id='cs_2', payment_status='unpaid')}
    client.post('/v1/billing/webhook', content=json.dumps(unpaid), headers={'Stripe-Signature': 'good'})
    assert client.get('/v1/account', headers=auth(token)).json()['balance'] == 110


def test_production_refuses_dev_auth_and_sqlite():
    with pytest.raises(RuntimeError, match='not production-ready'):
        Config(env='production').validate()


def test_rate_limit(tmp_path):
    client, *_ = make(tmp_path, rate_per_minute=2)
    token = sign_in(client)
    codes = [generate(client, token, job=f'comp-10{i}').status_code for i in range(3)]
    assert codes == [200, 200, 429]


def test_pages_have_restrictive_headers(tmp_path):
    client, *_ = make(tmp_path)
    page = client.get('/activate')
    assert page.status_code == 200 and "frame-ancestors 'none'" in page.headers['content-security-policy']
    assert client.get('/static/activate.js').status_code == 200
    assert client.get('/static/../app.py').status_code == 404
