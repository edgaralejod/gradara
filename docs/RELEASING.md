# Preparing and releasing Gradara

This is a maintainer checklist. Preparing files is separate from publishing a repository or distributing binaries. No public remote, release tag, or hosted service is created by these instructions or CI.

## Source-release readiness

- [ ] Project owner selects the license for Gradara's original code. Add the complete `LICENSE`, set package metadata consistently, and update README/contribution/notice text. Do not advertise an open-source release while this is unresolved.
- [ ] Confirm the code and examples can be contributed under that license; retain copied-code notices. The existing [third-party inventory](../THIRD_PARTY_NOTICES.md) is a starting point, not a complete distribution review.
- [ ] Configure the intended repository host and ownership. Set real repository/issue links only after they exist; never invent a maintainer email or organization.
- [ ] Enable and test a private vulnerability-reporting route and a private conduct-reporting contact. Update [SECURITY.md](../SECURITY.md) and [CODE_OF_CONDUCT.md](../CODE_OF_CONDUCT.md).
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

After engine setup, run `.venv/bin/python -m pytest -q` and the browser acceptance sequence in [testing](development/TESTING.md). Run `python3 scripts/check-repo.py --release` after choosing the license; it also requires recognized license metadata and a root license file. These scripts are limited automated checks, not a substitute for reviewing history or third-party terms.

Repository-wide `npm run lint` currently reports an existing backlog; record it accurately. Do not require a failing baseline in branch protection or silently disable its rules. The CI workflow exposes lint as advisory until a focused cleanup makes it green.

## Host configuration

The repository includes PR and issue templates and read-only GitHub Actions workflows. They can be adapted for another host. The workflows use ordinary pull-request events and hosted runners; they do not run a provider agent, publish a site, push an image, or expose local credentials.

After a GitHub repository exists, enable Issues, choose whether Discussions are useful, enable private vulnerability reporting and available secret scanning, and set a short description/topics. Add actual maintainers to access rules deliberately. Avoid a `CODEOWNERS` file containing guessed identities. Consider dependency update tooling after the initial checks are stable; dependency upgrades must respect the pinned React Flow patch.

## Binary images and desktop installers

Treat a packaged numerical engine or installer as a separate release artifact. Inventory all included compiler/runtime/library/OS components, retain notices, and satisfy applicable source-distribution requirements. Record engine and MSL versions, supported host architectures, startup/shutdown behavior, storage paths, and update/rollback behavior.

The current `npm run build` output is only a web bundle. It is not an authenticated hosted simulation service or a complete cross-platform desktop application. A future remote service needs its own security and operations design before deployment.

## Current preparation record

Prepared September 13, 2026: documentation index, corrected architecture, model/API/execution guides, contributor and agent guidance, community/security policies, upstream notices, local checks, and CI templates. License selection, public host/contact configuration, observed hosted CI, and broader platform verification remain explicit release gates. Local verification results are recorded in [VALIDATION.md](../VALIDATION.md).

The owner subsequently selected [Cursor Origin](https://cursor.com/codebase/edgaralejod/gradara) for source hosting. The Git remote is `https://origin.cursor.com/edgaralejod/gradara.git`, default branch `main`, in the owner's personal namespace with `internal` visibility. This establishes a hosted repository, not a public release. The GitHub Actions files remain workflow templates; no Origin CI integration has been connected or observed.
