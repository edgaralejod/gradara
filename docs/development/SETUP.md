# Local development setup

Just want to use Gradara? Download the installer — see [docs/INSTALL.md](../INSTALL.md).

Run commands from the repository root. This guide is for working on Gradara from source. No AI account is required.

## Prerequisites

| Tool | Requirement |
| --- | --- |
| Node.js / npm | Node 22.13 or newer. CI uses the Node 22 line. Use the committed npm lockfile. |
| Python | Python 3.12 is the development and CI baseline. Use a repository-local virtual environment. |
| Simulation engine | For a source checkout: either native OpenModelica 1.27 with the Modelica Standard Library 4.1.0 (Windows, Linux), or a running Docker-compatible engine for the `gradara-engine` image (macOS default, optional elsewhere). Settings → Engine in the app sets up either one. Installed desktop apps carry their own engine instead ([built-in engine bundles](#built-in-engine-bundles)). |
| AI provider | Optional, for block generation, model building, and C export: Gradara AI (sign in), your own OpenAI or Anthropic key, or the Codex CLI. See [agent setup](../AGENT_SETUP.md). |

Supported operating systems, default engines, and CI coverage are listed in [supported platforms](../PLATFORMS.md).

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

On native Windows, see [Windows (PowerShell) from source](#windows-powershell-from-source).

## Line endings

The repository stores **LF** for text files and checks them out as LF on Windows, macOS, and Linux. `.gitattributes` sets `eol=lf`, which overrides Git for Windows `core.autocrlf`. `.editorconfig` asks editors to save LF. Do not convert unrelated files to CRLF to silence a local Git warning; a fresh clone already has LF working copies.

If an existing Windows checkout still has CRLF files from before this policy, convert those text files to LF (most editors and `dos2unix` can do this), then `git add --renormalize .` after committing or stashing unrelated work. Do not run `git checkout -- .` while you have uncommitted edits.

## Select the Docker runtime

On macOS, install the Docker CLI and Colima for the default launcher path. The launcher uses the `colima-gradara` context when it exists, otherwise a running default runtime (OrbStack or Docker Desktop), and otherwise starts a `gradara` Colima profile. The VM starts with 4 CPUs, 4 GiB memory, and 30 GiB disk.

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

The launcher checks dependencies, starts both services, and opens the browser. When `docker` is on `PATH` and `GRADARA_ENGINE` is not `native`, it first prepares the Docker engine: on macOS it starts Colima if Docker does not answer, and it builds `gradara-engine:1.27.0` if the image is missing. The first build downloads OpenModelica's base image and Modelica Standard Library 4.1.0. Without `docker`, or with `GRADARA_ENGINE=native`, it skips Docker and the service uses native OpenModelica. The launcher does not install Codex or sign you into a provider.

- Workbench: [http://localhost:4317](http://localhost:4317)
- Service health: [http://127.0.0.1:8765/api/health](http://127.0.0.1:8765/api/health)
- API reference: [http://127.0.0.1:8765/api/docs](http://127.0.0.1:8765/api/docs)

Keep the launcher terminal running. Use `--no-open` to skip browser opening. If both services already respond, the launcher opens the existing workspace. Logs are in `.runtime/service.log` and `.runtime/workbench.log`.

```sh
.venv/bin/python scripts/stop.py
```

Stopping preserves saved projects. Colima is a separate VM; `colima stop --profile gradara` stops it when no longer needed. Do not stop a shared Docker runtime used by unrelated work.

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

`GRADARA_ENGINE=auto` (default) uses the built-in engine when there is one (installed apps, or `GRADARA_ENGINE_BUNDLE`), and otherwise prefers a ready native OpenModelica install, then the Docker image. Force one with `GRADARA_ENGINE=bundled`, `native`, or `docker`, or choose it in Settings → Engine. For native use, install OpenModelica 1.27 (official Windows installer or Linux packages) and let Settings → Engine install MSL 4.1.0, or run `omc` with `installPackage(Modelica, "4.1.0", exactMatch=true);`. `GRADARA_OMC` points at a specific `omc` executable.

## Windows (PowerShell) from source

The full app runs on native Windows with native OpenModelica; Docker is not needed.

1. Install Node.js 22, Python 3.12, Git, and OpenModelica 1.27 (official Windows installer).
2. Install dependencies:

   ```powershell
   git clone https://github.com/edgaralejod/gradara.git
   cd gradara
   npm ci
   py -3.12 -m venv .venv
   .\.venv\Scripts\python.exe -m pip install -r server/requirements-dev.txt
   ```

3. Start the launcher with the native engine:

   ```powershell
   $env:GRADARA_ENGINE = "native"
   .\.venv\Scripts\python.exe scripts/start.py
   ```

   Without `GRADARA_ENGINE=native`, the launcher tries to build the Docker image whenever `docker` is on `PATH`.
4. In the workbench, open Settings → Engine and install the Modelica Standard Library 4.1.0 if it reports it missing.

The service finds `omc.exe` through `GRADARA_OMC`, then `OPENMODELICAHOME`, then `PATH`, then `OpenModelica*` folders under Program Files and `%LOCALAPPDATA%`. Set `GRADARA_OMC` to the full path of `omc.exe` to pick one install. Stop the launcher with Ctrl+C in its window. Run the unit tests with `.\.venv\Scripts\python.exe -m pytest -q -m "not integration"`.

## Legacy names

Earlier development builds used the name Flux. The code still accepts the old names as aliases: the `colima-flux` Docker context, the `flux-engine:1.27.0` image, and the `FLUX_DOCKER_CONTEXT` and `FLUX_CODEX_BIN` variables. Use the current names.

## Optional AI configuration

Follow [AI feature setup](../AGENT_SETUP.md). Choose a provider in Settings → AI, or set `GRADARA_AI_PROVIDER` (`gradara`, `openai`, `anthropic`, `codex`, `off`). `GRADARA_GATEWAY_URL` points at a local Gradara AI gateway (see [cloud/README.md](../../cloud/README.md)); `GRADARA_CREDENTIAL_STORE=file` keeps secrets in a user-only file instead of the OS keychain. For the Codex CLI:

```sh
export GRADARA_CODEX_BIN="/path/to/codex"
```

The service reads process environment variables directly. `.env.example` is documentation; copying it to `.env` does **not** load variables into the Python service. Set variables in the launching shell. Never commit credentials or your CLI configuration.

`agentReady` means the selected provider is configured (key saved, signed in, or CLI found), not that connectivity was tested. Read [security and data handling](../../SECURITY.md) for what generation sends to the provider.

## Regenerate the MSL library

Library blocks that wrap Modelica Standard Library classes come from two checked-in generated files. `server/msl_index.json` lists the MSL 4.1.0 classes Gradara may instantiate, with their parameters and connectors; `lib/gradara/msl-blocks.ts` holds the block definitions. Normal work needs neither script. Regenerate the index only when changing MSL versions or the packages it covers, from an MSL source checkout:

```sh
git clone --depth 1 --branch v4.1.0 https://github.com/modelica/ModelicaStandardLibrary msl
python3 scripts/msl-index.py msl/Modelica > server/msl_index.json
```

The argument can be the checkout or its `Modelica` folder. After changing the block list in `scripts/msl-blocks.py`, or the index, regenerate the blocks:

```sh
python3 scripts/msl-blocks.py > lib/gradara/msl-blocks.ts
```

It prints the block count on stderr and fails on any class, parameter, or connector missing from the index. `tests/test_msl.py` fails when the generated file differs from the script's output. The [block authoring guide](../blocks/AGENT_BLOCK_GUIDE.md#wrap-a-modelica-standard-library-class) describes adding a block.

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

Every installer includes a simulation engine: put this platform's engine in `build/engine` first (see below), or the installer has none. Outputs land in `desktop/dist/`. `python packaging/smoke_backend.py` checks the frozen service (and, with a Windows or Linux engine in `build/engine`, runs a simulation on it), and `python packaging/installer_selftest.py --exe <path to the built app> --simulate` checks a built or installed app end to end, including a simulation and a generated-C verification on its built-in engine. The **Desktop installers** workflow builds and install-tests every platform in [supported platforms](../PLATFORMS.md) on pull requests that change packaging, and drafts a release on `v*` tags. In the installed app, data lives in the OS application-data folder under `Gradara/data`, and logs under `Gradara/logs` (Help menu shortcuts open both).

The repository retains optional Sites/Cloudflare build scaffolding with no database or bucket bindings. You do not need to register or publish a site to run Gradara locally. `npm run build` verifies the web bundle; it does not package the Python service or engine.

### Built-in engine bundles

Each installer ships OpenModelica 1.27.1 with the Modelica Standard Library 4.1.0 in `resources/engine`. The scripts in `packaging/engine/` build one engine per platform; the **Engine bundles** workflow runs them, tests each engine, and hands them to the installer jobs in the same run. To build one locally:

| Engine | Build on | Command |
| --- | --- | --- |
| Linux x64 | Ubuntu 22.04 (a machine or an `ubuntu:22.04` container), as root or with sudo | `bash packaging/engine/build-linux.sh build/engine` |
| Windows x64 | Windows, with Python 3.12 | `python packaging/engine/build_windows.py --out build\engine` (downloads and silently installs the official OpenModelica installer, then copies what Gradara needs with `packaging/engine/trim_windows.py`) |
| macOS VM image | Linux with Docker and `squashfs-tools` (arm64 image: an arm64 machine, or binfmt/QEMU) | `bash packaging/engine/build-macos-guest.sh arm64 build/engine` (or `amd64`) |

`packaging/engine/pack_bundle.py` archives a bundle with its checksum and `packaging/engine/fetch_bundle.py` unpacks one into `build/engine` (on macOS it also thins vfkit to the target architecture). `packaging/engine/test_clean_linux.sh build/engine` simulates a Linux bundle in clean containers that have only `gcc`.

To run the service from source against a bundle, set `GRADARA_ENGINE_BUNDLE` to its folder (a Windows or Linux bundle; a macOS bundle needs a Mac). `GRADARA_ENGINE_VM_MEMORY` sets the macOS engine VM's memory in MiB (default 3072). `GRADARA_ENGINE_VM_TCP` is for tests only: it points the VM backend at a guest agent reached over TCP (the image run under Docker with `GRADARA_AGENT_TCP`) instead of booting a VM; see [testing](TESTING.md#built-in-engine).
