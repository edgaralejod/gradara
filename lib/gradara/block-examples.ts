// SPDX-License-Identifier: Apache-2.0
/**
 * Block examples: small runnable models that show library blocks at work
 * (models/examples/blocks/, built by scripts/build-block-examples.tsx). A block's Help
 * opens the example about it; tests prove every example simulates to the results its
 * manifest states and is drawn in house style.
 */
import manifest from '../../models/examples/blocks/index.json';

export type BlockExample = {
  id: string;
  title: string;
  area: string;
  summary: string;
  /** The blocks this example is about. */
  about: string[];
  /** Every block kind it uses. */
  kinds: string[];
};

export const blockExamples: BlockExample[] = manifest.examples;

/** Library blocks with no example, and why. */
export const UNEXAMPLED: Record<string, string> = {};

/** Palette entries that become another kind when placed. */
const PLACED_AS: Record<string, string> = { emptySubsystem: 'subsystem' };

export type ExampleLink = {
  /** The template id the workbench creates a model from. */
  template: string;
  title: string;
};

/**
 * The example to open for a block: the block example about it, else the first block
 * example that uses it, else a curated example that uses it.
 */
export function exampleForKind(kind: string): ExampleLink | undefined {
  const about = blockExamples.find((e) => e.about.includes(kind));
  const placed = PLACED_AS[kind] ?? kind;
  const uses = about ?? blockExamples.find((e) => e.kinds.includes(placed));
  if (uses) return { template: `block-${uses.id}`, title: uses.title };
  const curated = manifest.showcase.find((e) => e.kinds.includes(placed));
  return curated && { template: curated.id, title: curated.title };
}
