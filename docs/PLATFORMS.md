# Supported platforms

This table is the single list of platforms Gradara builds for, how each one runs simulations, and what is tested automatically or by hand. Other documents link here instead of repeating it.

| OS / architecture | Desktop installer | Source checkout | Built-in engine | CI: engine build and tests | CI: install test | Manual validation |
| --- | --- | --- | --- | --- | --- | --- |
| Windows, x64 | NSIS `.exe` | Yes ([PowerShell](development/SETUP.md#windows-powershell-from-source)) | OpenModelica 1.27.1, trimmed from the official installer, with its C toolchain | Built from the official installer; full engine suite on the trimmed copy with the full install moved away | Windows (latest runner): installs, simulates, verifies generated C | Per release (buck example) |
| macOS, Apple silicon | DMG and ZIP | Yes | OpenModelica 1.27.1 in a Linux VM (arm64 image, vfkit) | Image built on an arm64 Linux runner; full engine suite through the VM backend with the image under Docker | macOS 15: installs and launches. GitHub's Apple silicon runners cannot start VMs, so no simulation | Per release: install and run the buck example on an Apple silicon Mac (required) |
| macOS, Intel | DMG and ZIP | Yes | OpenModelica 1.27.1 in a Linux VM (x86-64 image, vfkit) | Image built and tested as above; the VM boots on macOS 15 Intel and runs engine tests | macOS 15 Intel: installs, boots the VM, simulates, verifies generated C | Per release (buck example) |
| Linux x64 | AppImage and `.deb` | Yes | OpenModelica 1.27.1 relocated from the Ubuntu 22.04 packages; uses the system `gcc` | Simulates in clean Ubuntu 22.04, 24.04 and Debian 12 containers with only `gcc`; full engine suite | Ubuntu 22.04 and 24.04 (`.deb` simulates; AppImage launches) | Per release (buck example) |
| Windows via WSL | No | Yes (Linux steps) | None: native OpenModelica or Docker inside WSL | None | None | None recorded |

Not built: Linux on ARM and Windows on ARM. They may work from a source checkout but are untested.

## What the columns mean

- **Desktop installer.** Packages from `desktop/electron-builder.yml`. Each one includes its platform's engine under `resources/engine`. See [distribution](architecture/DISTRIBUTION.md#simulation-engine-per-platform).
- **Built-in engine.** What `GRADARA_ENGINE=auto` uses in an installed app (`server/engines.py`, the `bundled` backend). Source checkouts have no built-in engine unless `GRADARA_ENGINE_BUNDLE` points at one; they use a native OpenModelica or the Docker image as before.
- **CI: engine build and tests.** The [Engine bundles](../.github/workflows/engine-bundle.yml) workflow, which the [Desktop installers](../.github/workflows/release.yml) workflow runs first in the same run. [Native OpenModelica](../.github/workflows/native-engine.yml) and [Engine CI](../.github/workflows/engine.yml) still test the source-checkout engines.
- **CI: install test.** The Desktop installers workflow installs each package on a clean runner, launches it in self-test mode (with `--simulate` where the runner can run the engine: it runs the DC motor example and verifies the controller's generated C), launches it again, and uninstalls it. It runs on `v*` tags, on manual runs, and on pull requests that change packaging. [Core CI](../.github/workflows/ci.yml) runs typecheck, unit tests, and the web build on Ubuntu only.
- **Manual validation.** Each release installs every installer by hand and runs the buck example ([release checklist](RELEASING.md#desktop-installers)). The Apple silicon check is required because CI cannot run that engine. Record the results in the release notes.
