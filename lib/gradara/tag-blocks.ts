// SPDX-License-Identifier: Apache-2.0
import type { Definition, Domain, Port } from './model';

/**
 * Goto, From and connection labels: wireless connections by tag (server/tags.py does the
 * joining). A Goto takes a signal and every From with its tag on the same sheet, or
 * inside a subsystem below it, gives that signal back. A connection label joins every
 * physical terminal wired to a label with its tag, on its sheet and in subsystems below.
 * A tag never reaches up out of a subsystem.
 */
export const TAG_KINDS = {
  goto: 'input',
  from: 'output',
  connectionLabel: 'physical',
} as const;
export type TagKind = keyof typeof TAG_KINDS;
export const isTagKind = (kind: string): kind is TagKind => kind in TAG_KINDS;

/** Letters, digits and _, starting with a letter: what the service accepts. */
export const TAG_PATTERN = /^[A-Za-z][A-Za-z0-9_]{0,31}$/;

const PHYSICAL_DOMAINS: Domain[] = [
  'electrical',
  'mechanical',
  'translational',
  'thermal',
  'magnetic',
  'threePhase',
];
/** Domains a tag block can take, like a subsystem port. */
export const tagDomains = (kind: TagKind): Domain[] =>
  kind === 'connectionLabel' ? PHYSICAL_DOMAINS : ['signal', 'boolean'];

export function tagDefinition(
  kind: TagKind,
  tag: string,
  domain: Domain,
): Definition {
  const port: Port =
    kind === 'goto'
      ? { id: 'u', name: 'u', direction: 'input', domain, side: 'left' }
      : kind === 'from'
        ? { id: 'y', name: 'y', direction: 'output', domain, side: 'right' }
        : { id: 'p', name: 'p', direction: 'physical', domain, side: 'left' };
  return {
    kind,
    name: kind === 'goto' ? 'Goto' : kind === 'from' ? 'From' : 'Label',
    description:
      kind === 'goto'
        ? 'Sends a signal to every From block with the same tag on this sheet and inside the subsystems on it, without a wire. A Goto inside a subsystem is not seen outside it.'
        : kind === 'from'
          ? 'Gives back the signal of the Goto with the same tag on this sheet, or on the nearest sheet above it.'
          : 'Joins every physical terminal wired to a label with the same tag, on this sheet and inside the subsystems on it, as one node, without a wire.',
    domain,
    symbol: tag,
    tag,
    ports: [port],
    parameters: [],
    equations: '',
    category: 'routing',
    keywords:
      kind === 'connectionLabel'
        ? ['tag', 'label', 'net', 'node', 'connection', 'wireless', 'physical']
        : ['tag', kind, 'goto', 'from', 'wireless', 'signal'],
  };
}

export const tagBlocks: Definition[] = [
  tagDefinition('goto', 'A', 'signal'),
  tagDefinition('from', 'A', 'signal'),
  tagDefinition('connectionLabel', 'N', 'electrical'),
];
