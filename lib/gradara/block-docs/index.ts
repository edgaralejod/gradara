import type { BlockDoc } from './types';
import { docs as signal } from './signal';
import { docs as control } from './control';
import { docs as electrical } from './electrical';
import { docs as power } from './power';
import { docs as machinesThermal } from './machines-thermal';
import { docs as mechanical } from './mechanical';

export type { BlockDoc } from './types';

/** Reference documentation for every library block, by kind. */
export const blockDocs: Record<string, BlockDoc> = {
  ...signal,
  ...control,
  ...electrical,
  ...power,
  ...machinesThermal,
  ...mechanical,
};
