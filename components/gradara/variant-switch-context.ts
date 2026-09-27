import { createContext } from 'react';

/** Switches a subsystem instance on the open sheet to one of its variants. */
export const VariantSwitchContext = createContext<
  ((blockId: string, variantId: string) => void) | null
>(null);
