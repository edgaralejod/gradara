// SPDX-License-Identifier: Apache-2.0
import { domainLabels, type Block, type Definition, type Port } from './model';
import { isBusBlock } from './buses';
import { isTagKind } from './tag-blocks';

/**
 * Which sections the properties panel shows for a block, so a section never sits
 * empty or offers an action the block does not have.
 */

/** A library block whose equations are only the comment naming its Modelica class. */
export const modelicaClassOnly = (d: Definition) =>
  !!d.modelica?.class &&
  d.equations
    .split('\n')
    .every((line) => !line.trim() || line.trim().startsWith('//'));

/**
 * Equations to read or write: a block defined by equations (or one whose equations
 * can be written). A subsystem is defined by its inside, a tag or port pill by the
 * connections it makes, a bus by its Signals; none has an Equations section.
 */
export const hasEquations = (block: Block) => {
  const d = block.definition;
  if (d.subsystem || d.boundary || isTagKind(d.kind) || isBusBlock(d))
    return false;
  if (modelicaClassOnly(d)) return false;
  return (
    !!d.equations.trim() ||
    !!d.declarations?.trim() ||
    (d.domain === 'signal' && !d.modelica)
  );
};

/** A Modelica class path broken only after its dots when it wraps. */
export const breakAtDots = (path: string) =>
  path.split('.').flatMap((part, i, all) =>
    i < all.length - 1 ? [`${part}.`, '​'] : [part],
  ).join('');

/** What a port carries, as the Interface list shows it: "electrical", "input", "Boolean output". */
export const portKindLabel = (p: Port) =>
  p.direction === 'physical'
    ? domainLabels[p.domain]
    : p.domain === 'boolean'
      ? `Boolean ${p.direction}`
      : p.direction;
