# Local development setup

Run commands from the repository root. This guide is for working on Gradara from source. To just use it, install the desktop app from [gradara.app](https://gradara.app/). No AI account is required for either.

## Prerequisites and platform status

| Tool | Requirement |
| --- | --- |
| Node.js / npm | Node 22.13 or newer. CI uses the Node 22 line. Use the committed npm lockfile. |
| Python | Python 3.12 is the development and CI baseline. Use a repository-local virtual environment. |
| Simulation engine | Either native OpenModelica 1.27 with the Modelica Standard Library 4.1.0 (Windows, Linux), or a running Docker-compatible engine for the `gradara-engine` image (macOS default, optional elsewhere). Settings → Engine in the app sets up either one. |
| AI provider | Optional, for block generation, model building, and C export: Gradara AI (sign in), your own OpenAI or Anthropic key, or the Codex CLI. See [agent setup](../AGENT_SETUP.md). |

| Platform | Status |
| --- | --- |
| macOS | Source runs exercised end to end with Colima. The desktop app is built and install-tested in CI on Apple silicon and Intel. |
| Windows | Native OpenModelica is the default engine, covered by the Native OpenModelica workflow. The desktop app is built and install-tested in CI. |
| Linux | Native OpenModelica or Docker. The desktop app (deb and AppImage) is install-tested in CI on Ubuntu 22.04 and 24.04. |

CI install tests start the app, render the workbench, and create a model; they do not run a simulation with a real engine. Do not treat passing tests on an OS as validation of its complete runtime.

## Install

macOS, Linux, or a WSL terminal:

```sh
git clone https://github.com/edgaralejod/gradara.git
cd gradara
npm ci
python3 -m venv .venv
.venv/bin/python -m pip install -r server/requirements-dev.txt
```

For runtime only, `server/requirements.txt` omits pytest and `httpx2`. `httpx2` is required for FastAPI/Starlette `TestClient` in the unit suite. Direct Python dependencies are pinned; their transitive dependencies are not yet captured in a full lockfile.

`npm ci` runs the version-checked React Flow observer patch. Do not bypass a patch failure or use `--ignore-scripts` for a working development install. See [patch maintenance](../../patches/README.md).

On native Windows, frontend and pure backend development can use:

```powershell
npm ci
py -3.12 -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r server/requirements-dev.txt
.\.venv\Scripts\python.exe -m pytest -q -m "not integration"
```

## Line endings

The repository stores **LF** for text files and checks them out as LF on Windows, macOS, and Linux. `.gitattributes` sets `eol=lf`, which overrides Git for Windows `core.autocrlf`. `.editorconfig` asks editors to save LF. Do not convert unrelated files to CRLF to silence a local Git warning; a fresh clone already has LF working copies.

If an existing Windows checkout still has CRLF files from before this policy, convert those text files to LF (most editors and `dos2unix` can do this), then `git add --renormalize .` after committing or stashing unrelated work. Do not run `git checkout -- .` while you have uncommitted edits.

## Select the Docker runtime

On macOS, install Docker CLI and Colima if using the default launcher path. It prefers an existing `colima-gradara` context, then the earlier `colima-flux`, and otherwise prepares a `gradara` profile. The VM starts with 4 CPUs, 4 GiB memory, and 30 GiB disk.

For Docker Desktop or another already running runtime, explicitly use the active context:

```sh
export GRADARA_DOCKER_CONTEXT=""
docker info
```

Or choose a context by its exact name from `docker context ls`:

```sh
export GRADARA_DOCKER_CONTEXT="your-context-name"
```

Linux and WSL use the active context by default. Keep the same context in the launcher, service terminal, and integration-test terminal. A successful `docker info` in a different context does not establish engine availability for Gradara.

## Start and stop

```sh
.venv/bin/python scripts/start.py
```

The launcher checks dependencies, builds `gradara-engine:1.27.0` if missing, starts both services, and opens the browser. The first engine build downloads OpenModelica's base image and Modelica Standard Library 4.1.0. It does not install Codex or sign you into a provider.

- Workbench: [http://localhost:4317](http://localhost:4317)
- Service health: [http://127.0.0.1:8765/api/health](http://127.0.0.1:8765/api/health)
- API reference: [http://127.0.0.1:8765/api/docs](http://127.0.0.1:8765/api/docs)

Keep the launcher terminal running. Use `--no-open` to skip browser opening. If both services already respond, the launcher opens the existing workspace. Logs are in `.runtime/service.log` and `.runtime/workbench.log`.

```sh
.venv/bin/python scripts/stop.py
```

Stopping preserves saved projects. Colima is a separate VM; `colima stop --profile gradara` stops it when no longer needed. Use the actual profile name if using the legacy `flux` profile. Do not stop a shared Docker runtime used by unrelated work.

## Run services separately

For backend hot reload, use two terminals after dependency installation and engine preparation:

```sh
.venv/bin/python -m uvicorn server.app:app --host 127.0.0.1 --port 8765 --reload --reload-dir server
```

```sh
npm run dev -- --port 4317
```

The Vite proxy forwards `/api` to the service. Keep these ports unless changing the proxy, origin allowlist, launcher, and documentation together. A manually started backend does not build the engine image; use the launcher first or the build command in [testing](TESTING.md).

Frontend-only work requires just `npm ci` and `npm run dev`. The block catalog at `/block-catalog` supports visual work without Docker. The full model workflow needs the Python service; offline save and simulation are not implemented. Pure backend tests do not need Docker or an agent account.

## Choose the simulation engine

`GRADARA_ENGINE=auto` (default) prefers a ready native OpenModelica install, then the Docker image. Force one with `GRADARA_ENGINE=native` or `docker`, or choose it in Settings → Engine. For native use, install OpenModelica 1.27 (official Windows installer or Linux packages) and let Settings → Engine install MSL 4.1.0, or run `omc` with `installPackage(Modelica, "4.1.0", exactMatch=true);`. `GRADARA_OMC` points at a specific `omc` executable.

## Optional AI configuration

Follow [AI feature setup](../AGENT_SETUP.md). Choose a provider in Settings → AI, or set `GRADARA_AI_PROVIDER` (`gradara`, `openai`, `anthropic`, `codex`, `off`). `GRADARA_GATEWAY_URL` points at a local Gradara AI gateway (see [cloud/README.md](../../cloud/README.md)); `GRADARA_CREDENTIAL_STORE=file` keeps secrets in a user-only file instead of the OS keychain. For the Codex CLI:

```sh
export GRADARA_CODEX_BIN="/path/to/codex"
```

The service reads process environment variables directly. `.env.example` is documentation; copying it to `.env` does **not** load variables into the Python service. Set variables in the launching shell. Legacy `FLUX_DOCKER_CONTEXT` and `FLUX_CODEX_BIN` remain aliases; prefer current names. Never commit credentials or your CLI configuration.

`agentReady` means the selected provider is configured (key saved, signed in, or CLI found), not that connectivity was tested. Read [security and data handling](../../SECURITY.md) for what generation sends to the provider.

## Files you own

`projects/models/` holds documents; `projects/workspace.json` is the active model; run snapshots, CSVs, prompts, and exports also live under `projects/`. These files and `.runtime/`, `.venv/`, build outputs, and local environment files are ignored by Git. Back them up separately. Contributors should use synthetic examples and never force-add a personal workspace to a PR.

## Desktop app

The desktop app is an Electron shell around a frozen copy of the local service and a static build of the workbench. See [distribution](../architecture/DISTRIBUTION.md).

```sh
cd desktop && npm ci && cd ..       # once: Electron and electron-builder
npm run desktop:start               # static workbench build + dev shell; uses .venv and the repo code
```

Build installers for the current OS:

```sh
python3 -m pip install -r server/requirements.txt pyinstaller==6.22.3   # in .venv
npm run desktop:dist                # workbench + PyInstaller service + installers for this OS
```

Outputs land in `desktop/dist/`. `python packaging/smoke_backend.py` checks the frozen service, and `python packaging/installer_selftest.py --exe <path to the built app>` checks a built or installed app end to end. The **Desktop installers** workflow builds and install-tests all platforms on pull requests and drafts a release on `v*` tags. In the installed app, data lives in the OS application-data folder under `Gradara/data`, and logs under `Gradara/logs` (Help menu shortcuts open both).

The repository retains optional Sites/Cloudflare build scaffolding with no database or bucket bindings. You do not need to register or publish a site to run Gradara locally. `npm run build` verifies the web bundle; it does not package the Python service or engine.
