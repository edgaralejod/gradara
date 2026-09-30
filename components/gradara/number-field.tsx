'use client';
import { useEffect, useRef, useState, type Ref } from 'react';
import { Input } from '@/components/ui/input';
import { parseInRange, rangeMessage } from '@/lib/gradara/number-input';
export default function NumberField({
  value,
  onChange,
  min,
  max,
  ariaLabel,
  className,
  inputRef,
  live = false,
  onEnter,
  onValidity,
  disabled = false,
}: {
  value: number;
  onChange: (value: number) => void;
  min?: number;
  max?: number;
  ariaLabel?: string;
  className?: string;
  inputRef?: Ref<HTMLInputElement>;
  /** Report each valid keystroke; for staged editors, not undoable commits. */
  live?: boolean;
  /** Called after Enter commits a valid value. */
  onEnter?: () => void;
  /**
   * Reports whether the text in the field is a value that could be committed.
   * A parent that acts on `value` (Run, say) should hold off while it is false:
   * the field then shows something other than the value it last reported.
   */
  onValidity?: (valid: boolean) => void;
  disabled?: boolean;
}) {
  const [text, setText] = useState(String(value));
  const [invalid, setInvalid] = useState(false);
  const skipBlur = useRef(false);
  const validity = useRef<boolean | null>(null);
  useEffect(() => {
    // Keep in-progress text such as "1." when it already parses to the value.
    setText((t) => (t.trim() !== '' && Number(t) === value ? t : String(value)));
    setInvalid(false);
  }, [value]);
  const valid = parse(text) !== null;
  const report = useRef(onValidity);
  useEffect(() => {
    report.current = onValidity;
  });
  useEffect(() => {
    if (validity.current === valid) return;
    validity.current = valid;
    report.current?.(valid);
  }, [valid]);
  // Leaving the page with an invalid draft must not leave the parent blocked.
  useEffect(() => () => report.current?.(true), []);
  function parse(raw: string) {
    return parseInRange(raw, min, max);
  }
  const commit = () => {
    const next = parse(text);
    if (next === null) {
      setInvalid(true);
      return;
    }
    setInvalid(false);
    if (next !== value) onChange(next);
  };
  return (
    <Input
      ref={inputRef}
      disabled={disabled}
      className={className}
      type="number"
      step="any"
      value={text}
      min={min}
      max={max}
      aria-label={ariaLabel}
      aria-invalid={invalid}
      title={
        invalid || !valid ? rangeMessage(min, max) : undefined
      }
      onChange={(e) => {
        setText(e.target.value);
        setInvalid(false);
        if (live) {
          const next = parse(e.target.value);
          if (next !== null && next !== value) onChange(next);
        }
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
          if (parse(text) !== null) onEnter?.();
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
