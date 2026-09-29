import { createContext } from 'react';
import type { Block } from '@/lib/gradara/model';

export const LabelEditingContext = createContext<{
  onMove: (id: string, offset: Block['labelOffset']) => void;
  onSelect: (id: string) => void;
  /** Rename the block; returns the name it got (names stay unique on a sheet). */
  onRename: (id: string, name: string) => void;
} | null>(null);
