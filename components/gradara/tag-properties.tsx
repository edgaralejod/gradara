'use client';
import { useEffect, useId, useState } from 'react';
import { Crosshair } from 'lucide-react';
import {
  domainColors,
  domainTitle,
  type Block,
  type Domain,
  type Project,
} from '@/lib/gradara/model';
import {
  tagDomains,
  TAG_PATTERN,
  type TagKind,
} from '@/lib/gradara/tag-blocks';

/**
 * What a tag block carries: a physical domain for a connection label, a signal or a
 * Boolean value for a Goto or From. It can be chosen while the block has no wires;
 * once wired, it follows its first wire.
 */
export function TagTypeSelect({
  kind,
  value,
  wired,
  onChange,
  className = 'tag-type',
}: {
  kind: TagKind;
  value: Domain;
  wired: boolean;
  onChange: (domain: Domain) => void;
  className?: string;
}) {
  return (
    <>
      <label className={`${className}-field`}>
        <span
          className="tag-type-swatch"
          style={{ background: domainColors[value] }}
          aria-hidden
        />
        <select
          className={className}
          aria-label="Type"
          value={value}
          disabled={wired}
          onChange={(e) => onChange(e.target.value as Domain)}
        >
          {tagDomains(kind).map((d) => (
            <option key={d} value={d}>
              {domainTitle(d)}
            </option>
          ))}
        </select>
      </label>
      <p className="size-hint">
        {wired
          ? 'Set by its wire. Remove its wires to choose another type.'
          : kind === 'connectionLabel'
            ? 'Or wire it first: it takes the type of the first terminal you connect.'
            : 'Or wire it first: it takes the type of the first wire you connect.'}
      </p>
    </>
  );
}
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
  wired,
  onTag,
  onType,
  onShow,
}: {
  doc: Project;
  path: string[];
  block: Block;
  /** Whether the block has wires on its own sheet (it then follows its wire's type). */
  wired: boolean;
  onTag: (tag: string) => void;
  onType: (domain: Domain) => void;
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
      <div className="section-label tag-type-label">Type</div>
      <TagTypeSelect
        kind={kind as TagKind}
        value={block.definition.ports[0]?.domain ?? 'signal'}
        wired={wired}
        onChange={onType}
      />
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
