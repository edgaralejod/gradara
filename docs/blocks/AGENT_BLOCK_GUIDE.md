# Creating a Gradara block

Read [the block design contract](DESIGN.md) before adding or changing block presentation. This applies to built-in catalog entries and agent-generated equation blocks.

## Equation-generation agents

Return a `Definition`, not JSX, CSS, an SVG string, or a pixel layout. Gradara chooses the standard dimensions, typography, outline, and domain colors. A definition contains behavior and human-readable metadata:

```json
{
  "kind": "softLimit",
  "name": "Soft limit",
  "description": "Smoothly limits the input to the configured amplitude.",
  "domain": "signal",
  "symbol": "tanh",
  "ports": [
    { "id": "u", "name": "u", "direction": "input", "domain": "signal" },
    { "id": "y", "name": "y", "direction": "output", "domain": "signal" }
  ],
  "parameters": [{ "id": "limit", "name": "Amplitude", "value": 1, "unit": "" }],
  "declarations": "",
  "equations": "y = limit * tanh(u / max(limit, 1e-9));",
  "controller": false
}
```

Use a short block name, usually 1–3 words; don't invent an instance suffix (`1`, `2`, etc.). The model allocates unique names. Use a recognizable 1–6 character symbol when possible, with 12 characters as the limit. It is not the full equation or a repeat of the name.

Generated definitions pass through `server/block_style.py` before their compile check. It removes instance suffixes, puts signal inputs on the left and outputs on the right (one feedback input may enter from the bottom), gives a two-terminal physical element opposite terminals, and never moves an existing terminal on revision. A name longer than four words or 28 characters, a symbol longer than 12 characters, or a new terminal caption longer than 8 characters is sent back to the generator to fix.

Keep visible terminal names to roughly 1–5 characters. Use meaningful names for multiple inputs; put longer explanations and units in metadata. Preserve existing port and parameter IDs when revising a block unless the interface truly changes. Never replace solver connectivity with a visual connection or guess execution order. The in-app generator supports signal blocks and physical electrical, rotational mechanical, translational mechanical, magnetic, thermal, and multidomain blocks. The user-selected type is mandatory: never substitute signal ports for physical terminals. Electrical terminals use `direction: physical`, `domain: electrical`, and `.v` / `.i`; rotational terminals use `.phi` / `.tau`; translational terminals use `.s` / `.f`; thermal terminals use `.T` / `.Q_flow`; magnetic terminals use `.V_m` / `.Phi`. Flow variables are positive into the component. Generated input/output ports must have the signal domain; Boolean and three-phase ports, MSL wrappers, and subsystems are not generated. Choose a `side` for every port. Multidomain blocks require at least two physical domains. Refinement must preserve existing port IDs, domains, and directions. Generated physical blocks use their bounded equations and standard Modelica connectors directly; no per-kind wrapper is needed. Verify conservation equations in a connected simulation, beyond the initial compiler check.

## Repository agents adding built-in blocks

1. If a Modelica Standard Library 4.1.0 class already implements the behavior, wrap it (see [below](#wrap-a-modelica-standard-library-class)); this is the usual path for physical, logic, and machine blocks. Otherwise add the definition in `model.ts`, `control-blocks.ts`, `power-blocks.ts`, or `extra-blocks.ts`, and give it a useful catalog category (`lib/gradara/catalog.ts` lists them), description, and search keywords. Keep IDs stable. For a physical kind without a library class, implement its canonical component wrapper in `server/modelica.py` and verify a real connected OpenModelica circuit; display equations alone do not implement the solver component.
2. Start with the inherited 80 × 64 body. Review `defaultBlockSize()` before introducing an exception. More ports should trigger shared size calculations; unusual notation may justify a documented wide variant.
3. Prefer an existing notation family. If a new symbol is needed, add it to `BlockSymbol`; `BlockFace` owns the body outline and captions. Never duplicate an icon for the library.
4. Keep normal text at 14 px. Don't shrink text, change the block font, or inject per-block CSS to make a dense block fit. Simplify its symbol or give it the proper body family. Never rasterize diagram notation.
5. Use the existing port geometry helpers and domain colors. Verify each visible terminal and its wiring hit target agree, especially top/bottom and mixed-domain ports. Preserve full accessible labels and pointer ownership.
6. Open `/block-catalog`, filter to the new block, and review its full-size drawing and library thumbnail. Check 100% and 200% zoom, minimum/default/enlarged sizes in the actual canvas, plus a neighboring source–operator–sink chain. Verify captions, fractions, signs, and lead continuity. Check narrow library widths and long names/large parameter values.
7. Run `npm run report:blocks` to inspect the ignored local inventory. Run `npm run typecheck` and the existing frontend tests for any geometry/insertion changes. Use focused numerical validation if behavior changes; a visual-only edit should not require a new solver.

A block is ready when it is recognizable at normal zoom, contributes to a quiet diagram, has no overlapping notation or captions, and behaves through the same selection, wiring, resizing, naming, and history mechanisms as every other block. Record a remaining limitation explicitly instead of implying an icon makes a placeholder simulation feature complete.

### Wrap a Modelica Standard Library class

Wrapper blocks live in `lib/gradara/msl-blocks.ts`, which is generated. Do not edit it by hand.

1. Check that the class is in `server/msl_index.json`. The index covers non-partial models and blocks in the Analog, Polyphase, Machines, PowerConverters, and Batteries electrical packages, Rotational and Translational mechanics, HeatTransfer, FluxTubes, and Blocks. To add a package, extend `PACKAGES` in `scripts/msl-index.py` and rebuild the index ([setup](../development/SETUP.md#regenerate-the-msl-library)).
2. Add one `B(...)` entry to `scripts/msl-blocks.py` in the section for its domain: kind, name, class, symbol, category, description, and parameters with `P(id, name, value, unit, min, …)`. A parameter maps to the MSL parameter of the same name; pass `modifier='other'` to map it elsewhere, including a record field such as `cellData.Qnom`, or put an expression in `modifiers` (for example `{'cellData.Qnom': 'Q*3600'}`). Terminal domains and directions come from the index. Use `sides` and `names` for placement and captions, `exclude` to drop a connector, `include` or a `use…` modifier set to `true` to enable a conditional connector, and `ports` to list every block port explicitly when some map onto vector elements, such as `{'plug_p': 'plug_p', 'plug_n': 'plug_n', 'ia': 'i[1]'}`. `modifier=''` keeps a parameter out of the modifiers when only an expression uses it.
3. Run `python3 scripts/msl-blocks.py > lib/gradara/msl-blocks.ts`. The script refuses a class, parameter, or connector that is not in the index. `tests/test_msl.py` fails when the generated file is stale and checks every wrapper with `server/msl.py`.
4. Run the block through the engine: `.venv/bin/python -m pytest -q -m integration tests/test_msl_engine.py -k <kind>`. `tests/test_msl_engine.py` places every wrapper block in a harness (constant inputs, each physical terminal tied to its domain's reference through a lossy element) and requires a completed run. A block that needs a working circuit to be well posed gets its own entry in `CIRCUITS`. For new physics, add a check with engineering meaning, like the spring-mass, heat capacitor, and inverting amplifier tests there.
5. Review the drawing in `/block-catalog` as in step 6 above. Most wrapper blocks use the generic body and captions; add a `BlockSymbol` only when a familiar symbol exists.

## Subsystems are not blocks to author

Subsystem instances, port pills, and variants are built by the workbench from the document (see the [model format](../architecture/MODEL_FORMAT.md#subsystems-and-variants)). Do not add a library definition that sets `subsystem` or `boundary`. The library's **Subsystem** entry and the three port entries in `lib/gradara/port-blocks.ts` are the only ways in.

## When building a complete model

The full-model orchestrator inventories existing definitions before asking for missing blocks. Prefer catalog reuse and parameter overrides to new definitions. Missing physical behavior must use the correct typed component creator; do not represent a two-terminal electrical element as a scalar signal block. Generate reusable constitutive behavior, not a monolithic block containing the entire requested circuit.

Assembly begins only after missing definitions are checked and archived. Reference the supplied immutable catalog IDs and exact port/parameter IDs. Do not redefine equations during assembly. Connect all required scalar inputs, include physical references, and use sensors for physical measurements. Give instances readable names, distinct layout cells, left-to-right signal flow, and explicit assumptions. A complete simulation is required before the draft is presented. Keep unsupported domains and unresolved diagnostics visible; do not invent connector types or silently substitute a different physical domain.
