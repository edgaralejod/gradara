// SPDX-License-Identifier: Apache-2.0
import type { Block, Project } from './model';
import { blockSize } from './canvas';
import { defaultBlockSize, snapBlockPosition } from './block-design';
import { portPlacement } from './ports';
import { isTagKind, tagDefinition, TAG_PATTERN } from './tag-blocks';

/** A tag block with a new tag: its face grows or shrinks with the tag, about its center. */
export function retagged(block: Block, tag: string): Block {
  const definition = { ...block.definition, tag, symbol: tag };
  const old = blockSize(block);
  const standard = defaultBlockSize(definition);
  const turned = (block.rotation ?? 0) % 180 !== 0;
  const size = turned
    ? { width: standard.height, height: standard.width }
    : standard;
  return {
    ...block,
    definition,
    size,
    position: snapBlockPosition(
      {
        x: block.position.x + (old.width - size.width) / 2,
        y: block.position.y + (old.height - size.height) / 2,
      },
      size,
    ),
  };
}

/** Set the tag of one tag block; `project` itself when nothing changes or the tag is invalid. */
export function setTag(project: Project, id: string, tag: string): Project {
  const block = project.blocks.find((b) => b.id === id);
  if (
    !block ||
    !isTagKind(block.definition.kind) ||
    !TAG_PATTERN.test(tag) ||
    block.definition.tag === tag
  )
    return project;
  return {
    ...project,
    blocks: project.blocks.map((b) => (b.id === id ? retagged(b, tag) : b)),
  };
}

/** The first of `base`, `base1`, `base2`, … (trailing digits of `base` dropped) not in `taken`. */
export function freeTag(base: string, taken: Set<string>) {
  const stem = base.replace(/\d+$/, '') || 'A';
  for (let n = 1; ; n++) {
    const tag = `${stem}${n}`.slice(0, 32);
    if (!taken.has(tag)) return tag;
  }
}

/**
 * Pasted or duplicated blocks never make a second Goto with a tag already on the sheet:
 * such a Goto gets the next free tag, and the From blocks pasted with it follow, so a
 * copied pair stays a pair. A From pasted without its Goto keeps its tag and reads the
 * Goto it read before. Labels keep their tags: joining the same node is their point.
 */
export function freshPastedTags(existing: Block[], pasted: Block[]): Block[] {
  const gotos = new Set(
    existing
      .filter((b) => b.definition.kind === 'goto' && b.definition.tag)
      .map((b) => b.definition.tag!),
  );
  const renamed = new Map<string, string>();
  for (const b of pasted)
    if (b.definition.kind === 'goto' && b.definition.tag) {
      const tag = b.definition.tag;
      if (gotos.has(tag)) renamed.set(tag, freeTag(tag, gotos));
      gotos.add(renamed.get(tag) ?? tag);
    }
  if (!renamed.size) return pasted;
  return pasted.map((b) =>
    (b.definition.kind === 'goto' || b.definition.kind === 'from') &&
    b.definition.tag &&
    renamed.has(b.definition.tag)
      ? retagged(b, renamed.get(b.definition.tag)!)
      : b,
  );
}

/** What a tag block's quick action makes: a From for a Goto, another label for a label. */
export const partnerKind = (kind: string) =>
  kind === 'goto' ? 'from' : kind === 'connectionLabel' ? kind : undefined;

const GAP = 64;

/**
 * A From (for a Goto) or a label (for a label) with the same tag and kind of value,
 * placed past the block's open end, moved down until it overlaps nothing: Simulink's
 * hover action on a Goto. Returns the new block's ID.
 */
export function addPartner(
  project: Project,
  id: string,
): { project: Project; id: string } | undefined {
  const block = project.blocks.find((b) => b.id === id);
  const kind = block && partnerKind(block.definition.kind);
  if (!block || !kind || !block.definition.tag) return undefined;
  const d = block.definition;
  const port = d.ports[0];
  const definition = {
    ...tagDefinition(kind as 'from' | 'connectionLabel', d.tag!, port.domain),
    name: kind === 'from' ? 'From' : 'Label',
  };
  const size = defaultBlockSize(definition);
  const here = blockSize(block);
  // Past the end away from the block's terminal: the way the flag points.
  const side = portPlacement(d, port, block.rotation, here, block.flip).side;
  const right = side !== 'right';
  const at = {
    x: right
      ? block.position.x + here.width + GAP
      : block.position.x - GAP - size.width,
    y: block.position.y + here.height / 2 - size.height / 2,
  };
  const overlaps = (x: number, y: number) =>
    project.blocks.some((b) => {
      const s = blockSize(b);
      return (
        x < b.position.x + s.width + 8 &&
        x + size.width + 8 > b.position.x &&
        y < b.position.y + s.height + 8 &&
        y + size.height + 8 > b.position.y
      );
    });
  while (overlaps(at.x, at.y)) at.y += 48;
  const ident = `b_${crypto.randomUUID().replaceAll('-', '').slice(0, 12)}`;
  const created: Block = {
    id: ident,
    definition,
    position: snapBlockPosition(at, size),
    size,
  };
  return {
    project: { ...project, blocks: [...project.blocks, created] },
    id: ident,
  };
}
