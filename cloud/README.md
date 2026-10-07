# Gradara AI gateway

Accounts, prepaid credits, and schema-bound AI generation for Gradara. Read [distribution and monetization](../docs/architecture/DISTRIBUTION.md) for the design and [privacy](../docs/PRIVACY.md) for the data rules this service must keep.

## Run locally

```sh
python3 -m venv .venv
.venv/bin/pip install -r cloud/requirements.txt pytest==9.1.1 httpx2==2.13.0
cd cloud
../.venv/bin/python -m pytest -q
DATABASE_URL=sqlite:///./dev.db LLM_PROVIDER=fake AUTH_MODE=dev PUBLIC_URL=http://127.0.0.1:8900 \
  ../.venv/bin/uvicorn --factory gateway.app:main --port 8900 --no-access-log
```

Point a source checkout or desktop build at it with `GRADARA_GATEWAY_URL=http://127.0.0.1:8900`. Development sign-in accepts any email. The `fake` provider returns empty objects, so generation reaches the app but fails its checks. Use `LLM_PROVIDER=anthropic` with `ANTHROPIC_API_KEY` for real output.

## Configuration

| Variable | Production value |
| --- | --- |
| `GATEWAY_ENV` | `production` (enables the startup checks below) |
| `PUBLIC_URL` | `https://api.gradara.app` |
| `DATABASE_URL` | `postgresql+psycopg://gateway:…@/gradara?host=/cloudsql/PROJECT:REGION:INSTANCE` |
| `AUTH_MODE` | `firebase` |
| `FIREBASE_PROJECT_ID`, `FIREBASE_WEB_API_KEY`, `FIREBASE_AUTH_DOMAIN` | From the Firebase console (web app config; the web API key is public by design) |
| `LLM_PROVIDER`, `LLM_MODEL` | `anthropic` + `claude-sonnet-5`, or `openai` + `gpt-6-sol` |
| `ANTHROPIC_API_KEY` or `OPENAI_API_KEY` | Secret Manager |
| `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET` | Secret Manager |
| `STRIPE_AUTOMATIC_TAX` | `true` after Stripe Tax registration |
| `CREDIT_PACKS` | JSON list with a Stripe `priceId` per pack (below) |
| `CREDIT_PRICES` | Optional JSON merged onto the defaults `{"component": 2, "model": 20, "export": 2, "edit": 4, "diagnose": 2, "results": 2}` |
| `CREDIT_SURCHARGES` | Optional JSON, default `{"edit": {"block": 2}}`: credits per new or rewritten block in an edit or fix |
| `FREE_CREDITS` | Welcome grant per verified identity, default 20 |
| `RATE_PER_MINUTE`, `MAX_CONCURRENT` | Per-account limits, defaults 20 and 3 |
| `USAGE_RETENTION_DAYS` | Default 400 |
| `ADMIN_TOKEN` | Secret Manager; enables `POST /internal/purge` |
| `IDENTITY_PEPPER` | Secret Manager; key for the hashes of deleted accounts' sign-in ids and emails that stop a second welcome grant. Falls back to `ADMIN_TOKEN` when unset. Set it once (`openssl rand -hex 32`) and never change it: a new value stops matching earlier deletions |
| `DOWNLOAD_BASE`, `SOURCE_URL` | Targets for `/download/{platform}` and `/source` redirects |
| `GATEWAY_REVISION` | Set by `deploy.sh deploy` to the deployed commit; `GET /health` reports it with the accepted task types |

With `GATEWAY_ENV=production` the service refuses to start with development sign-in, SQLite, missing keys, packs without Stripe prices, no `IDENTITY_PEPPER` or `ADMIN_TOKEN`, or a non-HTTPS public URL.

The Terms version recorded on each account at sign-in is `TERMS_VERSION` in `cloud/gateway/config.py`. Change it together with `site/public/terms.html` and `site/public/privacy.html`.

The schema is created at startup (`metadata.create_all`). Columns added to an existing table are listed in `ADDED_COLUMNS` in `cloud/gateway/db.py` and added once at startup, so deploying a new revision migrates the database.

`CREDIT_PACKS` example:

```json
[{"id":"starter","credits":100,"amount":1000,"currency":"usd","label":"100 credits","priceId":"price_…"},
 {"id":"pro","credits":550,"amount":5000,"currency":"usd","label":"550 credits","priceId":"price_…"}]
```

`amount` (in cents) is shown in the app; Stripe charges the Price. Keep them equal.

## Deploy on Google Cloud

The service runs in the Google Cloud project `gradara-2e47a` (the same project as the Firebase sign-in and the website), region `us-central1`. `cloud/deploy.sh` does the work from the repository root with `gcloud` signed in. Non-secret settings (project, region, Firebase web config, model, Stripe price ids) are in `cloud/deploy.env`. Secrets are typed at hidden prompts, checked with a free read-only call to the provider (Anthropic or OpenAI model list, Stripe balance), and only then stored in Secret Manager; the script never prints them. The Stripe check also reports whether the key is live or test mode.

```sh
cloud/deploy.sh setup     # once: APIs, Cloud SQL (db-f1-micro), service accounts, log exclusion,
                          # secrets, then the Stripe step below
cloud/deploy.sh stripe    # credit prices (by lookup key) and the payment webhook; its signing
                          # secret goes straight to Secret Manager
cloud/deploy.sh deploy    # build this checkout with Cloud Build and deploy to Cloud Run (also
                          # re-checks the request-log exclusion)
cloud/deploy.sh domain    # map api.gradara.app (after `gcloud domains verify gradara.app`)
cloud/deploy.sh secrets   # replace the vendor or Stripe keys (then it reruns the Stripe step)
cloud/deploy.sh status    # service URL, health, pricing, and whether the deployed revision
                          # is behind this checkout's gateway code
```

Set up by hand, once:

1. **Firebase Authentication.** Enable the Google and Email link (passwordless) providers, add `api.gradara.app` to the authorized domains, and create a web app whose config values go in `deploy.env`.
2. **Stripe.** Products and prices are created by `deploy.sh stripe` (lookup keys `gradara_credits_100` and `gradara_credits_550`). Set the support email and statement descriptor in the Stripe dashboard, and enable Stripe Tax when registrations are in place. The webhook endpoint must send `checkout.session.completed`, `checkout.session.async_payment_succeeded`, `charge.refunded`, and `charge.dispute.created`.
3. **Model vendor.** Use a dedicated API organization or workspace for production and set spend limits and alerts. The privacy notice says the vendor may keep request content briefly for abuse monitoring; if zero data retention is granted, the notice can say so.
4. **Domain.** Verify `gradara.app` in Search Console (`gcloud domains verify gradara.app`), run `deploy.sh domain`, and add the DNS record it prints.

The 600-second timeout covers long model-build calls. The in-memory per-account concurrency limit is per instance; keep `--max-instances` small until a shared limiter is needed.

Operations:

Admin commands run from `cloud/` with the production `DATABASE_URL` (and `IDENTITY_PEPPER` or `ADMIN_TOKEN`) in the environment: `python -m gateway.admin <command>`.

- **Retention** runs every six hours inside the service, and `deploy.sh deploy` schedules a daily `POST /internal/purge` as a backstop for instances that scale to zero. It deletes usage older than `USAGE_RETENTION_DAYS`, expired sign-in codes, job counters older than 7 days, tokens revoked more than 30 days ago, and Stripe event ids older than 90 days. Run it by hand with `python -m gateway.admin purge`.
- **Refunds and disputes** made in Stripe are applied by the webhook. `charge.refunded` removes the refunded share of the purchase's credits (rounded up; all of them for a full refund) and `charge.dispute.created` removes all of them. The purchase is found by its PaymentIntent id (recorded when the credits are granted; for older purchases the gateway asks Stripe for the Checkout Session). Removal is capped at the account's unspent balance, never makes it negative, and is recorded per purchase, so repeated events or a later manual refund never remove credits twice. Event ids are de-duplicated in `stripe_events`.
- **Refund policy.** Unused purchased credits are refunded on request within 14 days of purchase: refund the payment in Stripe (the webhook removes the credits). Failed AI calls are refunded automatically. Deleting an account forfeits its balance, so refund first when a user asks for both.
- **Manual corrections:** `python -m gateway.admin refund cs_live_…` removes a purchase's credits by Checkout Session id (add a number to remove only that many). It works after the account was deleted and shares the webhook's bookkeeping. `python -m gateway.admin refund someone@example.com 100 --ref re_…` removes credits from an active account by email.
- **Balance:** `python -m gateway.admin balance someone@example.com`.
- **Goodwill credits:** `python -m gateway.admin adjust someone@example.com 20 --reason goodwill`.
- **Monitoring.** Alert on 5xx rate and on vendor spend. Logs contain only route, status, latency, and request ids; do not enable request body logging.

## Pricing model

Costs scale with tokens. Development runs used about 16k tokens per block and 80k to 130k tokens per model build. At mid-tier model prices (about USD 2 per million input tokens and USD 10 per million output tokens), that is roughly USD 0.05 to 0.15 per block and USD 0.40 to 1.20 per model build, before retries. With 100 credits for USD 10, a block (2 credits) is USD 0.20 and a model (20 credits) is USD 2.00, which covers vendor cost, Stripe fees, and hosting with margin. Review these numbers against real usage records after launch; change `CREDIT_PRICES` rather than code.

A job pays its kind's price once, on its first call, with repairs included. Model edits (`edit`) and diagnoses (`diagnose`) can also carry priced parts, labelled on the request as `job.part`. Each new or rewritten block is a `block:<n>` part that pays the block surcharge once; at most three per job. The edit stage of a fix is the `edit` part and pays the edit price once. So a simple edit costs 4, an edit with two new blocks costs 8, explaining costs 2, and a fix that adds one block costs 2 + 4 + 2. An Explain results question (`results`) pays 2 once; its measurement round and repairs are included (at most 4 calls per job). A job or part whose first call fails for any reason before output is delivered (provider error, timeout, client disconnect, or a gateway error) is refunded in the same request. Parts are recorded in `job_parts` (label and amount only) and expire with their job after 7 days. Responses include `jobCharged`, the job's running total, which the app shows beside the answer.
