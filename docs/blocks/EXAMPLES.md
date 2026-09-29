# Block examples

Every library block has a small runnable model that shows it at work. A block's Help opens it (**Open example**), **Examples** lists them under **Block examples**, and each block's page on gradara.app shows its diagram. They double as tests: each one is simulated in CI and must produce the results its spec states, and each one must be drawn in house style.

## Where they live

| What | Where |
| --- | --- |
| Specs, by area | `scripts/block-examples/` (`signals.ts`, `logic.ts`, `control.ts`, `electrical.ts`, `circuits.ts`, `power.ts`, `converters.ts`, `physical.ts`) |
| Builder | `scripts/build-block-examples.tsx` (`npm run examples:blocks`) |
| Built models and manifest | `models/examples/blocks/<id>.json`, `models/examples/blocks/index.json` |
| Lookup for the workbench | `lib/gradara/block-examples.ts` (`exampleForKind`) |
| Diagram drawing (site pages and review) | `scripts/example-diagram.tsx` |
| House-style test | `tests/block-examples.test.ts` |
| Simulation test | `tests/test_block_examples.py` (integration) |

## A spec

Each example is an `ExampleSpec` (`scripts/block-examples/types.ts`):

- **Blocks** with their centers on the sheet. Centers on multiples of 8 keep blocks on the grid, and two-terminal parts on one row get straight wires. Options rotate a block, move its name beside or above it, or move a port to another side.
- **Links** as `block.port` pairs. The builder connects them with the workbench's own rules and saves the document through `normalizeProject`, so the router draws the wires and junctions exactly as the canvas would.
- **Plots** that open with the model, **about** (the blocks this example teaches; a block's Help opens the example about it), and a description that says what to look for in Results.
- **Checks**: results the simulation must produce, each with the reason (`why`). A check reads a block output (`block.port`) or a raw Modelica variable (`=c1.v`) at a time, as a time average over an interval (`mean`), or within bounds over the run (`min`, `max`). Derive every expected value from the physics, not from a previous run, and give tolerances that a correct model meets with room to spare.

## Adding or changing one

1. Edit the spec, or add one to the area file and to `scripts/block-examples/index.ts`. Instance ids must not be Modelica keywords (`in`, `and`, `flow`, `constant`, …); the builder refuses them.
2. Run `npm run examples:blocks`. With `--review <dir>` it also writes `examples.html` there, a sheet of every diagram to look at.
3. Run `npx tsx --test tests/block-examples.test.ts`. It fails when a block overlaps another, a name overlaps a block or another name, a wire crosses a block or a name, a wire runs diagonally or along a wire of another net, a block is off the grid or not at its standard size, a sheet exceeds 2000 × 1200, or a library block has no example.
4. Run the simulation checks: `.venv/bin/python -m pytest -q -m integration tests/test_block_examples.py -k <id>`.
5. Run `npm run docs:blocks` so the block pages show the new diagram.

`npm run examples:blocks -- --check` fails in CI when the built files are stale. Blocks without an example, and why, are listed in `UNEXAMPLED` in `lib/gradara/block-examples.ts`.
