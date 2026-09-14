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

Keep visible terminal names to roughly 1–5 characters. Use meaningful names for multiple inputs; put longer explanations and units in metadata. Preserve existing port and parameter IDs when revising a block unless the interface truly changes. Never replace solver connectivity with a visual connection or guess execution order. The in-app generator currently supports scalar signal input/output blocks; adding physical connectors requires an explicit schema/compiler extension.

## Repository agents adding built-in blocks

1. Add the definition in `model.ts`, `control-blocks.ts`, `power-blocks.ts`, or `extra-blocks.ts`, and give it a useful catalog category, description, and search keywords. Keep IDs stable. For a physical kind, implement its canonical component wrapper in `server/modelica.py` and verify a real connected OpenModelica circuit; display equations alone do not implement the solver component.
2. Start with the inherited 80 × 64 body. Review `defaultBlockSize()` before introducing an exception. More ports should trigger shared size calculations; unusual notation may justify a documented wide variant.
3. Prefer an existing notation family. If a new symbol is needed, add it to `BlockSymbol`; `BlockFace` owns the body outline and captions. Never duplicate an icon for the library.
4. Keep normal text at 14 px. Don't shrink text, change the block font, or inject per-block CSS to make a dense block fit. Simplify its symbol or give it the proper body family. Never rasterize diagram notation.
5. Use the existing port geometry helpers and domain colors. Verify each visible terminal and its wiring hit target agree, especially top/bottom and mixed-domain ports. Preserve full accessible labels and pointer ownership.
6. Open `/block-catalog`, filter to the new block, and review its full-size drawing and library thumbnail. Check 100% and 200% zoom, minimum/default/enlarged sizes in the actual canvas, plus a neighboring source–operator–sink chain. Verify captions, fractions, signs, and lead continuity. Check narrow library widths and long names/large parameter values.
7. Run `npm run report:blocks` to inspect the ignored local inventory. Run `npm run typecheck` and the existing frontend tests for any geometry/insertion changes. Use focused numerical validation if behavior changes; a visual-only edit should not require a new solver.

A block is ready when it is recognizable at normal zoom, contributes to a quiet diagram, has no overlapping notation or captions, and behaves through the same selection, wiring, resizing, naming, and history mechanisms as every other block. Record a remaining limitation explicitly instead of implying an icon makes a placeholder simulation feature complete.
