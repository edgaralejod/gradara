import { createContext } from 'react';

/**
 * Tags on the open sheet: the blocks linked to the selected tag block (a Goto's From
 * blocks, a From's Goto and the other From blocks, a label's labels), drawn highlighted,
 * and the hover action that adds a From for a Goto or another label for a label.
 */
export const TagCanvasContext = createContext<{
  linked: ReadonlySet<string>;
  addPartner: (blockId: string) => void;
} | null>(null);
