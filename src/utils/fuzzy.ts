/**
 * Fuzzy matching for search-as-you-type: the query's characters must appear
 * in order; matches score higher at word starts, in runs, and near the
 * beginning. Returns the matched character positions for highlighting.
 *
 * @module utils/fuzzy
 */

export interface FuzzyMatch {
  score: number;
  /** Indices of the matched characters in the text. */
  indices: number[];
}

const fold = (s: string): string => s.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();
const isBoundary = (text: string, i: number): boolean => i === 0 || /[\s\-_/.:,()]/.test(text[i - 1]) || (/[a-z]/.test(text[i - 1]) && /[A-Z]/.test(text[i]));

/** Match `query` against `text`; null if it doesn't match. Accents and case are ignored. */
export function fuzzyMatch(query: string, text: string): FuzzyMatch | null {
  const q = fold(query.trim());
  if (!q) return { score: 0, indices: [] };
  const t = fold(text);
  // A plain substring is the best kind of match: prefer it when there is one.
  const sub = t.indexOf(q);
  if (sub !== -1) {
    const indices = Array.from({ length: q.length }, (_, k) => sub + k);
    return { score: 100 + q.length * 10 - sub + (isBoundary(text, sub) ? 30 : 0) - t.length * 0.1, indices };
  }
  const indices: number[] = [];
  let score = 0;
  let from = 0;
  let run = 0;
  for (const ch of q) {
    if (ch === ' ') continue;
    // Prefer the next occurrence at a word boundary, otherwise the next one.
    let at = -1;
    for (let i = t.indexOf(ch, from); i !== -1; i = t.indexOf(ch, i + 1)) {
      if (at === -1) at = i;
      if (isBoundary(text, i)) {
        at = i;
        break;
      }
      if (i === from) break; // adjacent: keep the run going
    }
    if (at === -1) return null;
    run = indices.length && at === indices[indices.length - 1] + 1 ? run + 1 : 0;
    score += 10 + run * 8 + (isBoundary(text, at) ? 15 : 0) - Math.min(at - from, 10);
    indices.push(at);
    from = at + 1;
  }
  return { score: score - t.length * 0.1, indices };
}

/** Sort items by how well they match, dropping those that don't. */
export function fuzzyFilter<T>(query: string, items: T[], text: (item: T) => string | string[]): Array<{ item: T; match: FuzzyMatch; field: number }> {
  const out: Array<{ item: T; match: FuzzyMatch; field: number }> = [];
  for (const item of items) {
    const fields = [text(item)].flat();
    let best: { match: FuzzyMatch; field: number } | null = null;
    fields.forEach((f, field) => {
      const m = fuzzyMatch(query, f);
      // Matches in secondary fields (keywords) count for less.
      if (m && (!best || m.score - field * 20 > best.match.score - best.field * 20)) best = { match: m, field };
    });
    if (best) out.push({ item, ...(best as { match: FuzzyMatch; field: number }) });
  }
  return out.sort((a, b) => b.match.score - b.field * 20 - (a.match.score - a.field * 20));
}
