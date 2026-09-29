# Supported platforms

This table is the single list of platforms Gradara builds for, how each one runs simulations, and what is tested automatically or by hand. Other documents link here instead of repeating it.

| OS / architecture | Desktop installer | Source checkout | Default engine | CI: build | CI: install test | CI: engine tests | Manual validation |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Windows, x64 | NSIS `.exe` | Yes ([PowerShell](development/SETUP.md#windows-powershell-from-source)) | Native OpenModelica 1.27 | Desktop installers | Windows (latest runner) | Native OpenModelica (weekly and manual) | Per release (buck example) |
| macOS, Apple silicon | DMG and ZIP | Yes | Docker image (Colima, OrbStack, or Docker Desktop) | Desktop installers | macOS 15 | None | Per release (buck example); source checkout with Colima |
| macOS, Intel | DMG and ZIP | Yes | Docker image (Colima, OrbStack, or Docker Desktop) | Desktop installers | macOS 15 Intel | None | Per release (buck example) |
| Linux x64 (Ubuntu 22.04, 24.04) | AppImage and `.deb` | Yes | Native OpenModelica 1.27, otherwise the Docker image | Desktop installers | Ubuntu 22.04 and 24.04 (`.deb` and AppImage) | Native OpenModelica on Ubuntu 22.04 (weekly and manual); Engine CI with Docker (manual) | Per release (buck example) |
| Windows via WSL | No | Yes (Linux steps) | Docker image or native OpenModelica inside WSL | None | None | None | None recorded |

Not built: Linux on ARM and Windows on ARM. They may work from a source checkout but are untested.

## What the columns mean

- **Desktop installer.** Packages from `desktop/electron-builder.yml`. None of them bundle OpenModelica; the app sets up the engine on first run. See [distribution](architecture/DISTRIBUTION.md#simulation-engine-per-platform).
- **Default engine.** What `GRADARA_ENGINE=auto` picks (`server/engines.py`): a ready native OpenModelica first, then the Docker image. OpenModelica publishes no macOS builds, so macOS uses the container.
- **CI: build.** The [Desktop installers](../.github/workflows/release.yml) workflow builds each installer on `v*` tags, on manual runs, and on pull requests that change packaging. [Core CI](../.github/workflows/ci.yml) runs typecheck, unit tests, and the web build on Ubuntu only.
- **CI: install test.** The same workflow installs each package on a clean runner, launches it twice in self-test mode, and uninstalls it. The self-test creates a model but does not run a simulation.
- **CI: engine tests.** [Native OpenModelica](../.github/workflows/native-engine.yml) runs the full Python suite against a host OpenModelica. [Engine CI](../.github/workflows/engine.yml) runs it against the Docker image. No workflow simulates on macOS.
- **Manual validation.** Each release installs every installer by hand and runs the buck example ([release checklist](RELEASING.md#desktop-installers)). Record the results in the release notes.
