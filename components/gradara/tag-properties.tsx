'use client';
import { useEffect, useId, useState } from 'react';
import { Crosshair } from 'lucide-react';
import type { Block, Project } from '@/lib/gradara/model';
import { TAG_PATTERN } from '@/lib/gradara/tag-blocks';
import { tagLinks, tagsInScope, type TagLink } from '@/lib/gradara/tags';

/**
 * The tag of a Goto, From, or connection label, and where it connects: a From's Goto
 * (on this sheet or above), a Goto's From blocks, a label's other labels. A tag only
 * reaches down into subsystems, never up out of one.
 */
export function TagProperties({
  doc,
  path,
  block,
  onTag,
  onShow,
}: {
  doc: Project;
  path: string[];
  block: Block;
  onTag: (tag: string) => void;
  onShow: (link: TagLink) => void;
}) {
  const kind = block.definition.kind;
  const [draft, setDraft] = useState(block.definition.tag ?? '');
  useEffect(() => setDraft(block.definition.tag ?? ''), [block.definition.tag]);
  const valid = TAG_PATTERN.test(draft);
  const listId = useId();
  // A From picks from the Gotos it can see; a Goto or label from the tags in use around it.
  const suggestions = tagsInScope(
    doc,
    path,
    kind === 'from' ? 'goto' : kind === 'goto' ? 'from' : kind,
  );
  const { source, peers } = tagLinks(doc, path, block);
  const commitTag = () => {
    if (valid && draft !== block.definition.tag) onTag(draft);
    else if (!valid) setDraft(block.definition.tag ?? '');
  };
  const here = (link: TagLink) =>
    link.path.length === path.length ? 'this sheet' : link.sheetName;
  return (
    <div className="inspector-section tag-section">
      <div className="section-label">Tag</div>
      <label className="tag-field">
        <input
          value={draft}
          list={listId}
          spellCheck={false}
          aria-invalid={!valid}
          aria-label="Tag"
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commitTag}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              commitTag();
            } else if (e.key === 'Escape') setDraft(block.definition.tag ?? '');
          }}
        />
        <datalist id={listId}>
          {suggestions.map((t) => (
            <option key={t} value={t} />
          ))}
        </datalist>
      </label>
      {!valid && (
        <p className="size-hint is-error">
          A letter, then letters, digits, or _ (up to 32).
        </p>
      )}
      {kind === 'from' ? (
        source ? (
          <p className="size-hint tag-link">
            Reads the Goto [{block.definition.tag}] on {here(source)}.
            <button type="button" onClick={() => onShow(source)}>
              <Crosshair size={12} /> Show
            </button>
          </p>
        ) : (
          <p className="size-hint is-error">
            No Goto [{block.definition.tag}] on this sheet or above. A Goto
            inside a subsystem is not seen outside it.
          </p>
        )
      ) : (
        <>
          <p className="size-hint">
            {kind === 'goto'
              ? peers.length
                ? `Read by ${peers.length} From block${peers.length === 1 ? '' : 's'} on this sheet, and by any inside the subsystems on it.`
                : 'No From block reads it on this sheet; From blocks inside the subsystems on it can.'
              : peers.length
                ? `Joined with ${peers.length} other label${peers.length === 1 ? '' : 's'} [${block.definition.tag}] here and above, and with any inside the subsystems on this sheet.`
                : 'No other label with this tag here or above; labels inside the subsystems on this sheet join it.'}
          </p>
          {peers.length > 0 && (
            <ul className="tag-peers">
              {peers.slice(0, 8).map((link) => (
                <li key={`${link.path.join('/')}/${link.blockId}`}>
                  <button type="button" onClick={() => onShow(link)}>
                    <Crosshair size={12} /> {link.blockId} · {here(link)}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </div>
  );
}
