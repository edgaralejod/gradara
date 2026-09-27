import type { Project } from './model';
export const modelTemplates = [
  {
    id: 'datacenter',
    title: 'Data center cooling',
    name: 'Data center cooling control',
    description:
      'Lumped rack and room temperatures, electrical cooling demand, and PI control under load and capacity disturbances.',
    detail: 'Electrical · Thermal · Control · 1 hour',
  },
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
    id: 'servo',
    title: 'Servo position',
    name: 'Servo position control',
    description:
      'Sampled PID position loop on a DC motor, built to export its controller to C.',
    detail: 'Control · Electrical · Mechanical · C export',
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
    id: 'ev',
    title: 'EV drivetrain',
    name: 'EV drivetrain',
    description:
      'Battery, averaged converter, motor, and vehicle in three levels of subsystems, with battery and motor variants.',
    detail: 'Subsystems · Variants · Electrical · Mechanical',
  },
  {
    id: 'buck',
    title: 'Buck converter',
    name: 'Buck converter',
    description:
      '24 V to 12 V with complementary ideal switches and an LC output filter.',
    detail: 'Power electronics · 10 kHz PWM',
  },
  {
    id: 'flyback',
    title: '480 VAC flyback',
    name: '480 VAC → 24 VDC flyback',
    description:
      'Bridge rectifier, magnetic energy storage, and 50 kHz switching with soft-start voltage regulation.',
    detail: '480 V RMS · 24 V / 1 A · switching model',
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
