/**
 * How the name behaves as an object on a screen.
 *
 * A brand name spends most of its life being *looked at*, not read: a favicon,
 * a nav bar, an app icon, a sponsor board. This analyzer scores the shape —
 * silhouette variety, letter collisions at small sizes, wordmark width, and
 * whether the first letter is worth building a monogram from.
 */

import { AWKWARD_PAIRS, profile } from '../core/phonology.ts';
import { clamp } from '../core/text.ts';

/** Letters that rise above x-height, drop below the baseline, or sit flat. */
const ASCENDERS = new Set('bdfhklt');
const DESCENDERS = new Set('gjpqy');

/** Rough relative widths in a humanist sans — used to estimate wordmark balance. */
const WIDTHS: Record<string, number> = {
  i: 0.3, j: 0.35, l: 0.32, f: 0.4, t: 0.42, r: 0.45, s: 0.55, c: 0.58, e: 0.6, a: 0.6,
  z: 0.55, x: 0.58, k: 0.6, v: 0.6, y: 0.6, b: 0.63, d: 0.63, g: 0.63, h: 0.63, n: 0.63,
  o: 0.65, p: 0.63, q: 0.63, u: 0.63, w: 0.9, m: 0.95,
};

export interface ReadabilityReport {
  score: number;
  notes: string[];
  /** Estimated wordmark width in em units. */
  width: number;
}

export function analyzeReadability(name: string): ReadabilityReport {
  const p = profile(name);
  const w = p.word;
  const notes: string[] = [];
  let score = 100;

  const width = [...w].reduce((sum, ch) => sum + (WIDTHS[ch] ?? 0.6), 0);
  if (width > 6.2) {
    score -= 12;
    notes.push('wide wordmark — will need to shrink in constrained navigation');
  } else if (width < 2.2) {
    score -= 4;
    notes.push('very narrow — a short mark can read as unfinished without careful spacing');
  }

  const ascenders = [...w].filter((c) => ASCENDERS.has(c)).length;
  const descenders = [...w].filter((c) => DESCENDERS.has(c)).length;
  // A silhouette with no verticals reads as a soft blur; one with too many is a fence.
  if (ascenders === 0 && descenders === 0) {
    score -= 10;
    notes.push('flat silhouette — no ascenders or descenders to make the shape memorable');
  }
  if (ascenders + descenders > w.length * 0.6) {
    score -= 8;
    notes.push('busy silhouette — too many rising and falling strokes');
  }
  if (ascenders >= 1 && descenders >= 1) score += 5;

  for (const pair of AWKWARD_PAIRS) {
    if (w.includes(pair)) {
      score -= pair === 'rn' ? 14 : 7;
      notes.push(`'${pair}' blurs at small sizes and in condensed type`);
    }
  }

  if (p.doubles > 0) {
    score -= 5 * p.doubles;
    notes.push('doubled letters invite typos in the URL bar');
  }

  const first = w[0] as string;
  if ('ixzqvy'.includes(first)) {
    score += 4;
    notes.push(`'${first.toUpperCase()}' makes a distinctive monogram`);
  }
  if (first === 'o' || first === 'a') score += 2;

  // Repeating the same letter three or more times across a short name looks cheap.
  const counts = new Map<string, number>();
  for (const ch of w) counts.set(ch, (counts.get(ch) ?? 0) + 1);
  const maxRepeat = Math.max(...counts.values());
  if (maxRepeat >= 3 && w.length <= 8) {
    score -= 8;
    notes.push('one letter dominates the mark');
  }

  // A name that is a palindrome or near-palindrome is a genuine design asset.
  const reversed = [...w].reverse().join('');
  if (w === reversed && w.length >= 4) {
    score += 10;
    notes.push('palindrome — a rare, memorable structural hook');
  }

  return { score: clamp(score), notes, width: Math.round(width * 100) / 100 };
}
