// SPDX-License-Identifier: Apache-2.0
import type { Diagnostic } from './api';
import type { Block, Project } from './model';
import { findSubsystem, scopeView } from './hierarchy';
import { isTagKind, TAG_PATTERN } from './tag-blocks';

/**
 * How tags resolve, for the workbench (the service joins them: server/tags.py). A From
 * finds the Goto with its tag on its own sheet or on the nearest sheet above it on the
 * open path; connection labels with one tag join on their sheet and with the labels on
 * the sheets above. Nothing is ever found below or beside: a tag reaches down only.
 */
type Sheet = { blocks: Block[] };

export const tagOf = (b: Block) =>
  isTagKind(b.definition.kind) ? (b.definition.tag ?? '') : undefined;

/** The sheets from the top down to `path` (a list of subsystem instance IDs). */
function sheetsOnPath(project: Project, path: string[]) {
  const out: { path: string[]; sheet: Sheet; name: string }[] = [
    { path: [], sheet: project, name: project.name },
  ];
  for (let i = 0; i < path.length; i++) {
    const instance = out[i].sheet.blocks.find((b) => b.id === path[i]);
    const ref = instance?.definition.subsystem?.ref;
    const sub = ref ? findSubsystem(project, ref) : undefined;
    if (!instance || !sub) break;
    out.push({
      path: path.slice(0, i + 1),
      sheet: sub,
      name: instance.definition.name,
    });
  }
  return out;
}

export type TagLink = { path: string[]; blockId: string; sheetName: string };

/**
 * Where a tag block on the sheet at `path` connects: for a From, the Goto it reads
 * (undefined when there is none); for a Goto or a label, every From or label it
 * reaches on this sheet, and on the sheets above it for a label.
 */
export function tagLinks(project: Project, path: string[], block: Block) {
  const tag = tagOf(block);
  const kind = block.definition.kind;
  if (!tag) return { source: undefined, peers: [] as TagLink[] };
  const chain = sheetsOnPath(project, path).reverse();
  const find = (sheet: Sheet, k: string) =>
    sheet.blocks.filter(
      (b) => b.definition.kind === k && b.definition.tag === tag,
    );
  if (kind === 'from') {
    for (const { path: p, sheet, name } of chain) {
      const goto = find(sheet, 'goto')[0];
      if (goto)
        return {
          source: { path: p, blockId: goto.id, sheetName: name },
          peers: [] as TagLink[],
        };
    }
    return { source: undefined, peers: [] as TagLink[] };
  }
  const own = chain[0];
  const peers: TagLink[] = find(own.sheet, kind === 'goto' ? 'from' : kind)
    .filter((b) => b.id !== block.id)
    .map((b) => ({ path: own.path, blockId: b.id, sheetName: own.name }));
  if (kind === 'connectionLabel')
    for (const { path: p, sheet, name } of chain.slice(1))
      peers.push(
        ...find(sheet, kind).map((b) => ({
          path: p,
          blockId: b.id,
          sheetName: name,
        })),
      );
  return { source: undefined, peers };
}

/** Tags of `kind` visible from the sheet at `path`: its own and those on the sheets above. */
export function tagsInScope(project: Project, path: string[], kind: string) {
  const tags = new Set<string>();
  for (const { sheet } of sheetsOnPath(project, path))
    for (const b of sheet.blocks)
      if (b.definition.kind === kind && b.definition.tag)
        tags.add(b.definition.tag);
  return [...tags].sort();
}

function problem(
  id: string,
  message: string,
  blockIds: string[],
  hint: string,
): Diagnostic {
  return {
    id,
    severity: 'error',
    source: 'validation',
    message,
    detail: '',
    blockIds,
    ports: [],
    netIds: [],
    wireIds: [],
    hint,
  };
}

/**
 * The tag problems a run would refuse (server/tags.py `tag_problems`), for the sheet
 * open at `path`: a tag block without a valid tag, two Gotos with one tag here, a From
 * with no Goto here or above, and one tag on blocks of different kinds of value.
 */
export function tagProblems(project: Project, path: string[]): Diagnostic[] {
  const view = scopeView(project, path);
  const out: Diagnostic[] = [];
  const tagged = view.blocks.filter((b) => isTagKind(b.definition.kind));
  if (!tagged.length) return out;
  for (const b of tagged)
    if (!b.definition.tag || !TAG_PATTERN.test(b.definition.tag))
      out.push(
        problem(
          `v-tag-${b.id}`,
          `${b.definition.name} has no valid tag.`,
          [b.id],
          'Give it a tag in its properties: a letter, then letters, digits and _.',
        ),
      );
  const by = (kind: string) => {
    const m = new Map<string, Block[]>();
    for (const b of tagged)
      if (b.definition.kind === kind && b.definition.tag)
        m.set(b.definition.tag, [...(m.get(b.definition.tag) ?? []), b]);
    return m;
  };
  for (const [tag, gotos] of by('goto'))
    if (gotos.length > 1)
      out.push(
        problem(
          `v-tag-twice-${tag}`,
          `Two Goto blocks on this sheet use the tag [${tag}].`,
          gotos.map((b) => b.id),
          'Keep one Goto per tag on a sheet; rename the other.',
        ),
      );
  const signals = new Map<string, Block[]>();
  for (const kind of ['goto', 'from'])
    for (const [tag, blocks] of by(kind))
      signals.set(tag, [...(signals.get(tag) ?? []), ...blocks]);
  for (const [tag, blocks] of [...signals, ...by('connectionLabel')])
    if (new Set(blocks.map((b) => b.definition.ports[0]?.domain)).size > 1)
      out.push(
        problem(
          `v-tag-mixed-${blocks[0].definition.kind}-${tag}`,
          blocks[0].definition.kind === 'connectionLabel'
            ? `The connection labels [${tag}] join different physical domains.`
            : `The Goto and From blocks tagged [${tag}] carry different kinds of signal.`,
          blocks.map((b) => b.id),
          'Use one tag per kind of value.',
        ),
      );
  const visible = new Set(tagsInScope(project, path, 'goto'));
  for (const [tag, froms] of by('from'))
    if (!visible.has(tag))
      out.push(
        problem(
          `v-tag-orphan-${tag}`,
          `No Goto [${tag}] on this sheet or above it for the From [${tag}].`,
          froms.map((b) => b.id),
          'Add a Goto with this tag here or on a sheet above. A Goto inside a subsystem is not seen outside it.',
        ),
      );
  return out;
}
