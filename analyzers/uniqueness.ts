/**
 * Distinctiveness analysis.
 *
 * Two questions:
 *   1. Is it a bare English word? (ownable only with enormous spend)
 *   2. Is its letter structure distinctive, or does it dissolve into the noise
 *      of every other name in the category?
 *
 * Collision against known marks used to live here and was removed with the
 * hand-authored corpus it depended on. Nothing checks whether a candidate
 * sounds like an existing brand any more — that judgement now belongs entirely
 * to the clearance search a human runs on the finalists.
 */

import { isRealWord, wordSet } from '../sources/dictionary.ts';
import { clamp, ngrams, normalize } from '../core/text.ts';

export interface UniquenessReport {
  score: number;
  isRealWord: boolean;
  /** Mean surprisal of the name's trigrams — high means structurally distinctive. */
  rarity: number;
  /**
   * Share of the name's trigrams that appear nowhere in the English lexicon.
   * This is the 'random syllables' detector: distinctive names use rare
   * combinations, invented-badly names use combinations no language uses.
   */
  alienShare: number;
  notes: string[];
}

let trigramModel: Promise<Map<string, number>> | undefined;

/**
 * Trigram frequencies over the English lexicon. A name built entirely from
 * common trigrams ('inter', 'ation') vanishes into the background; one built
 * from rare-but-legal trigrams stands out without becoming unpronounceable.
 */
async function model(): Promise<Map<string, number>> {
  trigramModel ??= (async () => {
    const words = await wordSet();
    const counts = new Map<string, number>();
    let total = 0;
    for (const word of words) {
      if (word.length < 3 || word.length > 12) continue;
      for (const gram of ngrams(word, 3)) {
        counts.set(gram, (counts.get(gram) ?? 0) + 1);
        total++;
      }
    }
    // Store log-probabilities directly.
    const logs = new Map<string, number>();
    for (const [gram, count] of counts) logs.set(gram, Math.log(count / total));
    logs.set('__floor__', Math.log(0.5 / Math.max(1, total)));
    return logs;
  })();
  return trigramModel;
}

async function structureOf(name: string): Promise<{ rarity: number; alienShare: number }> {
  const logs = await model();
  const floor = logs.get('__floor__') ?? -16;
  const grams = ngrams(name, 3);
  if (grams.length === 0) return { rarity: 50, alienShare: 0 };

  let alien = 0;
  const mean =
    grams.reduce((sum, gram) => {
      const value = logs.get(gram);
      if (value === undefined) alien++;
      return sum + (value ?? floor);
    }, 0) / grams.length;

  return {
    // -6 is a very common structure, -14 is near-unique. Map onto 0..100.
    rarity: clamp(((-mean - 6) / 8) * 100),
    alienShare: alien / grams.length,
  };
}

export async function analyzeUniqueness(name: string): Promise<UniquenessReport> {
  const w = normalize(name);
  const notes: string[] = [];
  const real = await isRealWord(w);
  const { rarity, alienShare } = await structureOf(w);
  let score = 70 + (rarity - 50) * 0.4;

  if (real) {
    // A cost, not a disqualification — the ownership burden is already priced
    // into the domain and trademark dimensions.
    score -= 12;
    notes.push('a real English word — evocative and easy to spell, but expensive to own');
  }

  if (rarity > 75) notes.push('structurally distinctive letter pattern');
  if (rarity < 30) notes.push('letter pattern is very ordinary — will not stick on its own');

  // Distinctive is good; alien is not. A name whose letter sequences occur
  // nowhere in the language reads as random syllables rather than as a coinage,
  // and it will be misheard, misspelled and mistyped forever.
  if (alienShare > 0.4) {
    score -= 10;
    notes.push('letter sequences occur nowhere in English — reads as random syllables');
  }

  return {
    score: clamp(score),
    isRealWord: real,
    rarity: Math.round(rarity),
    alienShare,
    notes,
  };
}
