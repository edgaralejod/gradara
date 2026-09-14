import { createContext } from 'react';
import type { Block } from '@/lib/gradara/model';

export const LabelEditingContext = createContext<{
  onMove: (id: string, offset: Block['labelOffset']) => void;
  onSelect: (id: string) => void;
} | null>(null);
