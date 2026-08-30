/**
 * Can a stranger say it, and can they spell it back?
 *
 * These are two different tests and both matter. A name that fails the first is
 * dead on arrival. A name that fails the second survives, but taxes every
 * podcast mention, every phone call and every word-of-mouth referral forever.
 */

import { profile, LIQUIDS, NASALS, PLOSIVES } from '../core/phonology.ts';
import { clamp } from '../core/text.ts';

export interface PronounceReport {
  score: number;
  /** Can it be spelled correctly after hearing it once? 0..100. */
  spellability: number;
  syllables: number;
  notes: string[];
}

export function analyzePronounceability(name: string): PronounceReport {
  const p = profile(name);
  const notes: string[] = [];
  let score = 100;

  for (const cluster of p.illegalClusters) {
    score -= 22;
    notes.push(`'${cluster}' is not a cluster English speakers produce comfortably`);
  }

  if (p.maxClusterLength >= 3) {
    score -= 10;
    notes.push('three-consonant cluster slows the first reading');
  }

  // Two and three syllables is the brand sweet spot; one is punchy but crowded,
  // four is where names start getting shortened by users.
  if (p.syllableCount === 1) {
    score -= 6;
    notes.push('single syllable — punchy, but the space is extremely crowded');
  } else if (p.syllableCount === 4) {
    score -= 12;
    notes.push('four syllables — users will abbreviate it for you');
  } else if (p.syllableCount > 4) {
    score -= 28;
    notes.push('too long to survive being said out loud');
  }

  if (p.vowelRatio < 0.28) {
    score -= 18;
    notes.push('vowel-starved — hard to voice');
  } else if (p.vowelRatio > 0.62) {
    score -= 10;
    notes.push('vowel-heavy — risks sounding unformed');
  }

  if (p.letters > 10) {
    score -= (p.letters - 10) * 5;
    notes.push('long for a wordmark');
  }

  // Liquids and nasals are what make a name flow; all-plosive names stutter.
  const smooth =
    [...p.word].filter((c) => LIQUIDS.has(c) || NASALS.has(c)).length / Math.max(1, p.letters);
  const hard = [...p.word].filter((c) => PLOSIVES.has(c)).length / Math.max(1, p.letters);
  if (smooth >= 0.2) score += 5;
  if (hard > 0.5) {
    score -= 8;
    notes.push('plosive-dense — reads as harsh when spoken quickly');
  }

  let spellability = 100;
  for (const graph of p.ambiguous) {
    spellability -= 22;
    notes.push(`'${graph}' has more than one plausible spelling by ear`);
  }
  if (p.doubles > 0) spellability -= 12 * p.doubles;
  if (/aa|ii|uu|yy/.test(p.word)) {
    spellability -= 20;
    score -= 8;
    notes.push('doubled vowel — English has no rule for it, so the spelling never survives dictation');
  }
  if (/ph|gh|kn|wr|ps/.test(p.word)) {
    spellability -= 15;
    notes.push('silent-letter pattern — expect misspellings in search');
  }
  if (/(?<=[a-z])y(?=[a-z])/.test(p.word)) spellability -= 8;
  if (p.letters > 9) spellability -= (p.letters - 9) * 4;

  return {
    score: clamp(score),
    spellability: clamp(spellability),
    syllables: p.syllableCount,
    notes,
  };
}
