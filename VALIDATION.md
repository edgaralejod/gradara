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
