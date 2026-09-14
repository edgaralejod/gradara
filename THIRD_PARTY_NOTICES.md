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

## Numerical engine

The Dockerfile references an upstream engine image; this source repository does not contain the engine binaries. It downloads MSL during the local image build. A later downloadable engine image or desktop installer must inventory everything it includes and satisfy applicable attribution, license, and source-distribution obligations.

| Component | Pinned version | Primary license source |
| --- | --- | --- |
| OpenModelica compiler | 1.27.0 | [OSMC-PL 1.8 document and AGPL v3 path](https://raw.githubusercontent.com/OpenModelica/OpenModelica/v1.27.0/OSMC-License.txt). |
| OpenModelica runtime | 1.27.0 | [Separate runtime terms](https://raw.githubusercontent.com/OpenModelica/OpenModelica/v1.27.0/OSMC-Runtime-License.txt), offering BSD New, AGPL v3, or OSMC-PL 1.8 alternatives. |
| Modelica Standard Library | 4.1.0 | [BSD-3-Clause license](https://raw.githubusercontent.com/modelica/ModelicaStandardLibrary/v4.1.0/LICENSE). |

OpenModelica's compiler, simulation runtime, OMPython, the base image's OS/toolchain, and Modelica libraries are distinct materials. Review their actual versions and licenses for the artifact being shipped. Running a compiler in another process or container is an architectural boundary, not a blanket license-compatibility determination. No project-wide relicense of these materials is claimed.

## Before distributing an artifact

Record exact dependency versions, copied-code provenance, required notices, and any source-offer obligations for that artifact. Review installed package license files, not just SPDX labels in metadata. Include generated controller/runtime dependencies if present. Do not claim a complete SBOM or redistribution review from this starter notice file alone. The [release checklist](docs/RELEASING.md) separates source preparation from binary packaging.
