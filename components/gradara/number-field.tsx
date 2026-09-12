'use client';
import { useEffect, useRef, useState } from 'react';
import { Input } from '@/components/ui/input';
export default function NumberField({
  value,
  onChange,
  min,
  max,
  ariaLabel,
  className,
}: {
  value: number;
  onChange: (value: number) => void;
  min?: number;
  max?: number;
  ariaLabel?: string;
  className?: string;
}) {
  const [text, setText] = useState(String(value));
  const [invalid, setInvalid] = useState(false);
  const skipBlur = useRef(false);
  useEffect(() => {
    setText(String(value));
    setInvalid(false);
  }, [value]);
  const commit = () => {
    const next = Number(text);
    if (
      text.trim() === '' ||
      !Number.isFinite(next) ||
      (min !== undefined && next < min) ||
      (max !== undefined && next > max)
    ) {
      setInvalid(true);
      return;
    }
    setInvalid(false);
    if (next !== value) onChange(next);
  };
  return (
    <Input
      className={className}
      type="number"
      step="any"
      value={text}
      min={min}
      max={max}
      aria-label={ariaLabel}
      aria-invalid={invalid}
      title={
        invalid ? 'Enter a valid value within the allowed range.' : undefined
      }
      onChange={(e) => {
        setText(e.target.value);
        setInvalid(false);
      }}
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
          setText(String(value));
          setInvalid(false);
          skipBlur.current = true;
          e.currentTarget.blur();
        }
      }}
    />
  );
}
