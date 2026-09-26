# SPDX-License-Identifier: Apache-2.0
"""Gradara AI gateway: accounts, prepaid credits, and schema-bound AI generation.

Privacy contract (see docs/PRIVACY.md):
* Request bodies are processed in memory and never logged or stored.
* Logs contain method, route template, status, latency, and a request id only.
* Only Gradara task types with a JSON output schema are accepted, so the
  gateway cannot be used as a general-purpose chat proxy.
"""
from __future__ import annotations

import asyncio
import json
import logging
import re
import secrets
import sys
import time
from collections import defaultdict, deque
from contextlib import asynccontextmanager
from pathlib import Path
from typing import Any

from fastapi import Depends, FastAPI, Header, HTTPException, Request
from fastapi.responses import FileResponse, HTMLResponse, JSONResponse, RedirectResponse
from pydantic import BaseModel, Field

from . import config as config_module
from .db import connect
from .identity import Identity, IdentityError, delete_remote_identity, verify
from .store import Account, InsufficientCredits, Store

ROOT = Path(__file__).resolve().parents[2]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))
from server.llm.providers import Generation, ProviderError, Usage, make_provider  # noqa: E402

PAGES = Path(__file__).parent/'pages'
TASK_KINDS = {'component': {'component', 'model'}, 'model-plan': {'model'}, 'model-assembly': {'model'},
              'export': {'export'}}
MAX_BODY = 1_500_000
MAX_PROMPT = 400_000
MAX_SCHEMA = 64_000
JOB_ID = re.compile(r'^[A-Za-z0-9_.-]{4,80}$')

log = logging.getLogger('gradara.gateway')


def _configure_logging() -> None:
    handler = logging.StreamHandler(sys.stdout)
    handler.setFormatter(logging.Formatter('%(message)s'))
    log.handlers[:] = [handler]
    log.setLevel(logging.INFO)
    log.propagate = False


class DeviceStart(BaseModel):
    client: str = Field(default='Gradara desktop', max_length=80)

class DeviceToken(BaseModel):
    deviceCode: str = Field(min_length=20, max_length=100)

class Approve(BaseModel):
    userCode: str = Field(min_length=8, max_length=12)
    idToken: str | None = Field(default=None, max_length=8000)
    devEmail: str | None = Field(default=None, max_length=320)

class JobRef(BaseModel):
    id: str = Field(max_length=80)
    kind: str = Field(pattern='^(component|model|export)$')

class GenerateBody(BaseModel):
    task: str = Field(pattern='^(component|model-plan|model-assembly|export)$')
    job: JobRef
    prompt: str = Field(min_length=10, max_length=MAX_PROMPT)
    schema_: dict[str, Any] = Field(alias='schema')

class Checkout(BaseModel):
    pack: str = Field(max_length=40)


class FakeProvider:
    """Deterministic responses for tests and local development (never production)."""
    name = 'fake'

    def __init__(self, responder=None):
        self.responder = responder

    async def generate(self, prompt: str, schema: dict, *, schema_name: str = 'gradara_result') -> Generation:
        data = self.responder(prompt, schema) if self.responder else {}
        return Generation(data, 'fake', 'fake-model', Usage(len(prompt) // 4, 50))


def create_app(cfg: config_module.Config | None = None, provider=None) -> FastAPI:
    cfg = cfg or config_module.load()
    store = Store(connect(cfg.database_url), cfg)
    llm = provider or (FakeProvider() if cfg.llm_provider == 'fake' else None)
    if llm is None:
        llm = make_provider(cfg.llm_provider, cfg.llm_api_key, cfg.llm_model)
    if cfg.production and isinstance(llm, FakeProvider):
        raise RuntimeError('The fake provider cannot run in production.')
    _configure_logging()
    concurrency: dict[int, int] = defaultdict(int)
    ip_starts: dict[str, deque] = defaultdict(deque)

    async def purge_loop():
        while True:
            try:
                result = await asyncio.to_thread(store.purge)
                log.info(json.dumps({'event': 'retention_purge', **result}))
            except Exception as exc:  # pragma: no cover - operational
                log.info(json.dumps({'event': 'retention_purge_failed', 'error': type(exc).__name__}))
            await asyncio.sleep(6 * 3600)

    @asynccontextmanager
    async def lifespan(app):
        task = asyncio.create_task(purge_loop())
        yield
        task.cancel()

    app = FastAPI(title='Gradara AI', lifespan=lifespan, docs_url=None if cfg.production else '/docs',
                  redoc_url=None, openapi_url=None if cfg.production else '/openapi.json')
    app.state.store, app.state.config = store, cfg

    @app.middleware('http')
    async def privacy_log(request: Request, call_next):
        started = time.monotonic()
        request_id = secrets.token_hex(6)
        length = request.headers.get('content-length')
        if length and length.isdigit() and int(length) > MAX_BODY:
            return JSONResponse({'detail': 'Request too large.'}, status_code=413)
        try:
            response = await call_next(request)
        except Exception as exc:
            log.info(json.dumps({'event': 'error', 'rid': request_id, 'error': type(exc).__name__}))
            response = JSONResponse({'detail': 'Gradara AI had an internal problem. Try again.'}, status_code=500)
        route = request.scope.get('route')
        log.info(json.dumps({'rid': request_id, 'method': request.method,
                             'route': getattr(route, 'path', 'unmatched'), 'status': response.status_code,
                             'ms': int((time.monotonic() - started) * 1000)}))
        response.headers['X-Request-Id'] = request_id
        if request.url.path.startswith('/v1/'):
            response.headers['Cache-Control'] = 'no-store'
        response.headers['X-Content-Type-Options'] = 'nosniff'
        response.headers['Referrer-Policy'] = 'no-referrer'
        return response

    @app.exception_handler(ProviderError)
    async def provider_error(request: Request, exc: ProviderError):
        # Upstream detail may echo request fragments; return a generic message.
        status = 503 if exc.status >= 500 or exc.status == 429 else 502
        return JSONResponse({'detail': 'The AI model is temporarily unavailable. You were not charged; try again.'},
                            status_code=status)

    # ---------------------------------------------------------------- auth

    def current_account(authorization: str | None = Header(default=None)) -> tuple[Account, str]:
        if not authorization or not authorization.startswith('Bearer '):
            raise HTTPException(401, 'Sign in to Gradara AI.')
        token = authorization.removeprefix('Bearer ').strip()
        account = store.account_for_token(token)
        if account is None:
            raise HTTPException(401, 'Your sign-in expired or was revoked. Sign in again.')
        return account, token

    def client_ip(request: Request) -> str:
        forwarded = request.headers.get('x-forwarded-for')
        return forwarded.split(',')[0].strip() if forwarded else (request.client.host if request.client else '?')




    @app.post('/v1/device/start')
    async def device_start(body: DeviceStart, request: Request):
        window = ip_starts[client_ip(request)]
        cutoff = time.monotonic() - 60
        while window and window[0] < cutoff:
            window.popleft()
        if len(window) >= 10:
            raise HTTPException(429, 'Too many sign-in attempts. Wait a minute and try again.')
        window.append(time.monotonic())
        device_code, user_code = await asyncio.to_thread(store.start_device, body.client)
        return {'deviceCode': device_code, 'userCode': user_code, 'expiresIn': 600, 'interval': 3,
                'verificationUrl': f'{cfg.public_url}/activate?code={user_code}'}

    @app.post('/v1/device/token')
    async def device_token(body: DeviceToken):
        status, token, account = await asyncio.to_thread(store.redeem_device, body.deviceCode)
        if status == 'approved':
            return {'status': 'approved', 'token': token, 'email': account.email if account else None}
        return {'status': status}

    @app.post('/v1/device/approve')
    async def device_approve(body: Approve):
        try:
            identity: Identity = verify(cfg, body.idToken, body.devEmail)
        except IdentityError as exc:
            raise HTTPException(401, str(exc)) from exc
        account = await asyncio.to_thread(store.account_for_identity, identity.subject, identity.email)
        if not await asyncio.to_thread(store.approve_device, body.userCode, account):
            raise HTTPException(410, 'This code expired or was already used. Start sign-in again in Gradara.')
        return {'approved': True, 'email': account.email, 'balance': account.balance}

    @app.post('/v1/auth/signout')
    async def sign_out(auth=Depends(current_account)):
        await asyncio.to_thread(store.revoke_token, auth[1])
        return {'signedOut': True}

    # ------------------------------------------------------------- account

    def pricing() -> dict:
        return {'prices': cfg.prices, 'packs': [{k: v for k, v in p.items() if k != 'priceId'} for p in cfg.packs],
                'freeCredits': cfg.free_credits}

    @app.get('/v1/pricing')
    async def public_pricing():
        return pricing()

    @app.get('/v1/public-config')
    async def public_config():
        return {'authMode': cfg.auth_mode, 'supportEmail': cfg.support_email,
                'firebase': {'apiKey': cfg.firebase_web_api_key, 'authDomain': cfg.firebase_auth_domain,
                             'projectId': cfg.firebase_project_id}}

    @app.get('/v1/account')
    async def account_info(auth=Depends(current_account)):
        account = auth[0]
        summary = await asyncio.to_thread(store.summary, account)
        return {'email': account.email, 'balance': account.balance, **pricing(), **summary}

    @app.get('/v1/account/export')
    async def account_export(auth=Depends(current_account)):
        return await asyncio.to_thread(store.export, auth[0])

    @app.delete('/v1/account')
    async def account_delete(auth=Depends(current_account)):
        subject = await asyncio.to_thread(store.delete_account, auth[0])
        await asyncio.to_thread(delete_remote_identity, cfg, subject)
        return {'deleted': True}

    # ------------------------------------------------------------ generate



    @app.post('/v1/generate')
    async def generate(body: GenerateBody, auth=Depends(current_account)):
        account = auth[0]
        if body.job.kind not in TASK_KINDS[body.task]:
            raise HTTPException(422, 'This task does not belong to that kind of operation.')
        if not JOB_ID.match(body.job.id):
            raise HTTPException(422, 'Invalid operation id.')
        if body.schema_.get('type') != 'object' or len(json.dumps(body.schema_)) > MAX_SCHEMA:
            raise HTTPException(422, 'A JSON object schema is required.')
        if concurrency[account.id] >= cfg.max_concurrent:
            raise HTTPException(429, 'Too many AI requests at once. Wait for one to finish.')
        if await asyncio.to_thread(store.calls_last_minute, account) >= cfg.rate_per_minute:
            raise HTTPException(429, 'Too many AI requests. Wait a minute and try again.')
        try:
            call = await asyncio.to_thread(store.begin_job_call, account, body.job.id, body.job.kind)
        except InsufficientCredits:
            raise HTTPException(402, f'Not enough credits. This costs {cfg.prices[body.job.kind]} credits; '
                                     f'you have {account.balance}. Buy credits in Settings → AI.')
        except PermissionError as exc:
            raise HTTPException(429, str(exc))
        except ValueError as exc:
            raise HTTPException(422, str(exc))
        concurrency[account.id] += 1
        started = time.monotonic()
        try:
            result = await llm.generate(body.prompt, body.schema_)
        except ProviderError as exc:
            await asyncio.to_thread(store.finish_job_call, account, call, False)
            await asyncio.to_thread(store.record_usage, account, body.job.id, body.task, getattr(llm, 'model', ''),
                                    0, 0, int((time.monotonic() - started) * 1000), False, f'provider_{exc.status}')
            raise
        except asyncio.CancelledError:
            await asyncio.to_thread(store.finish_job_call, account, call, False)
            raise
        finally:
            concurrency[account.id] -= 1
        await asyncio.to_thread(store.finish_job_call, account, call, True)
        await asyncio.to_thread(store.record_usage, account, body.job.id, body.task, result.model,
                                result.usage.input_tokens, result.usage.output_tokens,
                                int((time.monotonic() - started) * 1000), True)
        balance = (await asyncio.to_thread(store.account, account.id)).balance
        return {'data': result.data, 'model': result.model, 'charged': call['charged'], 'balance': balance,
                'usage': {'inputTokens': result.usage.input_tokens, 'outputTokens': result.usage.output_tokens}}

    # ------------------------------------------------------------- billing


    def stripe_client():
        import stripe
        if not cfg.stripe_secret_key:
            raise HTTPException(503, 'Purchases are not configured on this server.')
        return stripe.StripeClient(cfg.stripe_secret_key)

    @app.post('/v1/billing/checkout')
    async def checkout(body: Checkout, auth=Depends(current_account)):
        account = auth[0]
        pack = cfg.pack(body.pack)
        if pack is None or not pack.get('priceId'):
            raise HTTPException(404, 'Unknown credit pack.')
        params = {
            'mode': 'payment',
            'line_items': [{'price': pack['priceId'], 'quantity': 1}],
            'success_url': f'{cfg.public_url}/billing/success',
            'cancel_url': f'{cfg.public_url}/billing/cancelled',
            'client_reference_id': account.public_id,
            'metadata': {'account': account.public_id, 'pack': pack['id'], 'credits': str(pack['credits'])},
            'customer_email': account.email,
        }
        if cfg.stripe_automatic_tax:
            params['automatic_tax'] = {'enabled': True}
        session = await asyncio.to_thread(stripe_client().v1.checkout.sessions.create, params)
        return {'url': session.url}

    @app.post('/v1/billing/webhook')
    async def stripe_webhook(request: Request, stripe_signature: str | None = Header(default=None)):
        payload = await request.body()
        try:
            event = stripe_client().construct_event(payload, stripe_signature, cfg.stripe_webhook_secret)
        except Exception:
            raise HTTPException(400, 'Invalid signature.')
        if event.type not in {'checkout.session.completed', 'checkout.session.async_payment_succeeded'}:
            return {'received': True, 'ignored': True}
        # Granting is idempotent on the Checkout Session id, so Stripe retries are safe.
        if event.type in {'checkout.session.completed', 'checkout.session.async_payment_succeeded'}:
            session = event.data.object
            session = session.to_dict() if hasattr(session, 'to_dict') else dict(session)
            if session.get('payment_status') == 'paid':
                metadata = session.get('metadata') or {}
                account = await asyncio.to_thread(store.account_by_public_id, metadata.get('account', ''))
                pack = cfg.pack(metadata.get('pack', ''))
                if account and pack:
                    await asyncio.to_thread(store.grant_purchase, account, int(pack['credits']), f'stripe:{session["id"]}')
        await asyncio.to_thread(store.event_seen, event.id)
        return {'received': True}

    # -------------------------------------------------------------- admin

    @app.post('/internal/purge')
    async def purge(authorization: str | None = Header(default=None)):
        if not cfg.admin_token or authorization != f'Bearer {cfg.admin_token}':
            raise HTTPException(404, 'Not found.')
        return await asyncio.to_thread(store.purge)

    @app.get('/healthz')
    async def healthz():
        return {'ok': True}

    # -------------------------------------------------------------- pages

    def page(name: str) -> FileResponse:
        return FileResponse(PAGES/name, headers={
            'Cache-Control': 'no-store',
            'Content-Security-Policy': ("default-src 'self'; script-src 'self' https://www.gstatic.com https://apis.google.com; "
                                        "connect-src 'self' https://*.googleapis.com https://*.firebaseapp.com; "
                                        "frame-src https://*.firebaseapp.com https://accounts.google.com; "
                                        "img-src 'self' data:; style-src 'self' 'unsafe-inline'; frame-ancestors 'none'"),
            'X-Frame-Options': 'DENY'})

    @app.get('/', include_in_schema=False)
    async def home():
        return RedirectResponse('https://gradara.app/')

    downloads = {
        'windows': 'Gradara-win-x64.exe', 'mac-arm64': 'Gradara-mac-arm64.dmg', 'mac-x64': 'Gradara-mac-x64.dmg',
        'linux-appimage': 'Gradara-linux-x86_64.AppImage', 'linux-deb': 'Gradara-linux-amd64.deb',
    }

    @app.get('/download/{platform}', include_in_schema=False)
    async def download(platform: str):
        # Stable links for the product page; installers are hosted on GitHub Releases.
        if platform not in downloads:
            raise HTTPException(404, 'Unknown download.')
        return RedirectResponse(f'{cfg.download_base}/{downloads[platform]}')

    @app.get('/source', include_in_schema=False)
    async def source():
        return RedirectResponse(cfg.source_url)

    @app.get('/activate', include_in_schema=False)
    async def activate():
        return page('activate.html')

    @app.get('/billing/success', include_in_schema=False)
    async def paid():
        return page('billing-success.html')

    @app.get('/billing/cancelled', include_in_schema=False)
    async def cancelled():
        return page('billing-cancelled.html')

    @app.get('/static/{name}', include_in_schema=False)
    async def static(name: str):
        if name not in {'activate.js', 'gateway.css'}:
            raise HTTPException(404)
        return page(name)

    return app


def main() -> FastAPI:  # uvicorn --factory gateway.app:main
    return create_app()


__all__ = ['create_app', 'main', 'FakeProvider', 'HTMLResponse']
