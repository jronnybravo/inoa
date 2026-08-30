/**
 * Memorability.
 *
 * The single trait the brief cares most about: names people remember, not names
 * that describe. Memory research points at four levers a name can actually
 * pull — brevity, rhythm, distinctiveness, and imagery — plus one bonus lever,
 * a structural hook (alliteration, repetition, symmetry) that gives the ear
 * something to hold on to.
 */

import { profile } from '../core/phonology.ts';
import { clamp } from '../core/text.ts';

export interface MemorabilityInput {
  /** Trigram surprisal from the uniqueness analyzer, 0..100. */
  rarity: number;
  /**
   * 0..1 — how much of a mental picture the name arrives with. A borrowed
   * concept ('Fathom') is 1; a root with a living gloss ('Lumora') is mid; a
   * coinage with no semantic parentage is near 0. This is the difference
   * between a name that is memorable and one that is merely unusual.
   */
  imagery: number;
  isRealWord: boolean;
  /**
   * How many familiar whole words the name reads as. A coinage is one chunk;
   * 'Warmgrove' is two. Reading cost is paid per chunk, not per letter, which
   * is why Snowflake and Salesforce work at nine and ten letters while a
   * nine-letter invented name does not.
   */
  chunks: number;
}

export interface MemorabilityReport {
  score: number;
  notes: string[];
}

export function scoreMemorability(name: string, input: MemorabilityInput): MemorabilityReport {
  const p = profile(name);
  const notes: string[] = [];
  let score = 40;

  // Brevity, rhythm and distinctiveness are kept deliberately small. Any short,
  // two-beat, vowel-final coinage scores well on all three — which is exactly
  // the shape of a forgettable made-up name. They are hygiene, not advantage.
  //
  // Length is counted in chunks a reader already knows, not raw letters. Charging
  // a two-word compound by the letter was penalising it for being legible.
  const effective =
    input.chunks > 1 ? Math.ceil(p.letters / input.chunks) + 2 : p.letters;
  if (effective <= 7 && effective >= 4) score += 10;
  else if (effective <= 9) score += 5;
  else score -= (effective - 9) * 5;

  if (p.syllableCount === 2) {
    score += 8;
    notes.push('two-beat rhythm — the most repeatable shape there is');
  } else if (p.syllableCount === 3) score += 5;
  else if (p.syllableCount === 1) score += 3;
  else score -= 10;

  if (input.rarity >= 55 && input.rarity <= 88) {
    score += 8;
    notes.push('distinctive without being unpronounceable');
  } else if (input.rarity > 88) {
    score += 2;
    notes.push('very unusual structure — distinctive, but needs repetition to stick');
  } else {
    score -= 6;
  }

  // Imagery carries the most weight by design. A name you can picture is a name
  // you can recall, and it is the one lever a coinage cannot fake.
  score += input.imagery * 32 - 2;
  if (input.imagery >= 0.8) notes.push('arrives with a concrete mental image');
  else if (input.imagery <= 0.25) notes.push('no inherent image — meaning has to be built from zero');
  if (input.isRealWord) score += 4;

  // Structural hooks.
  const w = p.word;
  const syllables = p.syllables.map((s) => s.text);
  if (syllables.length >= 2 && syllables[0]?.[0] === syllables[1]?.[0]) {
    score += 6;
    notes.push('internal alliteration');
  }
  const vowelRun = w.match(/[aeiou]/g)?.join('') ?? '';
  if (vowelRun.length >= 2 && new Set(vowelRun).size === 1) {
    score += 6;
    notes.push(`assonance on '${vowelRun[0]}' — the vowel repeats through the whole word`);
  }
  if (p.endsInVowel) score += 4;

  // Names that fight themselves are hard to hold in working memory.
  if (p.illegalClusters.length > 0) score -= 15;
  if (p.ambiguous.length > 0) score -= 8;

  return { score: clamp(score), notes };
}
