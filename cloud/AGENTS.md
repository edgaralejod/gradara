# Gradara AI gateway

The root [AGENTS.md](../AGENTS.md) applies. Read [cloud/README.md](README.md) and [privacy](../docs/PRIVACY.md) before changing this folder.

- The gateway handles other people's money and data. Never log or store request content (prompts, models, equations, responses, provider error text), IP addresses, or card data. `cloud/tests/test_gateway.py` enforces this with a marker string; keep that test passing and extend it when you add a storage or logging path.
- Anything that changes what is stored, logged, retained, or charged changes a public promise. Update `docs/PRIVACY.md`, `site/public/privacy.html`, `site/public/index.html` (pricing and privacy sections), and the app's Settings text in the same change.
- Secrets arrive only through environment variables from Secret Manager. Do not add them to `deploy.env`, logs, error messages, or tests.
- Keep `cloud/deploy.sh` idempotent: every command must be safe to run again after a partial failure.
