# Personal features (layers)

A personal feature is a change to Gradara that an AI agent builds on request, outside a release. The workshop pipeline (`.github/workflows/workshop.yml`) implements the request on a branch, runs automated gates, and publishes the result as a signed **layer**: a complete workbench build and a complete `server` package for one exact app version. The installed app downloads the layer, checks it, and starts from it instead of its shipped code. It never patches files, and the shipped code is always one restart away.

Personal features run on the workshop repository owner's own `ANTHROPIC_API_KEY`: the maintainer's for the main repository, or a fork owner's for their fork. They use no Gradara AI credits. Opening them to every user through Gradara AI is future work ([ROADMAP.md](../../ROADMAP.md)).

| Part | Code |
| --- | --- |
| Archive, signature, manifest, install, launch plan | `desktop/layers.cjs` (no Electron dependency; shared with the build script and tests) |
| Shell: launch, fallback, downloads, trusted keys, IPC | `desktop/main.cjs`, `desktop/preload.cjs`, `desktop/layer-keys.json` |
| Service: import path, data files, health | `packaging/backend_entry.py`, `server/paths.py` (`LAYER`, `shipped()`, `layer_info()`) |
| Workshop client (GitHub API) | `server/workshop.py`, `/api/workshop*` ([API](../API.md)) |
| Settings → Personal features | `components/gradara/personal-features.tsx`, `lib/gradara/layers.ts` |
| Pipeline | `.github/workflows/workshop.yml`, `.github/workshop/{scope,build,review}.md`, `scripts/workshop_paths.py`, `scripts/workshop_plan.py`, `scripts/workshop_report.py`, `scripts/build-layer.cjs` |
| Loading test | `packaging/layer_probe.py`, `packaging/smoke_backend.py --layer`, the Desktop installers workflow |

## What a layer contains

| Path in the archive | What it is |
| --- | --- |
| `web/` | The whole `npm run desktop:web` build (`dist-desktop/web`) |
| `server/` | The whole `server` package, without `__pycache__` |
| `lib/gradara/*.json` | The data files the service reads beside its code: `port-units.json` and `solver-settings.json` |
| `manifest.json` | What the layer is and a hash of every other file |

Nothing else is accepted (`ALLOWED` in `layers.cjs`). In particular a layer cannot carry Python or npm dependencies, the Electron shell, packaging, the engine, or `models/examples/` (the service reads examples from the app's resources). A feature that needs any of those can ship only in a release.

Service code that reads a data file shipped beside the code must use `paths.shipped(...)`. In a layered service `paths.ROOT` is still the frozen base, and `shipped()` returns the layer's copy when it has one.

### Archive

A gzipped ustar archive of regular files only, packed deterministically: names sorted, mode 0644, owner 0, modification time 0. The same tree always packs to the same bytes. Unpacking refuses links and special files, absolute paths, drive letters, `..` and empty path segments, more than 20,000 files, and more than 400 MB unpacked. The app downloads at most 300 MB for the archive and 4 KB for the signature.

### Manifest

```json
{
  "format": 1,
  "id": "f-speed-plot",
  "base": "0.7.0",
  "repository": "owner/name",
  "commit": "<the branch commit it was built from>",
  "built": "2026-10-07T12:00:00.000Z",
  "features": [{ "id": "f-speed-plot", "title": "Speed plot", "commit": "<feature commit>" }],
  "files": { "server/app.py": "<sha256>", "web/index.html": "<sha256>" }
}
```

- `id` matches `^[a-z0-9][a-z0-9-]{2,80}$`. Workshop layers use `f-…` IDs.
- `base` is the exact app version the layer was built for.
- `features` lists every feature the layer carries, oldest first. A layer is cumulative: a new feature is built on top of the active layer's features.
- `files` lists every file except the manifest, with its SHA-256.

The release asset `layer.json` is the manifest without `files`, plus `archive` (file name), `bytes`, and `sha256` of the archive.

## Signing and trust

The workshop signs the archive bytes with an Ed25519 private key (`LAYER_SIGNING_KEY`). The base64 signature is published as `<archive>.sig`.

The app trusts two sets of public keys:

- **Built in:** `desktop/layer-keys.json`, each entry `{id, repository, publicKey}` (PEM). The shipped key is `gradara-workshop-2026` for `edgaralejod/gradara`.
- **Added by the user:** `layers/keys.json` in the app's folder. **Settings → Personal features → Trust this key** adds one for the chosen repository after a confirmation dialog that says code signed with it runs with the user's permissions.

A key is bound to its repository: a signature counts only for layers installed from that repository, and the manifest's `repository` must match too. To rotate the built-in key, generate a new pair, put the public half in `layer-keys.json` in a release (keep the old entry until every layer is rebuilt), and replace the `LAYER_SIGNING_KEY` secret.

Signatures and hashes are checked **at install**. At launch the shell only checks that the layer's `manifest.json` is still on disk; the layer folder is as trusted as the app's own files.

## Install

`gradaraDesktop.layers.install({repository, archiveUrl, signatureUrl})`, from **Install** in Settings:

1. Both URLs must be `https://github.com/<repository>/releases/download/…` for the repository chosen in Settings.
2. Download the archive and the signature.
3. Verify the signature with a trusted key for that repository.
4. Unpack in memory and check the manifest: format, ID, `base` equals the running version, at least one feature, `repository` matches.
5. Every listed file must be present with its hash, nothing unlisted may be present, and `web/index.html` and `server/app.py` must exist.
6. Write the files to `layers/<id>-<base>.partial`, then rename it to `layers/<id>-<base>`.
7. Write `layers/state.json` as `{active, off: false, faulty: null}` and delete every other layer folder.

The layer is used from the next start; Settings offers **Restart to use**.

## Launch and fallback

At each start the shell reads `state.json` and makes a launch plan (`launchPlan` in `layers.cjs`). It starts the shipped code when:

- there is no active layer, or the user switched personal features off;
- the active layer is marked faulty;
- the layer was built for another version. After an app update the notice says the features are switched off until they are rebuilt for the new version;
- the layer folder is missing (notice: missing from disk).

Layers are never used in development (`npm run desktop:start`) or in self-test runs.

With a layer, the shell sets `GRADARA_LAYER_DIR` to the layer folder and `GRADARA_STATIC_DIR` to its `web/`. `packaging/backend_entry.py` puts the layer folder first on `sys.path`, so `import server` loads the layer's package, while Python itself and every dependency still come from the app. `/api/health` reports `layer: {id, base, features}`.

A layer must never leave the app worse than it found it. The shell waits 60 seconds for the layered service (90 without a layer), then requires, within 30 seconds each, that `/api/health` reports the layer's ID and that the workbench renders into `#root`. If any step fails, it writes `faulty: {id, reason, at}` to `state.json`, stops the service, starts the shipped code, and shows **Personal features are switched off** with the reason. **Switch on and restart** clears the faulty mark and tries again.

## Bridge

`desktop/preload.cjs` exposes `window.gradaraDesktop.layers` to the workbench. Every IPC handler (`gradara:layers:*`) checks that the sender is the app's own page.

| Method | Does |
| --- | --- |
| `getState()` | `{available, version, running, state, notice, trusted}` |
| `install(request)` | Install as above; `{ok, active}` or `{ok: false, error}` |
| `switchOn(on)` | Switch personal features on or off (on also clears a faulty mark) |
| `remove()` | Forget the active layer and delete every layer folder |
| `trust({repository, publicKey})` | Confirm with the user, then add an Ed25519 public key for that repository |
| `restart()` | Restart the service and reload the workbench |

## Workshop client

`server/workshop.py` talks to the GitHub API for **Settings → Personal features**. It starts the workflow, follows its runs, reads the reports from run artifacts, and lists the layers published for this version. It never installs anything; the shell does that.

- The repository is `workshop.repository` in `settings.json` (default `edgaralejod/gradara`).
- The token is a fine-grained GitHub token with **Actions: read and write** and **Contents: read** on that repository. It is kept in the system keychain (`github_token` in `server/credentials.py`) and sent only to api.github.com. Layer manifests are read without it from the repository's public release assets on github.com.
- Requests are tracked by a correlation ID (`request_id`), which for builds is the new layer's ID. Progress labels come from the workflow's step names (`STAGES`).
- Endpoints: [API guide](../API.md#endpoints), the `/workshop` rows.

What the user sees: write a request, choose **Check what would be built** (a scope run), read what will and will not be built and the estimate, choose a cost cap ($2, $5, $10, or $20), then **Build it**. A finished build shows **Install**. **Remove** next to a feature rebuilds the layer without it, with no agent. A scope that says the request needs a release offers **Ask for it in a release**, which opens the public Improve Gradara issue form.

## Pipeline

`workshop.yml` has three modes, started by `workflow_dispatch` (the app uses the GitHub API; **Run workflow** works too):

| Mode | Agent | What it does |
| --- | --- | --- |
| `scope` | Claude Code on `haiku`, read-only tools, at most $0.30 and 25 turns | Reads the code and reports what would be built, what would not, size, risk, and whether it can ship as a layer |
| `build` | Claude Code on `sonnet`, edit tools plus the test commands, the user's cap (0.50–50 USD, default 5) and 120 turns | Implements the request on top of the layer's earlier features |
| `rebuild` | none | Applies the listed feature commits again on a base: removing a feature, or porting to a new release |

When a non-prerelease `vX.Y.Z` release is published, the workflow rebuilds every layer whose newest build is for an older release on the new one, with no agent (`scripts/workshop_plan.py`). A clean rebuild costs nothing. A feature commit that does not cherry-pick cleanly stops at stage `stack` and needs porting through a new build.

A build runs, in order:

1. **Branch.** Check out the base tag with no stored credentials, create `workshop/<id>/<tag>`, and cherry-pick the earlier features. If an earlier attempt ran out of budget, its work on `workshop/<id>/<tag>-attempt` is resumed.
2. **Implement** (build only). The prompt is `.github/workshop/build.md` plus the request. The cost is recorded from the agent's report.
3. **Path gate.** The base's copy of `scripts/workshop_paths.py` (never the branch's) refuses any change outside `app/`, `components/`, `lib/`, `server/`, `models/examples/`, `docs/`, `tests/`, `scripts/`, `public/`, `ROADMAP.md`, and `README.md`, and always refuses credential, safety, and path modules, `server/llm/`, requirements, the workshop's own scripts and the `check-*` scripts, the shell, packaging, CI, cloud, site, build configuration, dependency manifests, and the license, security, and privacy documents. Once this passes, every file the pipeline itself runs is the base's.
4. **Core CI.** `npm run typecheck`, `npm test`, `python -m pytest -q -m "not integration"`.
5. **Documentation.** `python3 scripts/check-docs.py`.
6. **Review** (build only). A second agent reviews the diff against `.github/workshop/review.md` (at most $1) and must approve.
7. **Build the layer.** `npm run desktop:web`, then `scripts/build-layer.cjs build`.
8. **Load test.** Download the base release's Linux `.deb`, unpack the layer, and run `packaging/smoke_backend.py --backend … --layer …` against the released service. This step has no token.
9. **Sign** with `LAYER_SIGNING_KEY`.
10. **Publish.** Push the branch, publish the prerelease `layer-<id>-v<version>` (archive, `.sig`, `layer.json`, and `cost.json`), and for builds open a draft pull request labelled `community-feature`. The attempt branch is deleted.

Every run uploads a `workshop-<id>` artifact with `report.json` (stage and message), `cost.json`, the review verdict, and `layer.json`, and writes a cost report to the run summary. A failed build keeps its work on the `-attempt` branch.

Steps that run code from the branch never see a token or secret. The agent's checkout has no stored credentials, so it cannot push.

## Setting up a fork

1. Fork the repository and enable Actions.
2. Generate a signing key pair:

   ```bash
   openssl genpkey -algorithm ed25519 -out layer-signing-key.pem
   openssl pkey -in layer-signing-key.pem -pubout -out layer-signing-key.pub
   ```

3. Add the secrets `ANTHROPIC_API_KEY` and `LAYER_SIGNING_KEY` (the private PEM) to the fork, then delete the private key file.
4. Make a release in the fork (the pipeline builds on release tags and downloads that release's Linux `.deb`), or build on an upstream tag that you mirror with its assets.
5. In the installed app, open **Settings → Personal features**, set the repository to your fork, save a fine-grained token, and paste `layer-signing-key.pub` into **Trust this key**.

## Tests

- `tests/layers.test.ts`: tar round trip, unsafe paths and links, signatures bound to a repository, install and its refusals, the launch plan, pruning, and the shipped key.
- `tests/test_workshop.py`: the path gate, the build plan and release rebuilds, scope and cost reports, a rejected review, notes, the layer build script, and that the workflow never puts request text into a script.
- `tests/test_workshop_client.py`: the repository setting, IDs, dispatch inputs, progress and reports, layers for this version only, and request validation, against a fake GitHub.
- The Desktop installers workflow builds a test layer on every platform, adds a module and endpoint the frozen base does not have (`packaging/layer_probe.py`), and checks that the bundled service runs the layer's code and serves its workbench.
