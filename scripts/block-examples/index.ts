import { circuits } from './circuits';
import { control } from './control';
import { converters } from './converters';
import { electrical } from './electrical';
import { logic } from './logic';
import { physical } from './physical';
import { power } from './power';
import { signals } from './signals';
import type { ExampleSpec } from './types';

export type { ExampleCheck, ExampleSpec } from './types';

/** In the order the workbench lists them. */
export const examples: ExampleSpec[] = [
  ...signals,
  ...logic,
  ...control,
  ...electrical,
  ...circuits,
  ...power,
  ...converters,
  ...physical,
];
