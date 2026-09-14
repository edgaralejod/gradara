# Roadmap and contribution opportunities

Gradara's priority is a polished, usable diagram-to-simulation workflow. This is an ordered backlog, not a delivery schedule or claim of implemented capability. The [architecture](ARCHITECTURE.md), [wiring contract](docs/architecture/WIRING.md), and [testing guide](docs/development/TESTING.md) describe the current boundaries and acceptance process.

## Before the first public release

- Make the Apache-2.0 source accessible to public contributors and verify reporting channels and repository settings in the [release checklist](docs/RELEASING.md).
- Exercise a clean install and the complete new-model/run/reopen/export workflow on Linux and Windows/WSL as well as macOS; record actual platform results.
- Run the configured core and engine CI workflows on the public host. Resolve the lint backlog before promoting lint to a required check.
- Review dependency inventory and attribution for the source distribution. Treat redistributable engine images and installers as a separate packaging task.

## Near-term, bounded work

| Task | Scope | Done when |
| --- | --- | --- |
| Agent onboarding | CLI discovery/version, authentication, explicit model selection, and useful provider errors. | A first-time user can distinguish missing installation, sign-in, engine, and account failures; documented public-CLI generation succeeds on a clean setup. Status probes do not silently trigger paid generations. |
| Preserve route intent through save/load | Python Wire defaults currently erase the distinction between absent and empty waypoints. | A versioned or backward-compatible solution preserves auto versus explicit straight intent through API round trips, without changing saved geometry unexpectedly. |
| Keyboard and screen-reader access | Focus, discoverable actions, model dialogs, and canvas navigation. | A new user can create/open/run a model using the keyboard; assistive-technology sessions verify accessible names, focus return, and error recovery. |
| Lint cleanup | Small groups of existing workspace, editor, and UI primitive findings. | The strict lint command passes without blanket rule suppression; interaction regressions are checked. |
| Clearer simulation diagnostics | Map compiler/runtime errors to named blocks and ports. | A problems list selects the relevant block or net while preserving expandable raw diagnostics. |
| Simulation settings | Solver/tolerance, output interval, initialization, and parameter sweeps. | Settings have useful defaults, are validated and recorded with each immutable run, and expose failures clearly. |
| Result inspection | Cursors, synchronized plots, mixed units, range selection, and saved viewing preferences. | Numerical values and units are unambiguous, viewing preferences survive reopen, and dense event traces remain responsive. |
| Export cancellation cleanup | Process/container lifecycle in `server/exporter.py`. | Cancellation and timeout leave no orphan compilation process or container; failure remains visible. |
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
| Rotate and flip | Transform ports, labels, and incident routes through model operations; a CSS transform alone is insufficient. |

## Workbench quality at scale

Build reproducible 100- and 1,000-block interaction workloads and record frame times, route cost, and result-render latency on named hardware. Use measurements to decide whether routing, result reduction, or other work belongs in a worker. Define a bounded event-preview budget for dense switching models. Add automated browser gestures without replacing human interaction assessment, and exercise mouse, trackpad, touch, and pen on supported platforms.

## Agent provider boundary

Start with the documented local Codex workflow. Extract a provider-neutral structured-generation contract around prompt, JSON schema, cancellation, result, and diagnostics before adding a second provider. Keep component validation, compiler-driven repair, and numerical execution independent of provider choice. The existing adapter is Codex-specific; other providers and local models are not implemented. A hosted service would separately need authentication, per-user credentials/usage accounting, and job isolation. It is not required for the local release.

## Expand modeling and export

1. Design hierarchical subsystems with stable boundary ports, explicit controller selection, and document migrations.
2. Define scalar/vector/bus and sample-clock semantics before enabling placeholders as executable blocks.
3. Compare generated controller C against Modelica trajectories for supported timing/discretization contracts.
4. Extend physical domains through tested Modelica components and examples; the current thermal domain identifier is not a full thermal library, and hydraulics/fluid support is not implemented.
5. Add HDL only with explicit clock/reset, numeric, and latency contracts and toolchain validation.

Modelica round-trip import, FMI interoperability, remote execution, and desktop installers are separate design milestones. A general Rust solver, MATLAB compatibility, and a cloud collaboration system are not prerequisites for the next useful release.
