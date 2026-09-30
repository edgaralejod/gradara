// SPDX-License-Identifier: Apache-2.0
/**
 * Parsing for numeric fields whose text may not yet be a value: the stop
 * time, a parameter, the C export step. The rule is the same everywhere: a
 * value is a finite number inside the field's range; anything else (blank,
 * text, NaN, out of range) is not a value, and a caller that acts on the last
 * committed value must not do so while the field shows something else.
 */

/** The simulation stop time in seconds: the range the engine accepts. */
export const STOP_TIME = { min: 0.000001, max: 86400 } as const;

/** `raw` as a number within [min, max], or null when it is not one. */
export function parseInRange(raw: string, min?: number, max?: number): number | null {
  if (raw.trim() === '') return null;
  const next = Number(raw);
  if (!Number.isFinite(next)) return null;
  if (min !== undefined && next < min) return null;
  if (max !== undefined && next > max) return null;
  return next;
}

/** "from 0.000001 to 86400", "of at least 1", "of at most 10", or "". */
export function rangeText(min?: number, max?: number): string {
  if (min !== undefined && max !== undefined) return `from ${min} to ${max}`;
  if (min !== undefined) return `of at least ${min}`;
  if (max !== undefined) return `of at most ${max}`;
  return '';
}

/** What a field with a bad value should say. */
export function rangeMessage(min?: number, max?: number): string {
  const range = rangeText(min, max);
  return range ? `Enter a number ${range}.` : 'Enter a number.';
}

/**
 * An optional positive number, as the C export step: blank means "choose
 * automatically" (undefined); a finite number above zero is the value; anything
 * else (0, negative, NaN, text) is null and must be reported, never replaced by
 * the automatic choice.
 */
export function parseOptionalPositive(raw: string): number | undefined | null {
  if (raw.trim() === '') return undefined;
  const next = Number(raw);
  return Number.isFinite(next) && next > 0 ? next : null;
}
