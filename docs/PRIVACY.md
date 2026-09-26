# Privacy and data handling

This page describes what the Gradara desktop app and the hosted Gradara AI service do with data. It is the engineering source for the public privacy notice. Have counsel review the public notice before launch; this document is not legal advice.

Gradara is operated by Virtu Services LLC. Contact: support@virtu-services.us.

## Principles

1. **Local first.** Modeling, simulation, results, and files stay on the user's computer. The app works fully without an account.
2. **AI only on request.** Nothing is sent to an AI provider until the user asks for an AI feature.
3. **No content retention in Gradara AI.** The hosted service processes prompts and responses in memory and never writes them to disk, logs, or a database.
4. **Collect the minimum for billing.** The service stores identity, balance, purchases, and request counts. Nothing more.
5. **No analytics, tracking, or advertising** in the app, the service, or the sign-in pages.

## Desktop app

| Data | Where it lives | Leaves the computer? |
| --- | --- | --- |
| Models, Trash, AI block library, simulation runs and CSV results, C exports | The data folder (Settings → Privacy & data shows the path) | No |
| Settings (engine and AI provider choice) | `settings.json` in the data folder | No |
| API keys and the Gradara AI sign-in token | The OS keychain (macOS Keychain, Windows Credential Manager, Linux Secret Service); a private file in the data folder only when no keychain exists | Only to the matching provider, as request authentication |
| Service logs | `logs/` beside the data folder; operational messages only | No |

The local service listens only on the loopback interface. It rejects requests from other hostnames (DNS rebinding) and other websites (a required client header on every state-changing request), so a web page cannot read models or trigger paid AI calls.

Network requests the app makes:

- **Update checks** to GitHub Releases on startup (disable with `GRADARA_DISABLE_UPDATES=1`).
- **Engine setup**, only when the user starts it: the OpenModelica library download or the engine container image.
- **AI requests**, only when the user asks for an AI feature, to the provider selected in Settings.
- **Links the user clicks** open in the system browser.

Debug copies of AI prompts and responses are written locally only when `GRADARA_KEEP_AI_TRANSCRIPTS=1` is set, or when the developer Codex CLI option is used.

## AI requests

An AI request contains Gradara's instructions, the user's description, and the model context the task needs. That context might be the component being refined, the block catalog for a model build, or the controller equations for C export. It does not include unrelated models or files.

- **Own API key (OpenAI or Anthropic).** Requests go directly from the computer to the provider under the user's own account and terms. OpenAI requests set `store: false`.
- **Gradara AI.** Requests go to the Gradara AI service, which forwards them to its configured model provider (Anthropic or OpenAI) and returns the result. See below.

## Gradara AI service

### What is stored

| Record | Fields | Retention |
| --- | --- | --- |
| Account | Internal id, identity provider user id, email, credit balance, creation date | Until the account is deleted |
| Sign-in tokens | SHA-256 hash, client label, creation date, last-used **day**, revocation date | Revoked tokens are removed 30 days after revocation |
| Sign-in codes | Code hashes and status | Removed one day after expiry |
| Credit ledger | Amount, reason (welcome, purchase, charge, refund, adjust, forfeit), reference (Stripe Checkout Session id), date | Kept for accounting; identity is erased when the account is deleted |
| Usage | Task type, model name, input/output token counts, latency, success flag, operation id, date | About 13 months (400 days) |
| Operation counters | Operation id, kind, call count, amount charged | 7 days |
| Processed Stripe event ids | Event id, date | For deduplication |

### What is never stored

Prompts, model files, equations, generated blocks, generated C, AI responses, provider error text, IP addresses in the database, or request bodies in logs. Application logs contain the HTTP method, route template, status, latency, and a random request id. The web server's access log (which would include query strings) is disabled.

Automated tests enforce this: `cloud/tests/test_gateway.py` sends a confidential marker string through a generation and verifies that it appears in neither the logs nor the database file.

### Subprocessors

| Provider | Purpose | Data |
| --- | --- | --- |
| Google Cloud (Cloud Run, Cloud SQL, Secret Manager) | Hosting and database | Records above |
| Firebase Authentication (Google) | Sign-in with Google or email link | Email and identity; Gradara never sees passwords |
| Stripe | Payments, receipts, tax | Email and payment details; Gradara never receives card data |
| Anthropic or OpenAI (the configured model provider) | Running AI requests | Request content, transiently |

Model provider settings for the Gradara AI account:

- Use API accounts only. API traffic is not used for training by default under both vendors' commercial terms.
- Request **zero data retention** from the vendor for the production API organization. Without it, vendors may keep API data for a limited period for abuse monitoring.
- Record which vendor, account, and retention terms apply in the operations runbook, and update the public notice when they change.

### User rights

- **Export:** `GET /v1/account/export` returns the account, ledger, usage, and device records in JSON.
- **Delete:** Settings → AI → Delete account (or `DELETE /v1/account`). This erases email and identity, revokes all sign-ins, deletes usage and operation records, forfeits remaining credits, and removes the Firebase user. Ledger amounts remain without identity for accounting. Stripe keeps its own payment records as required by law.
- **Sign out:** revokes the token for that computer only.

## Operating rules

- Do not add request or response bodies to logs, error reports, or tracing. The gateway returns a generic message for provider errors because upstream error text can echo request fragments.
- Do not enable request logging, body capture, or third-party APM that records payloads on the hosting platform.
- Keep provider API keys, Stripe keys, and the admin token in the secret manager.
- Changing any row in the tables above requires updating this page, the public notice, and the in-app Privacy & data tab together.
