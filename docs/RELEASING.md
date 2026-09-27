# Preparing and releasing Gradara

Use this checklist for a source release. Engine images and desktop installers require the additional packaging review below.

## Source-release readiness

- [x] Apache-2.0 selected for Gradara's original code, documentation, and bundled examples. The complete `LICENSE`, `NOTICE`, package metadata, and contribution terms are included.
- [ ] Confirm the code and examples can be contributed under that license; retain copied-code notices. The existing [third-party inventory](../THIRD_PARTY_NOTICES.md) is a starting point, not a complete distribution review.
- [ ] Verify anonymous clone access and contribution links for [edgaralejod/gradara](https://github.com/edgaralejod/gradara) on GitHub.
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

The repository includes PR and issue templates and GitHub Actions workflows on hosted runners. Most are read-only. Two write: **Desktop installers** creates a draft release on `v*` tags, and **Website** deploys `site/` to Firebase Hosting (live on pushes to `main` and manual runs, a preview channel for pull requests) when its deploy key is configured. No workflow calls an AI provider, pushes an engine image, or sees local credentials.

After a GitHub repository exists, enable Issues, choose whether Discussions are useful, enable private vulnerability reporting and available secret scanning, and set a short description/topics. Add actual maintainers to access rules deliberately. Avoid a `CODEOWNERS` file containing guessed identities. Consider dependency update tooling after the initial checks are stable; dependency upgrades must respect the pinned React Flow patch.

## Desktop installers

1. Bump the version in a pull request: `npm version X.Y.Z --no-git-tag-version` at the repository root and again in `desktop/` (this updates both `package.json` files and their lockfiles). The tag build fails if the tag and these versions differ, because the version inside the app is what auto-update compares.
2. Push a tag `vX.Y.Z`. The **Desktop installers** workflow builds Windows (NSIS), macOS (DMG and ZIP for Apple silicon and Intel), and Linux (AppImage and deb) and smoke-tests the frozen service. It then installs each package on a clean runner (Windows, both macOS architectures, Ubuntu 22.04 and 24.04), launches it twice in self-test mode, uninstalls it, and checks that program files, shortcuts, and the Add/Remove Programs entry are gone while the user's data folder is kept. Only when every install test passes does it attach the installers to a **draft** GitHub Release. The two macOS builds each produce update metadata; the release job merges them into one `latest-mac.yml` so both Apple silicon and Intel Macs find their own update. The same build and install tests run on pull requests that touch the app.
3. Before publishing, check what CI cannot: install on a real machine, go through first-run engine setup, open an example, run it, sign in to Gradara AI (staging gateway), and generate a block.
4. Write release notes with known limitations, then publish the draft. Publishing is what installed apps see: within four hours they download it and offer **Restart to update**, so a published release reaches users without their action. The website's download buttons use `releases/latest/download/…`, which only resolves to a **published** release, so they return 404 until the first release is published. Published releases feed auto-update and the stable `/download/{platform}` links.

Self-test mode: launching the app with `GRADARA_SELF_TEST_REPORT=<file>` makes it start its service, create a model, wait for the workbench to render, write a JSON report to that file, and quit without dialogs. `packaging/installer_selftest.py --exe <installed executable>` wraps this and also fails if a service process outlives the app.

Pull-request builds never sign (electron-builder skips signing on pull requests), so a signing problem first shows up on a tag. Before tagging, and after any change to signing or packaging, run **Desktop installers** manually on `main` (Actions → Desktop installers → Run workflow). A manual run takes the same non-pull-request path as a tag and tests every installer, but creates no release. If a tag build fails before anything is published, delete the tag (`git push origin :refs/tags/vX.Y.Z` and `git tag -d vX.Y.Z`), fix `main`, and tag again.

Signing secrets (optional until configured; unsigned builds warn users):

| Secret | Purpose |
| --- | --- |
| `MAC_CERTIFICATE_P12`, `MAC_CERTIFICATE_PASSWORD` | Developer ID Application certificate (base64 .p12). Create it in Xcode (Settings → Accounts → Manage Certificates → Developer ID Application; Account Holder role), export it from Keychain Access as .p12, and store `base64 -i cert.p12`. When set, the macOS install test also runs `codesign --verify`, `spctl --assess`, and `xcrun stapler validate`. |
| `APPLE_ID`, `APPLE_APP_SPECIFIC_PASSWORD`, `APPLE_TEAM_ID` | Notarization |
| `WIN_CERTIFICATE_PFX`, `WIN_CERTIFICATE_PASSWORD` | Windows code signing certificate, or configure Azure Trusted Signing in `electron-builder.yml` |

Installers bundle Electron, a Python runtime, and the service dependencies; see [third-party notices](../THIRD_PARTY_NOTICES.md). They do not bundle OpenModelica: users install it (Windows, Linux) or use the container engine (macOS, optional elsewhere).

## Gradara AI service

Deploy from `cloud/` following [its runbook](../cloud/README.md). The app only works with a gateway that accepts every AI task it sends: before publishing a release, run `cloud/deploy.sh status` and, when it reports the gateway code changed since the deployed revision, run `cloud/deploy.sh deploy` first. `tests/test_llm.py` fails when the app uses a task or job kind the gateway code rejects; an older deployed gateway answers such requests with a 422, which the app reports as the service being older than the app. Before live payments: run `pytest` in `cloud/`, verify sign-in and Checkout in Stripe test mode end to end with a desktop build pointed at the staging gateway, confirm the webhook grants credits once, and confirm logs contain no request content. Update [privacy](PRIVACY.md) and the public notice together whenever stored data or subprocessors change.

## Release status and evidence

The canonical source host is [GitHub](https://github.com/edgaralejod/gradara), with default branch `main`. Check [Actions](https://github.com/edgaralejod/gradara/actions) for results on the commit being released; workflow files alone do not establish a successful run. Source availability is separate from a tagged release or a supported binary distribution. Verify reporting delivery and record platform coverage before making release claims.

Record the release commit, commands and results, tested platforms, and known limitations in the release notes or linked CI artifacts. Re-run checks for the actual release candidate; historical local test counts are not evidence for a later checkout. Keep generated inventories and development-session logs outside the source distribution.
