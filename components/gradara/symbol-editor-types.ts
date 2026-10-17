import type { SymbolGlyph } from '@/lib/gradara/glyph';
import type { Block, Definition } from '@/lib/gradara/model';

/**
 * The contract between the workbench (app/page.tsx) and the symbol editor
 * (symbol-editor.tsx). The editor never touches the model itself: it hands back a
 * definition, and the workbench commits it as one undo step.
 */
export type SymbolEditorProps = {
  /** The block being edited, on the open sheet: its definition, size, rotation, flip. */
  block: Block;
  /**
   * The library's definition for a built-in block (the look Reset to standard
   * restores); absent for AI and other custom blocks.
   */
  standard?: Definition;
  /**
   * Apply the edited look to this block: the same definition with port `side` /
   * `offset` and `glyph` changed (a glyph of `undefined` means the standard look), and
   * the body size to give the block.
   */
  onApply: (definition: Definition, size: { width: number; height: number }) => void;
  /** For an AI block: also save the edited definition to Library → AI blocks (replacing its entry). */
  onSaveToLibrary?: (definition: Definition) => Promise<void>;
  /**
   * Ask the AI to draw the symbol for `definition` (its ports as currently laid out)
   * from a short description. Resolves to a drawing with an anchor for every port, or
   * rejects with a readable message. Absent when AI is not set up.
   */
  onAskAi?: (description: string, definition: Definition) => Promise<SymbolGlyph>;
  /** What one AI drawing costs, as the Ask bar shows it ("Gradara AI · 2 credits · 18 left"). */
  aiPrice?: string;
  onClose: () => void;
};
