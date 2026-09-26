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
| `CREDIT_PRICES` | Optional JSON, default `{"component": 2, "model": 20, "export": 2}` |
| `FREE_CREDITS` | Welcome grant per verified identity, default 20 |
| `RATE_PER_MINUTE`, `MAX_CONCURRENT` | Per-account limits, defaults 20 and 3 |
| `USAGE_RETENTION_DAYS` | Default 400 |
| `ADMIN_TOKEN` | Secret Manager; enables `POST /internal/purge` |
| `DOWNLOAD_BASE`, `SOURCE_URL` | Targets for `/download/{platform}` and `/source` redirects |

With `GATEWAY_ENV=production` the service refuses to start with development sign-in, SQLite, missing keys, packs without Stripe prices, or a non-HTTPS public URL.

`CREDIT_PACKS` example:

```json
[{"id":"starter","credits":100,"amount":1000,"currency":"usd","label":"100 credits","priceId":"price_…"},
 {"id":"pro","credits":550,"amount":5000,"currency":"usd","label":"550 credits","priceId":"price_…"}]
```

`amount` (in cents) is shown in the app; Stripe charges the Price. Keep them equal.

## Deploy on Google Cloud

One-time setup, in the Virtu Services Google Cloud project:

1. **Database.** Create a Cloud SQL PostgreSQL instance (smallest shared-core tier is enough to start), a `gradara` database, and a `gateway` user. Tables are created on first start.
2. **Secrets.** Store the model vendor key, Stripe keys, database password, and admin token in Secret Manager.
3. **Firebase Authentication.** In the Firebase console, enable the Google provider and Email link (passwordless). Add `api.gradara.app` to authorized domains. Copy the web app config values.
4. **Stripe.** Create a "Gradara AI credits" product with one one-time Price per pack. Add a webhook endpoint `https://api.gradara.app/v1/billing/webhook` for `checkout.session.completed` and `checkout.session.async_payment_succeeded`, and store its signing secret. Set the statement descriptor and support email. Enable Stripe Tax when registrations are in place.
5. **Model vendor.** Use a dedicated API organization or workspace for production. Request zero data retention, set spend limits and alerts, and record the terms in the operations notes.

Build and deploy from the repository root:

```sh
gcloud builds submit --config cloud/cloudbuild.yaml --ignore-file cloud/.gcloudignore \
  --substitutions _IMAGE=REGION-docker.pkg.dev/PROJECT/gradara/gateway:VERSION .
gcloud run deploy gradara-gateway \
  --image REGION-docker.pkg.dev/PROJECT/gradara/gateway:VERSION \
  --region REGION --allow-unauthenticated --timeout 600 --concurrency 20 \
  --min-instances 0 --max-instances 3 --memory 512Mi \
  --add-cloudsql-instances PROJECT:REGION:INSTANCE \
  --set-env-vars GATEWAY_ENV=production,PUBLIC_URL=https://api.gradara.app,AUTH_MODE=firebase,LLM_PROVIDER=anthropic,LLM_MODEL=claude-sonnet-5,… \
  --set-secrets ANTHROPIC_API_KEY=anthropic-key:latest,STRIPE_SECRET_KEY=stripe-secret:latest,STRIPE_WEBHOOK_SECRET=stripe-webhook:latest,ADMIN_TOKEN=gateway-admin:latest,DATABASE_URL=gateway-db-url:latest
gcloud run domain-mappings create --service gradara-gateway --domain api.gradara.app --region REGION
```

The 600-second timeout covers long model-build calls. The in-memory per-account concurrency limit is per instance; keep `--max-instances` small until a shared limiter is needed.

Operations:

- **Retention** runs every six hours inside the service. Add a daily Cloud Scheduler call to `POST /internal/purge` with the admin token as a backstop for instances that scale to zero.
- **Refunds.** Refund in Stripe, then remove the credits: `python -m gateway.admin refund someone@example.com 100 --ref cs_live_…`.
- **Goodwill credits:** `python -m gateway.admin adjust someone@example.com 20 --reason goodwill`.
- **Monitoring.** Alert on 5xx rate and on vendor spend. Logs contain only route, status, latency, and request ids; do not enable request body logging.

## Pricing model

Costs scale with tokens. Development runs used about 16k tokens per block and 80k to 130k tokens per model build. At mid-tier model prices (about USD 2 per million input tokens and USD 10 per million output tokens), that is roughly USD 0.05 to 0.15 per block and USD 0.40 to 1.20 per model build, before retries. With 100 credits for USD 10, a block (2 credits) is USD 0.20 and a model (20 credits) is USD 2.00, which covers vendor cost, Stripe fees, and hosting with margin. Review these numbers against real usage records after launch; change `CREDIT_PRICES` rather than code.
