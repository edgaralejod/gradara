# Preparing and releasing Gradara

Use this checklist for a source release. Engine images and desktop installers require the additional packaging review below.

## Source-release readiness

- [x] Apache-2.0 selected for Gradara's original code, documentation, and bundled examples. The complete `LICENSE`, `NOTICE`, package metadata, and contribution terms are included.
- [ ] Confirm the code and examples can be contributed under that license; retain copied-code notices. The existing [third-party inventory](../THIRD_PARTY_NOTICES.md) is a starting point, not a complete distribution review.
- [ ] Provide public read/contribution access on the intended host. The Origin repository exists, but its Internal visibility is restricted to codebase access; it is not a public launch destination.
- [ ] Verify delivery and handling of the published private reporting address before launch. [SECURITY.md](../SECURITY.md) and [CODE_OF_CONDUCT.md](../CODE_OF_CONDUCT.md) use the public Virtu Services contact address; publishing the address does not verify mailbox delivery.
- [ ] Inspect the full reachable Git history and release payload for personal models, credentials, prompts/logs, deployment identifiers, private paths, and material without clear provenance. Rotate exposed secrets if found; deleting a current file is not history cleanup.
- [ ] Run the checks below from a clean source checkout with no existing `.venv`, `node_modules`, local model data, or provider configuration required.
- [ ] Observe core CI and manual engine CI on the intended host. Configure branch protection only for verified green checks; lint remains advisory until its backlog is resolved.
- [ ] Record actual OS/browser/runtime validation. Do not claim full Linux/native Windows support solely because the browser is portable.
- [ ] Review the final staged diff and source archive. `.gitignore` does not protect files already committed, and a filesystem ZIP can include ignored data. Use the reviewed commit for the release archive.
- [ ] Publish only after the owner explicitly requests publication. Choose a release tag, release notes, and known-limitations statement; this preparation does not make those decisions automatically.

## Local checks

```sh
npm ci
python3 -m venv .venv
.venv/bin/python -m pip install -r server/requirements-dev.txt
npm run typecheck
npm test
npm audit --audit-level=high
.venv/bin/python -m pytest -q -m "not integration"
python3 scripts/check-docs.py
python3 scripts/check-repo.py --history
npm run build
```

After engine setup, run `.venv/bin/python -m pytest -q` and the browser acceptance sequence in [testing](development/TESTING.md). Run `python3 scripts/check-repo.py --release` to check license metadata and source hygiene. These scripts are limited automated checks, not a substitute for reviewing history or third-party terms.

Repository-wide `npm run lint` currently reports an existing backlog; record it accurately. Do not require a failing baseline in branch protection or silently disable its rules. The CI workflow exposes lint as advisory until a focused cleanup makes it green.

## Host configuration

The repository includes PR and issue templates and read-only GitHub Actions workflows. They can be adapted for another host. The workflows use ordinary pull-request events and hosted runners; they do not run a provider agent, publish a site, push an image, or expose local credentials.

After a GitHub repository exists, enable Issues, choose whether Discussions are useful, enable private vulnerability reporting and available secret scanning, and set a short description/topics. Add actual maintainers to access rules deliberately. Avoid a `CODEOWNERS` file containing guessed identities. Consider dependency update tooling after the initial checks are stable; dependency upgrades must respect the pinned React Flow patch.

## Binary images and desktop installers

Treat a packaged numerical engine or installer as a separate release artifact. Inventory all included compiler/runtime/library/OS components, retain notices, and satisfy applicable source-distribution requirements. Record engine and MSL versions, supported host architectures, startup/shutdown behavior, storage paths, and update/rollback behavior.

The current `npm run build` output is only a web bundle. It is not an authenticated hosted simulation service or a complete cross-platform desktop application. A future remote service needs its own security and operations design before deployment.

## Release status and evidence

Source hosting is [Cursor Origin](https://cursor.com/codebase/edgaralejod/gradara), with default branch `main` and internal visibility. Its [documented visibility choices](https://cursor.com/docs/origin/settings) are Internal and Private; a public launch needs a publicly accessible source host or distribution. Public access, verified reporting delivery, observed hosted CI, and broader platform verification remain release gates. The GitHub Actions files are workflow templates; no Origin CI integration is connected.

Record the release commit, commands and results, tested platforms, and known limitations in the release notes or linked CI artifacts. Re-run checks for the actual release candidate; historical local test counts are not evidence for a later checkout. Keep generated inventories and development-session logs outside the source distribution.
