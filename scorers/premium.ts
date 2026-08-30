/**
 * Premium feel.
 *
 * What separates a name that can carry a $200 price point from one that reads
 * as a discount app: sound (soft continuants and open vowels over clipped
 * plosives), length (restraint reads expensive), ending (a vowel or a Latinate
 * ending reads considered), and the absence of the cheapness markers — gratuitous
 * Zs and Xs, stacked superlatives, digits, aggressive respellings.
 */

import { profile, letterShare, LIQUIDS, NASALS, OPEN_VOWELS, PLOSIVES, SIBILANTS } from '../core/phonology.ts';
import { clamp } from '../core/text.ts';
import type { Strategy } from '../core/types.ts';

export interface PremiumReport {
  score: number;
  notes: string[];
}

const CHEAP_MARKERS: { pattern: RegExp; label: string; cost: number }[] = [
  { pattern: /[0-9]/, label: 'digits read as a domain compromise', cost: 25 },
  { pattern: /(xtreme|xpress|kwik|ez|rite|lite)/, label: 'discount-retail respelling', cost: 28 },
  { pattern: /z{2,}|x{2,}/, label: 'stacked Zs or Xs', cost: 18 },
  { pattern: /^(mega|ultra|super|hyper|max)/, label: 'superlative prefix', cost: 20 },
  { pattern: /(pro|plus|max)$/, label: 'tier suffix — a product name, not a brand', cost: 14 },
  { pattern: /(zz|kk|xx)/, label: 'novelty doubling', cost: 12 },
  { pattern: /^(.{2})\1/, label: 'reduplicated opening reads as nursery-register', cost: 10 },
];

export function scorePremium(name: string, strategy: Strategy, chunks = 1): PremiumReport {
  const p = profile(name);
  const notes: string[] = [];
  let score = 44;

  // Sound. Continuants read expensive; plosive-dense names read fast and cheap.
  // Soft texture is rewarded on a curve that flattens out — past about a third
  // of the word, more liquids stop buying anything and start sounding syrupy.
  const soft = letterShare(name, LIQUIDS) + letterShare(name, NASALS);
  const plosive = letterShare(name, PLOSIVES);
  const sibilant = letterShare(name, SIBILANTS);
  const open = letterShare(name, OPEN_VOWELS);

  score += Math.min(soft, 0.35) * 70;
  score += Math.min(open, 0.3) * 45;
  score -= Math.max(0, plosive - 0.25) * 70;
  score -= Math.max(0, sibilant - 0.2) * 45;

  if (soft >= 0.25 && plosive <= 0.25) notes.push('soft consonant texture — reads considered');

  // Restraint. Five to eight letters is where premium lives — measured in
  // chunks a reader parses, so a legible compound is not charged twice.
  const effective = chunks > 1 ? Math.ceil(p.letters / chunks) + 2 : p.letters;
  if (effective >= 5 && effective <= 8) score += 8;
  else if (effective <= 4) score -= 4;
  else if (effective > 10) {
    score -= (effective - 10) * 6;
    notes.push('long names read as functional rather than premium');
  }

  if (p.syllableCount === 3) {
    score += 6;
    notes.push('three syllables — the classic luxury cadence');
  } else if (p.syllableCount === 2) score += 4;
  else if (p.syllableCount > 3) score -= 8;

  // Ending. A terminal vowel or a Latinate close reads deliberate.
  if (/[aeo]$/.test(p.word)) {
    score += 7;
    notes.push('open ending — the Italianate/Latinate close');
  } else if (/(is|us|um|ix|or|ia|ora)$/.test(p.word)) score += 6;
  else if (/(ly|ify|io|er|it)$/.test(p.word)) {
    score -= 10;
    notes.push('startup-era ending — reads as a tool, not a house');
  }

  for (const marker of CHEAP_MARKERS) {
    if (marker.pattern.test(p.word)) {
      score -= marker.cost;
      notes.push(marker.label);
    }
  }

  // An aggressive respelling is the single loudest cheapness signal there is.
  if (strategy === 'misspelling') {
    score -= 8;
    notes.push('respellings carry an inherent premium penalty — the trade must be worth it');
  }
  if (strategy === 'acronym') score -= 6;
  if (p.ambiguous.length > 0) score -= 8;
  if (p.illegalClusters.length > 0) score -= 12;

  return { score: clamp(score), notes };
}
