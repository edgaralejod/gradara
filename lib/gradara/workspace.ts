import type { Project } from './model';
export const modelTemplates = [
  {
    id: 'blank',
    title: 'Blank model',
    name: 'Untitled model',
    description:
      'Start with an empty canvas. Add blocks from the library or ask the agent.',
    detail: 'Your model, from scratch',
  },
  {
    id: 'dc',
    title: 'DC motor',
    name: 'DC motor control',
    description:
      'Speed control with a PI controller, electrical dynamics, and a mechanical load.',
    detail: 'Control · Electrical · Mechanical',
  },
  {
    id: 'foc',
    title: 'AC motor · FOC',
    name: 'FOC motor control',
    description:
      'Cascaded speed and current control of a permanent-magnet motor.',
    detail: 'Control · Electrical · Mechanical',
  },
  {
    id: 'buck',
    title: 'Buck converter',
    name: 'Buck converter',
    description:
      '24 V to 12 V with complementary ideal switches and an LC output filter.',
    detail: 'Power electronics · 10 kHz PWM',
  },
] as const;
export type TemplateId = (typeof modelTemplates)[number]['id'];
export function blankProject(name = 'Untitled model'): Project {
  return {
    version: 1,
    name,
    duration: 1,
    revision: 0,
    blocks: [],
    wires: [],
    junctions: [],
    nets: [],
    annotations: [],
    plots: [],
    description: '',
  };
}
