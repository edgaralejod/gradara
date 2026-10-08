# Preparing and releasing Gradara

Use this checklist for a source release. Engine images and desktop installers require the additional packaging review below.

## Source-release checklist

- [ ] Confirm new code and examples can be contributed under Apache-2.0 and that copied code keeps its notices. Update the [third-party inventory](../THIRD_PARTY_NOTICES.md) for new dependencies.
- [ ] Check that the private reporting address in [SECURITY.md](../SECURITY.md) and [CODE_OF_CONDUCT.md](../CODE_OF_CONDUCT.md) still receives mail.
- [ ] Run `python3 scripts/check-repo.py --history` and review anything it reports: personal models, credentials, prompts or logs, deployment identifiers, and private paths. Rotate any exposed secret; deleting the file does not remove it from history.
- [ ] Run the [local checks](#local-checks) from a clean checkout with no `.venv`, `node_modules`, local model data, or provider configuration.
- [ ] Confirm Core CI is green on the release commit, and dispatch **OpenModelica integration** (`engine.yml`) and **Native OpenModelica** for it.
- [ ] Review the final diff. Build the source archive from the tagged commit, not from a working folder; a filesystem ZIP can include ignored data.
- [ ] Choose the tag, write release notes with known limitations, and publish.

## Local checks

```sh
npm ci
python3 -m venv .venv
.venv/bin/python -m pip install -r server/requirements-dev.txt
npm run typecheck
npm test
python3 scripts/check-audit.py
.venv/bin/python -m pytest -q -m "not integration"
python3 scripts/check-docs.py
python3 scripts/check-repo.py --history
npm run build
```

After engine setup, run `.venv/bin/python -m pytest -q` and the browser acceptance sequence in [testing](development/TESTING.md). Run `python3 scripts/check-repo.py --release` to check license metadata and source hygiene. These scripts are limited automated checks, not a substitute for reviewing history or third-party terms.

Repository-wide `npm run lint` currently reports an existing backlog; record it accurately. Do not require a failing baseline in branch protection or silently disable its rules. The CI workflow exposes lint as advisory until a focused cleanup makes it green.

## Host configuration

The repository includes PR and issue templates and GitHub Actions workflows on hosted runners. Most are read-only. Two write: **Desktop installers** creates a draft release on `v*` tags, and **Website** deploys `site/` to Firebase Hosting (live on pushes to `main` and manual runs, a preview channel for pull requests) when its deploy key is configured. No workflow calls an AI provider, pushes an engine image, or sees local credentials.

Keep Issues, private vulnerability reporting, and secret scanning enabled on the repository. Add a `CODEOWNERS` entry only for a confirmed maintainer. Dependency upgrades must respect the pinned React Flow patch.

## Desktop installers

1. Bump the version in a pull request: `npm version X.Y.Z --no-git-tag-version` at the repository root and again in `desktop/` (this updates both `package.json` files and their lockfiles). The tag build fails if the tag and these versions differ, because the version inside the app is what auto-update compares.
2. Push a tag `vX.Y.Z`. The **Desktop installers** workflow first runs **Engine bundles**, which builds the four built-in engines (Windows, Linux, macOS arm64 and x64) and runs the engine test suite on each (see [supported platforms](PLATFORMS.md)); engines whose inputs are unchanged since the last packaging change on `main` come from the cache **Engine cache** filled then, so a release of app changes only takes about 15 minutes instead of over an hour (Actions → Engine cache → Run workflow rebuilds the cache by hand). It then builds Windows (NSIS), macOS (DMG and ZIP for Apple silicon and Intel), and Linux (AppImage and deb) with those engines inside, and smoke-tests the frozen service (on Windows and Linux with a simulation on the engine, and on Linux again inside an Arch Linux container). It then installs each package on a clean runner (Windows, both macOS architectures, Ubuntu 22.04 and 24.04), launches it in self-test mode with a simulation and a generated-C verification wherever the runner can run the engine (all except Apple silicon, where GitHub's runners cannot start virtual machines), launches it again, uninstalls it, and checks that program files, shortcuts, and the Add/Remove Programs entry are gone while the user's data folder is kept. Only when every install test passes does it attach the installers to a **draft** GitHub Release. The two macOS builds each produce update metadata; the release job merges them into one `latest-mac.yml` so both Apple silicon and Intel Macs find their own update. The same build and install tests run on pull requests that change packaging: `desktop/` (except a version-only change to its `package.json` and lockfile), `packaging/` (including the engine scripts), `server/requirements.txt`, `server/engines.py`, `vite.desktop.config.ts`, or the two workflows. Other app changes are checked by Core CI on the pull request and built for the first time on the tag; a problem there fails the tag build before any release is created. To build a branch before tagging (for example after upgrading Electron or another desktop dependency), use Actions → Desktop installers → Run workflow on that branch.
3. Before publishing, check what CI cannot. **Required:** install the Apple silicon DMG on an Apple silicon Mac, open the buck converter example, run it (the built-in engine starts within a few seconds), and check that the output voltage settles; CI runs that engine only when a self-hosted Apple silicon runner is set up ([testing](development/TESTING.md#built-in-engine)), and even then does not install the DMG. For the other installers (Windows, macOS Intel, Linux AppImage, Linux deb), CI already simulates; a hand check on a real machine is still worthwhile:
   1. Install it on a real machine or clean VM, with no OpenModelica or Docker installed.
   2. Create a model from the buck converter example, run it, and check that the output voltage settles.
   3. Reopen the model after restarting the app.

   On one platform, also sign in to Gradara AI against a local gateway (see [Gradara AI service](#gradara-ai-service)) and generate a block. Record the results in the release notes.
4. Write release notes with known limitations, then publish the draft. Publishing is what installed apps see: within four hours they download it and offer **Restart to update**, so a published release reaches users without their action. The website's download buttons use `releases/latest/download/…`, which only resolves to a **published** release, so they return 404 until the first release is published. Published releases feed auto-update and the stable `/download/{platform}` links.

Self-test mode: launching the app with `GRADARA_SELF_TEST_REPORT=<file>` makes it start its service, create a model, wait for the workbench to render, write a JSON report to that file, and quit without dialogs. With `GRADARA_SELF_TEST_SIMULATE=1` it also requires the built-in engine to be ready without setup, simulates the DC motor example, and compiles and verifies its controller's generated C against the run. `packaging/installer_selftest.py --exe <installed executable> [--simulate]` wraps this and also fails if a service process, an `omc` process, or (on macOS) the engine VM outlives the app.

Pull-request builds never sign (electron-builder skips signing on pull requests), so a signing problem first shows up on a tag. After a change to signing, run **Desktop installers** manually on `main` before tagging (Actions → Desktop installers → Run workflow). A manual run takes the same non-pull-request path as a tag and tests every installer, but creates no release. If a tag build fails before anything is published, delete the tag (`git push origin :refs/tags/vX.Y.Z` and `git tag -d vX.Y.Z`), fix `main`, and tag again.

Signing secrets (the macOS ones are configured; the Windows certificate is not yet, so Windows builds are unsigned and SmartScreen warns):

| Secret | Purpose |
| --- | --- |
| `MAC_CERTIFICATE_P12`, `MAC_CERTIFICATE_PASSWORD` | Developer ID Application certificate (base64 .p12). Create it in Xcode (Settings → Accounts → Manage Certificates → Developer ID Application; Account Holder role), export it from Keychain Access as .p12, and store `base64 -i cert.p12`. When set, the macOS install test also runs `codesign --verify`, `spctl --assess`, and `xcrun stapler validate`. |
| `APPLE_ID`, `APPLE_APP_SPECIFIC_PASSWORD`, `APPLE_TEAM_ID` | Notarization |
| `WIN_CERTIFICATE_PFX`, `WIN_CERTIFICATE_PASSWORD` | Windows code signing certificate, or configure Azure Trusted Signing in `electron-builder.yml` |

Installers bundle Electron, a Python runtime, the service dependencies, and the built-in simulation engine (OpenModelica, redistributed under the GNU AGPL v3 mode of its license, with the Modelica Standard Library and each platform's toolchain); see [third-party notices](../THIRD_PARTY_NOTICES.md). For the engine and test coverage on each platform, see [supported platforms](PLATFORMS.md).

### A release of an earlier line

When `main` already holds the next minor version (tagged or not yet published), a fix or small feature for the current line ships from a maintenance branch, `release/X.Y.x`, made from that line's last tag. Open the pull request against the maintenance branch: Core CI runs on every pull request, while the Desktop installers pull-request build runs only against `main` (run it by hand on the branch if packaging changed). Merge, bump the version, and tag `vX.Y.Z` on the maintenance branch; the tag build uses that commit's workflows and reads the engine cache saved on `main` while the engine inputs are unchanged. Publish as usual. Then bring the change into `main` with its own pull request so the next minor release keeps it; if that release is tagged but not yet published, tag it again after the merge (delete the tag and its draft first). Installed apps compare versions, so a user on X.Y.Z still updates to the next minor release.

## Gradara AI service

Deploy from `cloud/` following [its runbook](../cloud/README.md). The app only works with a gateway that accepts every AI task it sends: before publishing a release, run `cloud/deploy.sh status` and, when it reports the gateway code changed since the deployed revision, run `cloud/deploy.sh deploy` first. `tests/test_llm.py` fails when the app uses a task or job kind the gateway code rejects; an older deployed gateway answers such requests with a 422, which the app reports as the service being older than the app. Before live payments: run `pytest` in `cloud/`, run the gateway locally with `AUTH_MODE=dev` and a Stripe test-mode key (see [run locally](../cloud/README.md#run-locally)), point a desktop build at it with `GRADARA_GATEWAY_URL`, verify sign-in and Checkout end to end, confirm the webhook grants credits once, and confirm logs contain no request content. Update [privacy](PRIVACY.md) and the public notice together whenever stored data or subprocessors change.

## Release records

Source is on [GitHub](https://github.com/edgaralejod/gradara), default branch `main`. Check [Actions](https://github.com/edgaralejod/gradara/actions) for results on the release commit; a workflow file alone does not show that a run passed.

For each release, record in the release notes: the release commit, the checks run and their results, the platforms tested by hand, and known limitations. Re-run checks on the release candidate itself; results from an earlier commit do not carry over. Keep generated inventories and local logs out of the source distribution.

**Downloads.** GitHub counts every download of a release asset, including the website's `releases/latest/download/…` buttons and the in-app updater, so there is no tracking on gradara.app. `python3 scripts/release-downloads.py` prints the counts per installer and release (`--latest` for the current release, `--json` for a machine-readable form; set `GITHUB_TOKEN` to avoid the unauthenticated rate limit). The counts are running totals with no history, so keep the output if you want to see a trend. Page views for the repository (not the website) are under Insights → Traffic on GitHub.
