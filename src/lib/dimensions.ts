/**
 * The eleven scored dimensions, with the plain-language explanation of what
 * each one measures.
 *
 * The product principle this serves: a score with no explanation is a number
 * the user cannot defend to anyone else. Hovering or focusing a density column
 * writes the matching `meaning` into the sheet, so every number on the page can
 * be accounted for without leaving it.
 */

import type { Scores } from '../../core/types.ts';

export interface Dimension {
  key: keyof Omit<Scores, 'overall'>;
  label: string;
  /** Two- or three-letter column head. */
  abbr: string;
  meaning: string;
}

export const DIMENSIONS: Dimension[] = [
  {
    key: 'memorability',
    label: 'Memorability',
    abbr: 'Mem',
    meaning:
      'Weighted most heavily of all, and driven mostly by imagery — how much of a mental picture the name arrives with. Brevity and a two-beat rhythm count for little, because every invented name has them.',
  },
  {
    key: 'pronunciation',
    label: 'Pronunciation',
    abbr: 'Pro',
    meaning:
      'Whether a stranger can say it on sight. Illegal consonant clusters, vowel-starved spellings and four-syllable names all cost here.',
  },
  {
    key: 'visual',
    label: 'Visual',
    abbr: 'Vis',
    meaning:
      'How the name behaves as an object: silhouette variety, letter pairs that blur at small sizes, wordmark width, and whether the first letter makes a monogram.',
  },
  {
    key: 'brandability',
    label: 'Brandability',
    abbr: 'Brd',
    meaning:
      'Composite of pronunciation, distinctiveness, visual behaviour and spell-back accuracy, plus a bonus where the name is short enough with a hard onset to become a verb.',
  },
  {
    key: 'emotion',
    label: 'Emotional fit',
    abbr: 'Emo',
    meaning:
      'Sound symbolism measured against the emotional targets in the brief. Front vowels and voiceless stops read small, sharp and fast; back vowels and liquids read large, soft and calm.',
  },
  {
    key: 'premium',
    label: 'Premium feel',
    abbr: 'Prm',
    meaning:
      'Whether the name could carry a high price. Soft continuants and open vowels earn; plosive density, digits, superlative prefixes and discount respellings cost.',
  },
  {
    key: 'scalability',
    label: 'Scalability',
    abbr: 'Scl',
    meaning:
      'Whether the name still works in ten years, after the company leaves its first category. Embedded category words and echoes of the brief itself are penalised.',
  },
  {
    key: 'international',
    label: 'International',
    abbr: 'Int',
    meaning:
      'Survival outside English. Flags the specific failures: "th" is absent from French, German and Japanese; Spanish speakers add a vowel before initial s-clusters; L and R are hard to separate for Japanese and Korean speakers.',
  },
  {
    key: 'trademarkUniqueness',
    label: 'Trademark (estimate)',
    abbr: 'TM',
    meaning:
      'An ESTIMATE from a corpus of well-known marks, weighing sight, sound and relatedness of goods — the factors an examiner applies. It is a shortlisting filter, not a clearance search, and not legal advice.',
  },
  {
    key: 'domainUniqueness',
    label: 'Domains',
    abbr: 'Dom',
    meaning:
      'For finalists this is real RDAP and DNS data, weighted towards the exact-match .com because that is still how people type. Elsewhere it is an estimate from length and word rarity.',
  },
  {
    key: 'socialUniqueness',
    label: 'Handles',
    abbr: 'Soc',
    meaning:
      'GitHub and npm answer truthfully and are authoritative here. Consumer social platforms block automated probes, so they are reported as indicative only.',
  },
];

/** Ten ticks per column, so a column reads as a measurement rather than a bar. */
export const TICKS = 10;
