/** Subsequence scorer for the library navigator. Higher is better. */
export function fuzzyScore(query: string, text: string): number | null {
  const q = query.trim().toLowerCase();
  if (!q) return 0;
  const t = text.toLowerCase();
  let ti = 0;
  let score = 0;
  let run = 0;
  for (const ch of q) {
    if (ch === ' ') continue;
    const found = t.indexOf(ch, ti);
    if (found < 0) return null;
    run = found === ti ? run + 1 : 1;
    const wordStart = found === 0 || !/[a-z0-9]/.test(t[found - 1] ?? '');
    score += (wordStart ? 12 : 2) + run * 4;
    score -= Math.min(6, found - ti);
    ti = found + 1;
  }
  if (t.startsWith(q)) score += 24;
  if (t === q) score += 40;
  return score;
}

export function fuzzyRanges(query: string, text: string): [number, number][] {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  const t = text.toLowerCase();
  const ranges: [number, number][] = [];
  let ti = 0;
  for (const ch of q) {
    if (ch === ' ') continue;
    const found = t.indexOf(ch, ti);
    if (found < 0) return [];
    const last = ranges.at(-1);
    if (last && last[1] === found) last[1] = found + 1;
    else ranges.push([found, found + 1]);
    ti = found + 1;
  }
  return ranges;
}
