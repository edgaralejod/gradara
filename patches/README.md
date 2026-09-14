# React Flow observer scheduling patch

The two observer snippets derive from `@xyflow/react` **12.11.6**, copyright (c) 2019–2025 webkid GmbH, under the [MIT license](../LICENSES/xyflow-MIT.txt).

`react-flow-observer.before.txt` records the upstream fragment. `react-flow-observer.after.txt` is the Gradara modification: batch node measurements into an animation frame and cancel pending work during cleanup. This avoids publishing React Flow store updates within ResizeObserver delivery. It preserves node initialization and does not hide browser errors.

[scripts/patch-react-flow.mjs](../scripts/patch-react-flow.mjs) checks the exact package version and expected source before modifying both installed ESM exports (`index.js` and `index.mjs`). It is idempotent and runs during `npm ci`/install. The CommonJS/UMD build is not patched or consumed by this workbench.

When upgrading React Flow, inspect the upstream observer implementation first. Determine whether the patch is still needed, update the version/source check deliberately, and verify resize, fit, dragging, port geometry, and unmount/remount behavior in a real browser. Retain attribution if the snippets remain. Do not remove the guard merely to make installation pass.
