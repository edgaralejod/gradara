# Third-party notices and distribution scope

Gradara's original source code, documentation, and bundled example models are licensed under [Apache-2.0](LICENSE); see [NOTICE](NOTICE). Third-party code, dependencies, and engine components retain their own licenses. This inventory identifies included/adapted material and the separate terms relevant to distribution.

## Source included or adapted in this repository

| Material | Upstream | Terms / retained notice |
| --- | --- | --- |
| React Flow observer snippets in `patches/` | `@xyflow/react` 12.11.6, webkid GmbH / xyflow | MIT; [complete notice](LICENSES/xyflow-MIT.txt). Gradara changes observer scheduling; see [patch details](patches/README.md). |
| UI primitives and scaffold in `components/ui/` | shadcn/ui | MIT; [complete notice](LICENSES/shadcn-MIT.txt). Local adaptations remain subject to upstream attribution. |
| Lucide icons used by the workbench | `lucide-react` 1.31.0 | ISC, with separately identified Feather-derived icons under MIT; [complete distributed notice](LICENSES/lucide.txt). |

Preserve these notices in redistributed source or bundles containing the corresponding material. Identify other copied/adapted code when adding it. A dependency's name in a table is not a substitute for including its required license text in a distributed package.

## Application dependencies

The complete npm resolution is recorded in [package-lock.json](package-lock.json); direct dependencies are in [package.json](package.json). The current stack includes React, React Flow, Monaco, Vinext, Vite, FastAPI, Pydantic, Uvicorn, and their dependencies. Most of the JavaScript UI stack reports MIT licensing, but review the actual license files and all transitive packages when creating a distribution. The lockfile is not a complete bundled-license report.

The optional Sites Vite plugin is a public dependency of the build scaffold. Its current package reports MIT licensing. No hosted-site credentials, bucket names, database bindings, or deployment IDs are required by the checked-in configuration. Optional Codex CLI installation and service use retain their own terms; the CLI is not bundled in this source repository.

## Desktop installers and the AI service

Desktop installers bundle Electron (MIT, with Chromium's notices in `LICENSES.chromium.html` inside the app), electron-updater (MIT), a Python runtime (PSF License) frozen with PyInstaller (GPL-2.0 with the bootloader exception, which permits distributing frozen applications), and the service's Python dependencies: FastAPI, Starlette, Pydantic, Uvicorn, httpx (BSD-3-Clause), and keyring (MIT). Installers also include Gradara's example models, `engine_runner.py`, `Dockerfile.engine` (for the optional container engine), and the built-in simulation engine described below. Gradara's own license files are copied to the app's `legal/` resources, together with `THIRD_PARTY_LICENSES.txt`: the name, version, declared license, and license text of every npm and Python package the installer ships, plus the Python runtime and every component of the built-in engine. `packaging/third_party_licenses.py` generates it from the installed dependencies in every installer build.

The Gradara AI service (`cloud/`) additionally uses SQLAlchemy (MIT), psycopg (LGPL-3.0, used as an unmodified library), the Stripe Python library (MIT), google-auth and firebase-admin (Apache-2.0). The service is operated, not distributed, but the container image contents should still be inventoried.

## Numerical engine

Every desktop installer includes a built-in engine in `resources/engine`, built by the scripts in `packaging/engine/` from unmodified upstream binaries:

| Installer | Engine contents |
| --- | --- |
| Windows | OpenModelica 1.27.1 trimmed from the official Windows installer: `omc`, its DLLs, the C runtime, headers, and the MSYS2 ucrt64 toolchain packages it needs (GCC, binutils, make, OpenBLAS, the MinGW-w64 runtime, and their dependencies) |
| Linux | OpenModelica 1.27.1 from its Ubuntu 22.04 packages, the shared libraries they need beyond glibc, the gcc runtime, zlib and OpenSSL (BLAS/LAPACK, libcurl and its dependencies, omniORB, expat, gfortran), and GNU make |
| macOS | A Linux virtual machine: an Ubuntu 24.04 root filesystem with OpenModelica 1.27.1, GCC, make and Python, the Ubuntu Linux kernel, and vfkit (Apache-2.0) to boot it |

All three include the Modelica Standard Library 4.1.0 (BSD-3-Clause, with the licenses of its bundled C libraries). OpenModelica is licensed under the OSMC Public License 1.8; Gradara redistributes it unmodified under that license's GNU AGPL version 3 mode, stated in `OSMC-USAGE-MODE.txt` beside `OSMC-License.txt` in each engine. GCC, binutils, make, the Linux kernel, and several libraries are GPL or LGPL licensed. Each engine records its package inventory (`packages.txt`, and `packages.json` for the Windows toolchain) and carries the packages' license and copyright files; `packaging/third_party_licenses.py` copies all of them into the installer's `THIRD_PARTY_LICENSES.txt`, together with a written offer of the corresponding source code for three years and links to the upstream sources (OpenModelica on GitHub, Ubuntu packages on Launchpad, MSYS2 packages at repo.msys2.org).

Source checkouts contain no OpenModelica binaries. There the optional container engine pulls `ghcr.io/edgaralejod/gradara-engine:1.27.0` or builds it locally from `Dockerfile.engine`, which starts from an upstream OpenModelica image and downloads MSL. Before that image is published to the registry, inventory its contents and satisfy the same obligations.

| Component | Pinned version | Primary license source |
| --- | --- | --- |
| OpenModelica compiler | 1.27.1 (built-in engine), 1.27.0 (container image) | [OSMC-PL 1.8 document and AGPL v3 path](https://raw.githubusercontent.com/OpenModelica/OpenModelica/v1.27.1/OSMC-License.txt). |
| OpenModelica runtime | 1.27.1 (built-in engine), 1.27.0 (container image) | [Separate runtime terms](https://raw.githubusercontent.com/OpenModelica/OpenModelica/v1.27.1/OSMC-Runtime-License.txt), offering BSD New, AGPL v3, or OSMC-PL 1.8 alternatives. |
| vfkit | v0.6.4 (macOS engine) | [Apache-2.0](https://github.com/crc-org/vfkit/blob/main/LICENSE). |
| Modelica Standard Library | 4.1.0 | [BSD-3-Clause license](https://raw.githubusercontent.com/modelica/ModelicaStandardLibrary/v4.1.0/LICENSE). |

### MSL class index in this repository

`server/msl_index.json` is generated by `scripts/msl-index.py` from the Modelica Standard Library 4.1.0 source. It records class paths, parameter names and types, and connector names for the classes that built-in blocks wrap, and it ships with the app. `lib/gradara/msl-blocks.ts` names the same classes and parameters. No MSL model code or documentation text is copied. The MSL is distributed under the BSD-3-Clause license:

> Copyright (c) 1998-2025, Modelica Association and contributors. All rights reserved.
>
> Redistribution and use in source and binary forms, with or without modification, are permitted provided that the following conditions are met: redistributions of source code must retain the above copyright notice, this list of conditions and the following disclaimer; redistributions in binary form must reproduce the above copyright notice, this list of conditions and the following disclaimer in the documentation and/or other materials provided with the distribution; neither the name of the copyright holder nor the names of its contributors may be used to endorse or promote products derived from this software without specific prior written permission.
>
> THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS "AS IS" AND ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE ARE DISCLAIMED. IN NO EVENT SHALL THE COPYRIGHT HOLDER OR CONTRIBUTORS BE LIABLE FOR ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR CONSEQUENTIAL DAMAGES (INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR SERVICES; LOSS OF USE, DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER CAUSED AND ON ANY THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY, OR TORT (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE OF THIS SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.

OpenModelica's compiler, simulation runtime, OMPython, the base image's OS/toolchain, and Modelica libraries are distinct materials. Review their actual versions and licenses for the artifact being shipped. Running a compiler in another process or container is an architectural boundary, not a blanket license-compatibility determination. No project-wide relicense of these materials is claimed.

## Before distributing an artifact

`THIRD_PARTY_LICENSES.txt` records the exact versions and license texts of the npm and Python packages and the built-in engine in each installer. When a dependency is added, check that its license allows redistribution and that its package includes a license file; the generator lists packages that have none. Record copied-code provenance in the table above, and any source-offer obligations for components that are not permissively licensed. This file is not a complete SBOM. The [release checklist](docs/RELEASING.md) separates source preparation from binary packaging.
