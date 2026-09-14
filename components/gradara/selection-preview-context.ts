'use client';
import { createContext } from 'react';
import type { Project } from '@/lib/gradara/model';
import type { ModelSelection } from '@/lib/gradara/selection';

export type SelectionPreview = { project: Project; selection: ModelSelection };
export const SelectionPreviewContext = createContext<SelectionPreview | null>(
  null,
);
