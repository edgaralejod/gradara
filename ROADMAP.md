# Roadmap and contribution opportunities

Gradara's priority is a polished, usable diagram-to-simulation workflow. This is an ordered backlog, not a delivery schedule or claim of implemented capability. The [architecture](ARCHITECTURE.md), [wiring contract](docs/architecture/WIRING.md), and [testing guide](docs/development/TESTING.md) describe the current boundaries and acceptance process.

## Before the first public release

Done: the Apache-2.0 source is public, CI runs on GitHub, installers for Windows, macOS, and Linux are built and pass install tests in CI (first observed on pull request #2), gradara.app is live with a draft privacy notice and terms, and the Gradara AI service has a scripted deployment (`cloud/deploy.sh`). Remaining:

- Run the complete new-model/run/reopen/export workflow with a real engine from each installer (CI install tests start the app and create a model, but do not simulate); record actual platform results.
- Deploy the Gradara AI service in live mode and verify sign-in, one real purchase, a refund, and the webhook. Have the privacy notice and terms of service reviewed by counsel.
- Sign and notarize installers (Apple Developer ID; Windows code signing such as Azure Trusted Signing) so they open without security warnings. Auto-update already runs on Windows and the Linux AppImage; macOS applies updates only to signed builds.
- Review dependency inventory and attribution for the source distribution and each installer. Resolve the lint backlog before promoting lint to a required check.

## Near-term, bounded work

| Task | Scope | Done when |
| --- | --- | --- |
| AI onboarding | Settings → AI already covers provider choice, per-provider model selection, key verification, and Gradara AI sign-in, and the composers point to Settings when setup or sign-in is missing. Remaining: in-context messages for rejected keys, exhausted credits, and vendor outages, and hiding AI controls when AI is off. | A first-time user can distinguish missing setup, sign-in, credit, and vendor failures from the composer itself. Status probes never trigger paid generations. |
| Preserve route intent through save/load | Python Wire defaults currently erase the distinction between absent and empty waypoints. | A versioned or backward-compatible solution preserves auto versus explicit straight intent through API round trips, without changing saved geometry unexpectedly. |
| Keyboard and screen-reader access | Focus, discoverable actions, model dialogs, and canvas navigation. | A new user can create/open/run a model using the keyboard; assistive-technology sessions verify accessible names, focus return, and error recovery. |
| Lint cleanup | Small groups of existing workspace, editor, and UI primitive findings. | The strict lint command passes without blanket rule suppression; interaction regressions are checked. |
| Simulation settings | Solver/tolerance, output interval, initialization, and parameter sweeps. | Settings have useful defaults, are validated and recorded with each immutable run, and expose failures clearly. |
| Result inspection | Comparisons of arbitrary saved runs (configuration overlays from Run all exist), dual cursors, frequency-domain views, independently scaled dual Y axes, and live streaming. | Remaining inspector gaps are closed without losing event pairs, linked X ranges, or browser-local plot preferences. |
| Export cancellation cleanup | Process/container lifecycle in `server/exporter.py` (the AI path for custom blocks). | Cancellation and timeout leave no orphan compilation process or container; failure remains visible. |
| Model folders and organization | Build on the searchable My models / Examples / Trash browser. | Users can organize models into nested folders without changing document identity, physics, or example source files. |
| Example-driven blocks | Add one useful electrical/mechanical/control block at a time. | Shared design, valid connector contract, documented assumptions, and a meaningful real simulation. |
| Reusable component libraries | Validation status, saved custom definitions, and refinement review. | A component can be reused and revised without silently changing its existing instances or connections. |

Documentation improvements, synthetic bug fixtures, keyboard QA, and Linux/WSL installation reports are useful first contributions. Do not label a numerical or persistence change “easy” just because the patch is small.

## Wiring and diagram editing

These capabilities extend the current drawing engine; keep manual route intent, logical connectivity, and one-step undo intact.

| Task | Acceptance |
| --- | --- |
| Navigation during wiring | Connect to an off-screen target without ending the gesture. Preserve pinned corners through pan/zoom; stop edge-pan on cancellation, release, or focus loss. |
| Crowded target selection | Preview the exact receiving port/net and provide a way to disambiguate nearby targets. Crossing lines never connect by appearance alone. |
| Insert or remove in a connection | Insert a compatible signal block into one branch atomically, preserving other sinks and labels. Provide an explicit remove-and-heal action for unambiguous one-input/one-output cases. |
| Local obstacle routing | Respect block clearance and endpoint normals, retain pinned regions, and avoid unrelated route changes. Cover narrow passages and report an unresolved route without moving other blocks. |
| Flip | Mirror selected blocks through model operations, updating ports, labels, and incident routes; clockwise 90° rotation is already implemented. |

## Workbench quality at scale

Build reproducible 100- and 1,000-block interaction workloads and record frame times, route cost, and result-render latency on named hardware. Use measurements to decide whether routing, result reduction, or other work belongs in a worker. Define a bounded event-preview budget for dense switching models. Add automated browser gestures without replacing human interaction assessment, and exercise mouse, trackpad, touch, and pen on supported platforms.

## Installers and the engine

- **Windows:** ship OpenModelica and MSL inside the installer (or chain the official installer silently) so no separate download is needed.
- **macOS:** embed a small Linux VM (Lima on Apple Virtualization) with a prebuilt engine image so Docker is not required; revisit Apple's `container` tool and native OpenModelica builds as they mature.
- Publish the engine image to GitHub Container Registry from CI. The app already tries `ghcr.io/edgaralejod/gradara-engine:1.27.0` first, but no workflow pushes it yet, so every Docker setup falls back to building the image locally.
- Record per-platform install results, including slow disks, proxies, and non-admin accounts.

## AI service

- Move prompt templates server-side for Gradara AI so the gateway accepts task inputs instead of full prompts.
- Add streaming progress for long model builds, and a usage view (credits per operation) in Settings.
- Consider subscriptions with included credits once usage patterns are known; keep prepaid packs.
- Add local-model support (for example an OpenAI-compatible local endpoint) as another provider behind the same interface.

## Hierarchy and variants

Subsystems, shared definitions, promoted parameters, variants, and configurations are implemented (document version 2). Remaining work:

| Task | Acceptance |
| --- | --- |
| Subsystem preview | Hovering a subsystem block shows a thumbnail of its inside without opening it. |
| Compile inactive variants | Inactive variants are compiled by OpenModelica in the background, so their problems include compiler errors. Current checks are structural (ports and unconnected inputs). |
| Results by subsystem | Results groups series by subsystem instance instead of one flat list of `Instance › Block.port` names. |
| Library linking | A subsystem definition can live in another file and be linked from several models, with explicit update behavior. Today every definition is stored in its own document. |

## Expand modeling and export

1. Define scalar/vector/bus and sample-clock semantics, including buses across subsystem ports, before enabling mux/demux as executable blocks.
2. Close the loop in C verification: run the generated controller against the simulated plant (co-simulation) instead of replaying recorded plant signals. Add fixed-point formats and multi-rate task scheduling.
3. Extend physical domains through tested Modelica components and examples. Translational, magnetic, thermal, and three-phase blocks now wrap MSL 4.1.0 classes; hydraulics/fluid support is not implemented.
4. Add HDL only with explicit clock/reset, numeric, and latency contracts and toolchain validation.

Modelica round-trip import, FMI interoperability, and remote simulation are separate design milestones. A general Rust solver, MATLAB compatibility, and a cloud collaboration system are not prerequisites for the next useful release.
