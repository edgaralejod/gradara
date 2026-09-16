# Gradara block design contract

The diagram is a technical drawing. Identity comes from a recognizable symbol, clean terminals, and a short name. Keep whitespace calm, wires legible, and color tied to physical domains. Avoid card-style elevation, header bars, badges, and arbitrary fonts inside blocks. A subtle shared shadow on the outline adds relief without turning the symbol into a card.

## Shared dimensions and typography

At 100% canvas zoom, one diagram unit is one CSS pixel. The standard body is **80 × 64**. All normal diagram text—instance names, terminal captions, numeric values, operators, and fractions—uses **14 px / 18 px**, normal weight, using the shared `--font-ui` system font stack. UI and diagram labels must never choose independent font families. A fraction uses 19 px lines to leave space for its rule. Symbols drawn in SVG have their own viewBox coordinates, not independent UI font scales. Their final optical size should match the surrounding notation.

Enlarging a block changes the space around its symbol, not its text size. Zoom scales the complete diagram. Never use an observer or a font-shrink loop to squeeze content into a block.

| Family | Default body | Reason |
| --- | --- | --- |
| Standard | 80 × 64 | Sources, unary math, most dynamics, limits, sinks, controllers with one input |
| Gain | 80 × 64 | Same envelope, familiar triangle |
| Sum / subtract | 40 × 40 | Compact circular junction; input signs belong at their terminals |
| Multi-terminal | 128 × 96 or larger | A central symbol well plus independent terminal-caption gutters |
| Dense terminal arrays | Computed on an 8-unit grid | At least 24 units of vertical pitch; nominal 32-unit horizontal pitch |
| PMSM | 160 × 96 | Four bottom terminals plus top measurements and mixed-domain side terminals |
| Wide notation | 160 × 64 | Complete second-order transfer function at the normal font size |
| Mux / demux | 40 × 96 | Narrow tapered body; indexed terminals replace redundant internal text |
| Electrical primitive | 80 × 48 horizontal; 48 × 80 vertical | Unboxed circuit symbol; leads reach the exact terminal coordinates |
| Ground | 40 × 40 | Unboxed reference glyph with its lead at the top terminal |

These are deliberate semantic exceptions, not permission to invent dimensions for every new kind. `defaultBlockSize()` computes defaults and `minimumDesignedSize()` sets resizing limits. New registered or agent-created blocks inherit this system automatically. Generic signal blocks with one input and one output use the standard body; multiple or mixed-domain terminals reserve more room. Explicit unusual terminal offsets still need visual review for spacing.

## Symbols and captions

- `BlockFace` is the sole body renderer for the canvas, library, and catalog. `BlockSymbol` supplies only internal notation. Do not recreate outlines in a library-only component.
- Use a bounded SVG in a `60 × 44` viewBox for ordinary pictograms. The normal symbol well is capped at `48 × 40`. Use a `1.6` stroke, round caps/joins, no fill by default. Machine symbols use an `80 × 70` viewBox and the same optical envelope.
- Shadows use the shared `--block-shadow` token on the outline only; unboxed circuit glyphs use the lighter `--block-symbol-shadow`. Do not shadow text, ports, wires, or entire node containers. Shadows are omitted for printing and never affect geometry.
- Body outlines use a `1.4` stroke and a 2% domain tint. Rectangles have almost square corners. Preserve the established triangle, circle, and circuit conventions.
- Orient passive circuit glyphs from their physical terminal sides. Vertical source/switch/sensor symbols use a 48 × 80 viewBox; ground already has a top-facing lead and must not receive the passive-glyph quarter-turn. Keep signal gate/measurement stubs blue.
- Circuit primitives stretch only their circuit SVG, using non-scaling strokes. Their outer leads must touch the actual port locations. A wire must never appear disconnected from the glyph.
- Instance names are centered below the body with an 8-unit gap. They remain independently draggable. Names over 240 units ellipsize; the full value remains editable in the inspector. Do not force long names into the body.
- Ordinary unary blocks omit generic `u`, `y`, `in`, and `out` captions. Summing blocks always show input signs. Multiple outputs on one side (for example PWM `hi` / `lo`) retain their captions even when there are only two terminals. Multi-terminal and mixed-domain blocks show captions where they disambiguate ports. All ports retain their full accessible name and tooltip even when their caption is omitted or ellipsized.
- Prefer terminal captions of 1–5 characters: `ref`, `meas`, `θe`, `shaft`, `TL`. Longer identifiers can remain in the data model; explain them in descriptions. Long captions truncate in their gutter instead of covering the central notation.
- Numeric notation uses `formatBlockValue()` (four significant digits, scientific notation for very large/small values). This is display formatting only; parameter values retain full precision.
- Show useful mathematical notation, not full equations or repeated block names. A custom symbol is limited to 12 displayed characters with an ellipsis fallback; the complete equations belong in the inspector/editor.

## Domains and terminals

Retain the shared `domainColors`: signal blue, electrical ochre, mechanical teal, thermal coral. The body uses its owning domain. **Each terminal uses its own domain**, so an electrical machine can expose mechanical and signal terminals without ambiguity. Physical connection points retain their distinct square/cross affordance; signal terminals keep their existing wiring affordance. Color alone never replaces direction/domain metadata.

Rendering must use `portSide`/`portOffset` geometry also used by `portPoint`. Do not position a visual terminal independently from its hit target or routing endpoint. Keep `data-block-id`, `data-port-id`, accessible names, and native pointer ownership intact.

## Library and catalog

The compact library uses the same face, uniformly scaled to fit a 36 × 28 thumbnail envelope with no enlargement; other miniature specimens can use 56 × 42. The text next to that supplementary thumbnail uses the shared 12 px UI size at medium weight; descriptions appear in a fixed detail area for the hovered or keyboard-focused part. Rows are 40 px tall with single-line names; availability warnings remain visible. A category selector filters the list, and sticky group headings organize the all-categories view. Terminal captions are omitted at thumbnail scale except input signs on sums. The silhouette and glyph still come from the shared renderer. Simple thumbnail text has a 12 px optical size so it remains recognizable; long second-order notation uses the conventional `H(s)` shorthand. Fractions and pictograms scale with the specimen. These are thumbnail detail rules, not alternative canvas typography.

`/block-catalog` renders every definition at its actual standard dimensions, grouped by category, with optional compact library specimens. It supports source/category/search filters and 100%, 150%, and 200% zoom. The toolbar stays in place while the reference sheet scrolls; descriptions and domain markers remain visible. This is a visual review surface and never loads or changes a saved project. Do not judge a new block solely by its thumbnail.

## Placement alignment

New blocks and dragged blocks snap their horizontal centerline to the 20-unit placement grid, rather than snapping their top-left corner. This lets the standard 80 × 64 body, 40 × 40 Sum, and custom heights share a straight signal line. Connected-port alignment takes precedence on release; grouped blocks retain their relative spacing. Never change port geometry to compensate for placement.

## Saved layout compatibility

Old v1 blocks without an explicit `size` retain their legacy dimensions through `blockSize()`. Newly inserted blocks persist `defaultBlockSize(definition)`; pasted blocks keep the source size. This prevents a visual refresh from silently moving connection anchors in an existing model.

The inspector's **Use standard size** command deliberately applies the new dimensions using the ordinary, undoable layout transaction and connected-port snapping. Resizing and visual metadata do not affect numerical identity. Updating a default must never silently rewrite old models or reroute their saved wires.

## Where changes belong

- `lib/gradara/block-design.ts`: sizing, shape selection, caption visibility, bounded values.
- `components/gradara/block-face.tsx`: one outline/symbol/caption composition and preview adapter.
- `components/gradara/block-symbol.tsx`: internal mathematical and physical notation.
- `app/blocks.css`: authoritative typography, stroke, symbol, and library styling.
- `components/gradara/block-node.tsx`: canvas integration, resizer, interactive terminals, movable name.
- `lib/gradara/ports.ts`: shared terminal geometry and insertion alignment.
- [Block authoring guide](AGENT_BLOCK_GUIDE.md): procedure for agents and contributors.
- `npm run report:blocks`: generate a local inventory at `reports/block-catalog.md`. This report is excluded from Git.

Keep block styles in `blocks.css`; do not append competing rules to `globals.css` or `engineering.css`. `BlockFace` and its explicit selectors own block presentation.

## Workbench typography

`app/globals.css` owns the shared font families and size tokens. Use `--font-ui` for UI, block labels, and symbols; use `--font-code` for code and dense numerical readouts. Fonts are local system fonts, with no network dependency. The native face can differ across operating systems, but all surfaces within the app use the same stack.

- `--text-ui` (12 px): controls, library item names, ordinary workbench text.
- `--text-meta` (alias of 12 px UI): descriptions and secondary labels, distinguished by color.
- `--text-heading` (alias of 12 px UI): panel headings, distinguished by weight.
- `--text-title` (alias of 12 px UI): editable model and component titles, distinguished by weight.
- `--text-micro` (10 px): dense plot ticks, units, and status readouts only.

Use 400 for body text, 500 for emphasized rows, and 600 for headings. Avoid tightly tracked text, arbitrary fractional weights, and typography `!important` overrides. The 20 px wordmark and dialog titles are deliberate exceptions. Diagram text remains 14/18 in diagram units and scales only with canvas zoom; UI sizing does not change block dimensions or port geometry. Keep block/library rules in `blocks.css` and workbench rules in `engineering.css`.

Keep panel titles to one line of hierarchy: “Library,” not a kicker plus “Components.” Category labels use sentence case and normal tracking. Avoid decorative product subtitles in the toolbar. UI hierarchy comes from alignment, spacing, weight, and color rather than a different size for each role.

## Tool windows and transient surfaces

`app/workbench-dialogs.css` owns creator and dialog chrome. Keep title bars and action strips flat, borders subtle, corner radii at 2–3 px, and controls at the shared UI text size. Use compact lists for model/example choices rather than separate elevated cards. Keep descriptions subordinate and avoid decorative badges, gradients, large hero headings, or blurred modal backdrops. Dialog content must scroll within the viewport.

Text action buttons use content-based width and do not shrink. Only explicitly icon-only controls may have a fixed square width. Creator footers wrap their status text before their action buttons, and long suggestions wrap rather than overflowing narrow windows. Keep visible keyboard focus, disabled/busy states, errors, and existing interaction semantics.
