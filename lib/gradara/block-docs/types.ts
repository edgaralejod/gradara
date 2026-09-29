/**
 * Reference documentation for one library block, in the spirit of a Simulink block
 * reference page. Structural facts (ports, parameters with units and defaults, the
 * Modelica class, which examples use the block) come from the definition itself; this
 * holds only what a person has to write. See lib/gradara/block-reference.ts.
 *
 * Plain text throughout: Unicode math (ω, τ, ², ·, ≤, √), no Markdown or HTML. A term in
 * backticks is shown as code.
 */
export type BlockDoc = {
  /** What the block does and when to use it: one to three short paragraphs. */
  description: string[];
  /** Port ID → what it carries: quantity, unit, sign or flow convention. Every port. */
  ports: Record<string, string>;
  /** Parameter ID → its meaning and valid range. Every parameter. */
  parameters?: Record<string, string>;
  /** The defining relations, one per line, in the block's own port and parameter names. */
  equations?: string[];
  /** Assumptions, idealizations, and what the block does not model. */
  limitations?: string[];
  /** Practical notes: typical wiring, pitfalls, related settings. */
  tips?: string[];
  /** Related block kinds, most useful first. */
  seeAlso?: string[];
};
