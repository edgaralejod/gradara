'use client';
import { useRef, useState } from 'react';
import { Input } from '@/components/ui/input';

type Props = {
  label?: string;
  value: string;
  onCommit: (name: string) => string | void;
};

export default function NameField(props: Props) {
  return <NameInput key={props.value} {...props} />;
}

function NameInput({ value, onCommit, label = 'Component name' }: Props) {
  const [draft, setDraft] = useState(value);
  const skipBlur = useRef(false);
  const commit = () => {
    const name = draft.trim();
    if (!name) {
      setDraft(value);
      return;
    }
    setDraft(name !== value ? (onCommit(name) ?? name) : name);
  };
  return (
    <Input
      className="component-name-input"
      aria-label={label}
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
