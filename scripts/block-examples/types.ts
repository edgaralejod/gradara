import type { Project } from '../../lib/gradara/model';

/**
 * A result the example must produce, checked by tests/test_block_examples.py after a
 * real simulation. `signal` is a block output (`block.port`) or, after `=`, a raw
 * Modelica variable (`=c1.v`). With `value`, the signal at `at` (default: the end)
 * must be within `tol` (absolute) of it; with `min`/`max`, every sample (or the one
 * at `at`) must be within the bounds. `why` says where the number comes from.
 */
export type ExampleCheck = {
  signal: string;
  at?: number;
  mean?: [number, number];
  value?: number;
  tol?: number;
  min?: number;
  max?: number;
  why: string;
};

export type ExampleArea =
  | 'Signals'
  | 'Logic'
  | 'Control'
  | 'Electrical'
  | 'Semiconductors'
  | 'Converters'
  | 'Machines'
  | '3-phase'
  | 'Mechanical'
  | 'Thermal'
  | 'Magnetic';

export type Rotation = 90 | 180 | 270;
export type BlockOptions = {
  rotation?: Rotation;
  /** Where the name goes; a pair moves it from its place under the block. */
  label?: 'left' | 'right' | 'above' | [number, number];
  /** Move ports to another side, optionally at an offset (percent along it). */
  ports?: Record<string, Side | [Side, number]>;
  /**
   * Bus blocks: a number of signal ports (Mux inputs, Demux outputs), Bus Creator
   * input names, or the names a Bus Selector picks.
   */
  signals?: number | string[];
};
export type Side = 'left' | 'right' | 'top' | 'bottom';

export type ExampleSpec = {
  id: string;
  title: string;
  area: ExampleArea;
  /** One sentence: what the example shows. */
  summary: string;
  /** What the model is and what to look at in Results. */
  description: string;
  duration: number;
  /**
   * [instance id, library kind, instance name, center [x, y] on the sheet, parameter
   * overrides, options]. Centers on multiples of 8 keep blocks on the sheet grid;
   * two-terminal parts on the same row then get straight wires. Options turn the
   * block (a number is a rotation) or move its name beside or above it.
   */
  blocks: [
    string,
    string,
    string,
    [number, number],
    Record<string, number>?,
    (Rotation | BlockOptions)?,
  ][];
  /** Connections as `block.port` pairs; physical terminals may branch. */
  links: [string, string][];
  plots: { label: string; series: string[]; labels?: string[] }[];
  checks: ExampleCheck[];
  /** The kinds this example teaches: a block's Help opens the example about it. */
  about: string[];
  /** A last step on the laid-out document (grouping into a subsystem, say). */
  finish?: (doc: Project) => Project;
};
