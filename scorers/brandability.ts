/**
 * Brandability, scalability and international friendliness.
 *
 * Brandability asks whether the name can carry a brand at all. Scalability asks
 * whether it can still carry it in ten years, after the company has left its
 * first category. International friendliness asks whether it survives being
 * spoken by someone who does not speak English — which is most of the market.
 */

import { profile } from '../core/phonology.ts';
import { clamp, normalize } from '../core/text.ts';
import type { BrandDNA, Strategy } from '../core/types.ts';

export interface BrandabilityInput {
  pronunciation: number;
  visual: number;
  uniqueness: number;
  spellability: number;
  strategy: Strategy;
}

export interface ScoreReport {
  score: number;
  notes: string[];
}

export function scoreBrandability(name: string, input: BrandabilityInput): ScoreReport {
  const p = profile(name);
  const notes: string[] = [];

  // The four hard requirements, weighted by how often each one kills a name.
  let score =
    input.pronunciation * 0.3 +
    input.uniqueness * 0.3 +
    input.visual * 0.22 +
    input.spellability * 0.18;

  // Verbability: short, hard-onset names become verbs ('to Zoom', 'to Slack').
  const verbable = p.syllableCount <= 2 && p.letters <= 6 && /^[bdgkptszfv]/.test(p.word);
  if (verbable) {
    score += 5;
    notes.push('short with a hard onset — could become a verb');
  }

  // Invented names start life meaningless, which is a cost, but they are the
  // only category where total ownership is realistic.
  if (input.strategy === 'invented') {
    score += 3;
    notes.push('coined — requires meaning to be built, but can be owned outright');
  }
  if (input.strategy === 'acronym') score -= 6;

  return { score: clamp(score), notes };
}

/** Category words that pin a name to one industry forever. */
const CATEGORY_WORDS = [
  'shop', 'store', 'cart', 'pay', 'bank', 'coin', 'crypto', 'health', 'med', 'care', 'fit',
  'learn', 'edu', 'school', 'tutor', 'travel', 'trip', 'fly', 'hotel', 'food', 'meal', 'chef',
  'code', 'dev', 'app', 'web', 'cloud', 'data', 'ai', 'bot', 'chat', 'mail', 'photo', 'video',
  'music', 'game', 'play', 'sport', 'home', 'house', 'rent', 'law', 'legal', 'tax', 'hire',
  'job', 'work', 'team', 'task', 'note', 'doc', 'file', 'sign', 'sell', 'buy', 'trade',
];

export function scoreScalability(name: string, dna: BrandDNA): ScoreReport {
  const w = normalize(name);
  const notes: string[] = [];
  let score = 78;

  for (const word of CATEGORY_WORDS) {
    if (w.includes(word) && word.length >= 3) {
      score -= 22;
      notes.push(`contains '${word}' — locks the brand to one category`);
      break;
    }
  }

  // A name built from the brief's own vocabulary cannot outgrow the brief.
  const briefWords = dna.brief
    .toLowerCase()
    .split(/[^a-z]+/)
    .filter((x) => x.length >= 5);
  for (const word of briefWords) {
    if (w.includes(word.slice(0, 5))) {
      score -= 14;
      notes.push(`echoes '${word}' from the brief — descriptive names age with the product`);
      break;
    }
  }

  if (dna.posture === 'evoke') score += 8;
  if (dna.posture === 'describe') score -= 6;

  const p = profile(name);
  if (p.syllableCount <= 3) score += 6;
  if (p.letters <= 8) score += 4;

  if (score >= 85) notes.push('abstract enough to follow the company into new categories');
  return { score: clamp(score), notes };
}

/**
 * Sounds and spellings that reliably cause trouble outside English.
 * Each rule names the speaker population it affects — vague 'international
 * concerns' are useless to act on.
 */
const INTERNATIONAL_RULES: { test: RegExp; cost: number; note: string }[] = [
  { test: /th/, cost: 12, note: "'th' is absent from French, German, Japanese and Mandarin" },
  { test: /^s[ptckmnl]/, cost: 8, note: 'initial s-cluster gets an epenthetic vowel from Spanish speakers ("estart")' },
  { test: /r.*l|l.*r/, cost: 6, note: 'both L and R — hard to distinguish for Japanese and Korean speakers' },
  { test: /w/, cost: 5, note: "'w' is realized as /v/ by German and Slavic speakers" },
  { test: /j/, cost: 6, note: "'j' is /x/ in Spanish and /y/ in German — three different readings" },
  { test: /[qx]/, cost: 6, note: 'q and x have unstable pronunciations across languages' },
  { test: /ough|augh|eigh/, cost: 16, note: 'English-only vowel spelling — unreadable elsewhere' },
  { test: /[bcdfgklmnprstvz]{3}/, cost: 10, note: 'three-consonant cluster is hard for Japanese and Italian speakers' },
];

export function scoreInternational(name: string): ScoreReport {
  const p = profile(name);
  const notes: string[] = [];
  let score = 92;

  for (const rule of INTERNATIONAL_RULES) {
    if (rule.test.test(p.word)) {
      score -= rule.cost;
      notes.push(rule.note);
    }
  }

  // CV-alternating, vowel-final names travel further than anything else —
  // they are legal syllable structures in Japanese, Italian and Spanish alike.
  if (/^([bcdfgklmnprstvz][aeiou])+$/.test(p.word)) {
    score += 8;
    notes.push('pure CV structure — pronounceable in almost every major language');
  } else if (p.endsInVowel && p.maxClusterLength <= 2) {
    score += 5;
    notes.push('vowel-final and cluster-light — travels well');
  }

  if (p.syllableCount > 4) score -= 10;

  return { score: clamp(score), notes };
}
