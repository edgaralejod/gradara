# Workbench components

The root [AGENTS.md](../../AGENTS.md) applies. These components render and interact with model data; they do not define numerical execution order.

- Reuse `BlockFace` and shared port geometry for canvas and library visuals. Read the block design contract before changing sizes, text, symbols, or pin positions.
- Keep transient pointer state local and frame-batched. Commit completed gestures through normal model operations/history, including label movement, resize, reconnect, and duplication.
- Coordinate drawing, selection, pan, text editing, and dragging so one gesture has one owner. Do not allow canvas shortcuts to consume input/editor keystrokes.
- Preserve measurable React Flow node dimensions. The pinned observer patch is intentional; never hide ResizeObserver or unhandled script errors.
- Use semantic controls and visible focus. Test narrow layouts and the actual browser behavior, not only static screenshots.
- Keep backend/proxy/provider calls outside rendering and pointer movement. Results and inspector work should not force full-canvas recomputation per drag event.
