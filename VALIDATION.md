# First demo validation

Validated locally on Apple Silicon macOS on 9 September 2026.

- Production web build completed successfully; TypeScript checks passed.
- Five editing-contract tests passed: connection validation, deletion cleanup, duplication, port-preserving revision, and simulation identity independent of layout.
- Four Python contract/integration tests passed, including real OpenModelica runs with 100 and 60 rad/s setpoints and detection of broken feedback.
- A real Codex-generated deadband component was checked and inserted into the motor graph. The assembled model ran successfully, settling at approximately 99.92 rad/s for a 100 rad/s reference through a 0.1 deadband.
- Baseline motor simulation completed in 2.0 seconds on the final smoke run, with 9,103 output samples. This is a measured single example, not a general performance benchmark.
- Save/reopen, Modelica-source retrieval, complete CSV download, and compiled C-package download passed through the running application service.
- Codex generated the C controller; GCC compiled it as C11 with warnings treated as errors. Target execution, hardware timing, and behavioral equivalence were not tested.
- The persistent launcher started the UI and service, and both responded successfully. Browser pointer/keyboard/visual QA and WebMCP execution were not performed.

The UI currently runs at http://localhost:4317. Local run records, generated artifacts, and operational logs are retained in the ignored projects/ and .runtime/ directories.

## Interaction correction pass — 9 September 2026

Direct computer-use testing was performed in Chrome and the visible in-app browser. The original repeated node-initialization warnings and ResizeObserver overlays were reproduced. After the correction, repeated corner resizing, moving, selection, and panel interactions no longer reproduced those errors. Historical development/HMR errors remain in the session logs; they are not new runtime failures.

Verified through pointer/keyboard actions and the documented model-readback interface:

- Lower-right resize of Gain and the wired PI controller; top-left resize changes both size and origin.
- Connected wires follow the resized controller in the rendered diagram.
- Move and corner-resize undo/redo restore the complete gesture, including redo after undo.
- Block size and origin survive autosave and a full page reload.
- Inspector width changes create one undo step; renaming commits once and is undoable; an empty name draft does not save an invalid project.
- Shift-click selects multiple blocks; dragging moves them together and one undo restores both.
- Hand-tool panning changes the viewport; selection mode and fit-to-view remain available.
- Initial fit and the results plot render at a 1280 × 720 in-app viewport without covering the diagram with the former caption and action toolbar.

Nine TypeScript editing/gesture tests and four Python contract tests pass. The existing numerical integration test was not repeated in this pass because numerical execution did not change. The added server round-trip test verifies size persistence and unchanged numerical identity. TypeScript checking and the production build pass.

Remaining work includes manual wire routing/obstacle avoidance, larger-model performance measurements, and native Windows/Linux interaction testing. No claim of Simulink parity or a measured frame rate is made.

## Engineering notation and AC motor pass — 10 September 2026

- Replaced card-like diagram nodes with compact engineering notation: triangular gains,
  circular sums/subtractors, fractional integrators, motor and inverter symbols, outside
  names, orthogonal signal arrows, and branch junction dots.
- Physical connection markers, signal markers, labels, and hover descriptions follow each
  port's own domain, including mixed-domain components. Physical connections are square;
  signals are round. Styling does not change numerical equations.
- Added a reusable 19-component, 31-connection PMSM FOC example. Its 48 V averaged inverter,
  phase-current transforms, speed and d/q current loops, and mechanical load execute in
  OpenModelica. The example has five scope groups and a last-50-ms scope window.
- Nine TypeScript editing/gesture tests and six Python tests passed. The real-engine tests
  exercise 1500 and 1000 rpm FOC commands, near-zero steady d-axis current, balanced phase
  currents, a load step, bounded startup overshoot, and the existing DC motor feedback.
- Final browser-triggered FOC run completed in 2.56 seconds with 6,010 solver output rows.
  Final rotor speed was approximately 1500.34 rpm. These are example measurements.
- Scope output preserves a dense final 50 ms alongside a reduced full-run preview; the
  complete CSV remains downloadable. No invented or prerecorded waveforms are used.
- Computer-use checks covered DC/AC example switching and automatic fitting, saved model
  reopening, triangle resize (68×56 to 98×86) and undo, circular-junction resize (36×36 to
  56×56) and undo, and phase-current plot controls. All 31 wires survived resizing.
- Both example documents persist independently. Result retrieval prefers a run matching
  the saved executable model instead of the most recent unrelated parameter experiment.
- TypeScript checking and the production build passed. After the final browser reload and
  scope interaction, no new warning or error entries were recorded. Earlier HMR warnings
  from replacing node/edge component modules remain in the development session history.

Automatic obstacle avoidance, interactive wire-waypoint editing, hardware-ready FOC export,
and native Windows/Linux QA remain outside this pass. See `models/FOC.md` for physical-model
assumptions and source references.

## Block design audit — 2026-09-13

- Reviewed all 60 catalog definitions across all ten categories in the browser, using their full-size face and library specimens. Checked the dense PMSM at 200% zoom. DOM inspection found no symbol-container overflow in either full-size or thumbnail specimens at standard dimensions.
- Checked the library in the existing 736 px-wide workbench, including the narrow component pane. Names can wrap to two lines; descriptions truncate with full button tooltips.
- Inserted a temporary Step: it received the unique name Step2 and explicit 80 × 64 dimensions. Enlarged its width to 120; computed diagram font stayed 14 px. Use standard size restored 80 × 64. All temporary changes were undone.
- Applied Use standard size to the existing wired Step. Its output and the Sum input retained exactly the same screen y coordinate. Undo restored 64 × 56. Compared the saved project before/after UI testing: every field matched except the revision counter.
- 131 frontend tests pass, including all-catalog port-placement checks, legacy-size preservation, dense generated interfaces, and numeric-notation bounds. Typecheck, targeted lint, and production build pass. The build retains its existing large-chunk warning.
- 19 non-integration backend tests pass. The three solver integration tests were not rerun for this presentation change. The restarted local service reports OpenModelica and the agent ready.

## Simulation and document workflow — 2026-09-13

- Ran the actual local OpenModelica 1.27.0 engine: DC speed commands at 100/60 rad/s, FOC commands at 1500/1000 rpm with a load disturbance and balanced phase currents, and branched scalar feedback. Scope and Display input traces are included in the plot series as well as the complete CSV.
- A deliberately singular positive-feedback loop fails with solver diagnostics and produces no successful result file. Empty OMPython string errors no longer hide the simulation log; an initialization-success message or incomplete CSV cannot count as a completed simulation. Unconnected signal inputs and unsupported subsystem/mux placeholders get explicit preflight errors.
- Browser QA: the user's 21-block edited FOC model reports `Limited integrator.u`, `Subtract.+`, and `Subtract.−` as unconnected. A separate **FOC motor control** document runs successfully and settles at approximately 1500.34 rpm for a 1500 rpm command. Tested arbitrary phase-current selection, comparison, and the final 50 ms view, plus CSV access through the frontend proxy.
- Stop was verified during a real job; the service reported `cancelled`. A subsequent browser Run completed normally. Reopening the edited model preserved its equations and all block geometry, returned no unrelated results, and reopening the verified model restored only its matching result.
- Removed the public wiring example and its reset flow. Preserved the old edited document as **Feedback control**. Saved documents now have stable IDs and independent files in `projects/models/`; built-in DC/FOC templates create new documents. The feedback regression fixture lives under `tests/fixtures/`.
- Placement snaps horizontal centerlines, with connected-port alignment taking priority over grid rounding. Browser-tested a Sum drag in an off-grid legacy FOC layout: its centerline and the downstream port matched to rendering precision. Test gestures were undone. API documents omit unset optional values, with regressions for null port offsets so visual and numerical geometry cannot disagree.
- 137 frontend tests, 24 non-integration backend tests, and four real-engine integration tests pass. Typecheck, targeted lint for the changed geometry/result modules, and the production build pass. The build retains its existing large-chunk warning. No browser script errors were recorded after the final reload and scope interaction.

This verifies the existing solver path and tested models, not every possible user-authored equation or a complete simulation implementation for all palette placeholders.

## New models, ideal-switch buck, and example refresh — 2026-09-13

- Created an independent blank document through **New model**, searched the library, inserted a Step, used undo, simulated it, and reloaded its matching results. New document creation preserves existing saved models, allocates independent IDs, and handles duplicate names and invalid requests.
- The New model dialog offers Blank, DC motor, AC/FOC, and Buck. Empty models have next-step guidance and disabled Run. The toolbar spans the full workspace; narrow side panels are mutually exclusive. Stop time is available in model properties. The shortcuts list scrolls without hiding its title/close control.
- Added five reusable power components, including actual MSL ideal closing switches configured with Ron=0/Goff=0. The synchronous buck uses two complementary switches, a 24 V source, 1 mH / 100 µF filter, and 10 Ω load. Its 20 ms run includes startup and switching ripple; it is not an averaged converter.
- Real-engine validation over the final ten cycles: D=0.5 gives 12.000296 V, 1.199899 A, 76.250 mV p-p voltage ripple and 0.601574 A p-p inductor ripple. D=0.25 gives 6.000171 V and 0.599951 A. Tests also verify complementary gate states, zero initial capacitor voltage, and complete finite traces.
- Plot controls now include Last 10%, Last 50 ms, Last 1 ms, and Fit Y. Time axes adapt to seconds/milliseconds/microseconds. Event pairs and a dense tail survive preview reduction; raw CSV remains complete. Preview final values exclude output-grid rows beyond the requested stop time.
- DC, FOC, and buck templates use explicit shared default dimensions, curated routes/captions, and useful default result groups. The DC default compares rotor speed with its command. Geometry checks verify standard sizes and no wire crossing an unrelated block body. Generated DC/FOC Modelica remained byte-for-byte identical before/after their layout refresh. Browser-triggered DC/FOC runs complete; FOC reaches about 1500.34 rpm. Saved user documents were not migrated to the new layouts.
- Reviewed new power faces and library specimens at 100%/200% in the catalog. Enlarged the ideal switch from 48 × 80 to 72 × 112 in the canvas, inspected lead continuity, and undid both edits. The entire saved project matched its prior content except revision. Reviewed the 736 × 769 and 1280 × 720 workspace layouts.
- 141 frontend tests and 36 backend tests pass, including five real-engine integration checks. Typecheck, targeted lint for new/changed UI and layout modules, the production build, and diff whitespace checks pass. Existing build chunk-size warnings remain. The UI/architecture assessment and remaining limits are in `UI_AUDIT.md`; physical assumptions are in `models/BUCK.md`.

Final browser check: switching between the new DC document and buck restored each matching run; a full reload restored the buck and its results. The final millisecond shows the 10 kHz output ripple with Fit Y enabled. No browser script errors were recorded in the final check.

## Open-source preparation — 2026-09-13

- Reworked README and architecture to distinguish the implemented JSON authoring contract, local persistence, engine jobs, and single-block C export from future round trips, hierarchy, remote execution, and HDL. Added setup, user, API, model-format, execution, testing, troubleshooting, contributor, security, community, release, and agent task guides. Added DC example notes alongside FOC and buck.
- Added root and scoped agent instructions, contribution/issue templates, a read-only core CI workflow, and a manually dispatched OpenModelica workflow. CI configuration was parsed locally; no hosted run or public repository is claimed. The existing full-repository lint backlog is explicitly advisory.
- Retained complete upstream notices for the React Flow observer snippets, shadcn UI material, and Lucide/Feather icons. Documented the distinct compiler/runtime/MSL licenses and source-versus-binary distribution scope. Gradara's original-code license and public reporting contacts remain pending owner decisions.
- A limited hygiene scan checked 221 repository candidate paths and 164 unique blobs across the two reachable commits without credential/private-path findings. Confirmed local models, logs, environments, and outputs are ignored. This is not a comprehensive secret, dependency, or license audit. Relative file links passed across 33 Markdown files; negative probes confirmed broken links and a synthetic token are rejected without printing the token.
- Built a fresh source copy outside the working installation, excluding ignored local data. Python 3.12.8 dependency installation and 31 backend unit tests passed, with five engine integration tests deliberately deselected for this documentation/build-tool pass. Node 22.14.0 locked installation, typecheck, all 141 frontend tests, and the production web build passed. Existing bundle-size and experimental Node glob warnings remain.
- Fresh npm audit initially found four high findings through the same vulnerable Sharp dependency in Cloudflare build tooling. Updated the Cloudflare Vite plugin to 1.54.8, Wrangler to 4.131.1, and their compatible worker/type dependencies, resolving Sharp to 0.35.4. Reinstalled from the updated lockfile and verified zero npm audit findings. See the [upstream advisory](https://github.com/advisories/GHSA-rgj7-g3m4-5g8c). No engine or application behavior was changed for this update.
- Applied the verified dependency update to the working installation. The UI and local API still respond, a real-browser reload restores the saved buck and its completed result, the Last 1 ms/Fit Y view is restored, and the browser error log is empty. Personal models and prior uncommitted development remain intact.
- `check-repo.py --release` correctly reports the missing original-code license file/metadata until the owner chooses a license. No commit, push, public publication, or history rewrite was performed.
