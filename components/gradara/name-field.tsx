'use client';
import { useEffect, useRef, useState } from 'react';
import { Input } from '@/components/ui/input';

export default function NameField({
  value,
  onCommit,
}: {
  value: string;
  onCommit: (name: string) => void;
}) {
  const [draft, setDraft] = useState(value);
  const skipBlur = useRef(false);
  useEffect(() => setDraft(value), [value]);
  const commit = () => {
    const name = draft.trim();
    if (!name) {
      setDraft(value);
      return;
    }
    setDraft(name);
    if (name !== value) onCommit(name);
  };
  return (
    <Input
      className="component-name-input"
      aria-label="Component name"
      maxLength={100}
      value={draft}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={() => {
        if (!skipBlur.current) commit();
        skipBlur.current = false;
      }}
      onKeyDown={(e) => {
        if (e.key === 'Enter') {
          commit();
          skipBlur.current = true;
          e.currentTarget.blur();
        }
        if (e.key === 'Escape') {
          setDraft(value);
          skipBlur.current = true;
          e.currentTarget.blur();
        }
      }}
    />
  );
}
