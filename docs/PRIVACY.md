# Privacy and data handling

This page describes what the Gradara desktop app and the hosted Gradara AI service do with data. It is the engineering source for the public [privacy notice](../site/public/privacy.html) and the data-related parts of the [terms](../site/public/terms.html); keep all three in step with the code.

Gradara is operated by Virtu Services LLC. Contact: support@virtu-services.us.

## Principles

1. **Local first.** Modeling, simulation, results, and files stay on the user's computer. The app works fully without an account.
2. **AI only on request.** Nothing is sent to an AI provider until the user asks for an AI feature.
3. **No content retention in Gradara AI.** The hosted service processes prompts and responses in memory and never writes them to disk, logs, or a database. The AI provider (Anthropic) may retain them briefly for abuse and safety monitoring under its terms.
4. **Collect the minimum for billing.** The service stores identity, balance, purchases, sign-in token hashes, and per-request usage metadata (listed below). Never content.
5. **No analytics, tracking, or advertising** in the app, the service, or the sign-in pages. Personal information is not sold or shared (in the CCPA sense).

## Desktop app

| Data | Where it lives | Leaves the computer? |
| --- | --- | --- |
| Models, Trash, AI block library, simulation runs and CSV results, C exports | The data folder (Settings → Privacy & data shows the path) | No |
| Settings (engine and AI provider choice) | `settings.json` in the data folder | No |
| API keys and the Gradara AI sign-in token | The OS keychain (macOS Keychain, Windows Credential Manager, Linux Secret Service); a private file in the data folder only when no keychain exists | Only to the matching provider, as request authentication |
| Service logs | `logs/` beside the data folder; operational messages only | No |

The local service listens only on the loopback interface. It rejects requests from other hostnames (DNS rebinding) and other websites (a required client header on every state-changing request), so a web page cannot read models or trigger paid AI calls.

Network requests the app makes:

- **Update checks** to GitHub Releases at launch and every few hours (disable with `GRADARA_DISABLE_UPDATES=1`). GitHub sees the IP address and app version.
- **Engine setup**, only when the user starts it: the OpenModelica library download or the engine container image.
- **AI requests**, only when the user asks for an AI feature, to the provider selected in Settings.
- **Links the user clicks** open in the system browser.

Debug copies of AI prompts and responses are written locally only when `GRADARA_KEEP_AI_TRANSCRIPTS=1` is set, or when the developer Codex CLI option is used.

## AI requests

An AI request contains Gradara's instructions, the user's description, and the model context the task needs. That context might be the component being refined, the block catalog for a model build, or a custom block's equations when you ask the AI to write it in C (C code for library blocks is generated locally). Editing or diagnosing the open model from the Assistant sends that model's blocks, parameters, equations, and connections without its layout, the names of selected blocks, and the block catalog. Diagnosis also sends the problems you ask about and, for a failed run of the same model, the emitted Modelica source and the solver's messages. It does not include unrelated models or files.

- **Own API key (OpenAI or Anthropic).** Requests go directly from the computer to the provider under the user's own account and terms. OpenAI requests set `store: false`.
- **Gradara AI.** Requests go to the Gradara AI service, which forwards them to its model provider and returns the result. Production uses Anthropic (`LLM_PROVIDER=anthropic` in `cloud/deploy.env`); switching providers requires updating the public notice first. See below.

## Gradara AI service

### What is stored

| Record | Fields | Retention |
| --- | --- | --- |
| Account | Internal id, identity provider user id, email, credit balance, creation date, accepted Terms version and acceptance time (recorded at each sign-in) | Until the account is deleted; the row then keeps only the internal id, public id, dates, and Terms version |
| Sign-in tokens | SHA-256 hash, client label, creation date, last-used **day**, revocation date | Revoked tokens are removed 30 days after revocation |
| Sign-in codes | Device-code hash, short user code, client label, account, status | Removed one day after expiry |
| Credit ledger | Amount, reason (welcome, purchase, charge, refund, adjust, forfeit, reversal), reference (Stripe Checkout Session id or an internal operation id), internal account id, date | Kept for accounting. After deletion it is pseudonymized, not anonymous: rows keep the internal account id and Stripe ids, which Stripe can link to the payer |
| Purchases | Internal account id, Stripe Checkout Session id, PaymentIntent id, credits bought, credits reversed by refunds or disputes, date | Kept for accounting, pseudonymized as above |
| Deleted identities | HMAC-SHA256 (keyed with the server's `IDENTITY_PEPPER`) of a deleted account's sign-in id and of its email | Kept while the service runs, so welcome credits are granted once per person |
| Usage | Task type, model name, input/output token counts, latency, success flag, short error code, operation id, date | About 13 months (400 days) |
| Operation counters | Operation id, kind, call count, amount charged; for edits and fixes, each priced part's label (`edit` or `block:1`…`block:3`) and amount | 7 days |
| Processed Stripe event ids | Event id, date | 90 days, then purged by the retention job |

### What is never stored

Prompts, model files, equations, generated blocks, generated C, AI responses, provider error text, IP addresses in the database or logs, or request bodies in logs. The service keeps client IP addresses in memory only, to rate-limit sign-in starts (10 per minute per address); each address is dropped once its last attempt is a minute old. Application logs contain the HTTP method, route template, status, latency, and a random request id. The web server's access log (which would include query strings) is disabled, and every `cloud/deploy.sh deploy` ensures Cloud Run's platform request logs for the service (which would include IP addresses and user agents) are excluded from Cloud Logging. Firebase Authentication and Stripe see client IP addresses under their own policies.

Automated tests enforce this: `cloud/tests/test_gateway.py` sends a confidential marker string through a generation and verifies that it appears in neither the logs nor the database file.

### Subprocessors

| Provider | Purpose | Data |
| --- | --- | --- |
| Google Cloud (Cloud Run, Cloud SQL, Secret Manager) | Hosting and database | Records above |
| Firebase Authentication (Google) | Sign-in with Google or email link; the sign-in page loads its scripts from `www.gstatic.com` and `apis.google.com` | Email and identity, plus the browser's IP address and details; Gradara never sees passwords |
| Stripe | Payments, receipts, tax | Email and payment details; Gradara never receives card data |
| Anthropic | Running AI requests | Request content; may be retained briefly for abuse and safety monitoring |
| GitHub | Downloads and desktop update checks | IP address and app version |

Records are stored in Google Cloud `us-central1` (United States); the public notice discloses this international transfer.

Model provider settings for the Gradara AI account:

- Use API accounts only. API traffic is not used for training by default under the vendor's commercial terms.
- The public notice says the provider may keep request content briefly for abuse and safety monitoring. If zero data retention is granted, the notice may say so; until then it must not claim it.
- Update the public notice before changing the provider or its retention terms.

### User rights

- **Export:** `GET /v1/account/export` returns the account, ledger, usage, and device records in JSON.
- **Delete:** Settings → AI → Delete account (or `DELETE /v1/account`). This erases email and identity, revokes all sign-ins (their hashes are purged 30 days later), deletes usage and operation records, forfeits remaining credits, and removes the Firebase user. The ledger and purchases stay pseudonymized for accounting, and keyed hashes of the sign-in id and email go to the deleted-identities table so a new sign-in with them gets no welcome credits (it can still sign in and buy). Stripe keeps its own payment records as required by law. Unused purchased credits are refunded on request within 14 days of purchase; the user must ask before deleting.
- **Sign out:** revokes the token for that computer only.

### Charges, refunds, and disputes

- An AI call whose first attempt fails for any reason before returning output (provider error, timeout, disconnect, or a gateway error) is refunded in the same request. Repairs inside a paid job are free.
- A Stripe refund (`charge.refunded`) removes the refunded share of the purchase's credits; a dispute (`charge.dispute.created`) removes all of them. Removal is capped at the unspent balance and never makes it negative, and is idempotent per purchase. See [cloud/README.md](../cloud/README.md).

## Operating rules

- Do not add request or response bodies to logs, error reports, or tracing. The gateway returns a generic message for provider errors because upstream error text can echo request fragments.
- Do not enable request logging, body capture, or third-party APM that records payloads on the hosting platform.
- Keep provider API keys, Stripe keys, and the admin token in the secret manager.
- Changing any row in the tables above requires updating this page, the public notice, and the in-app Privacy & data tab together.
