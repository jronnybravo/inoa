/**
 * Adjectives, fetched per noun from real usage.
 *
 * The word bank cannot supply these. Its roles come from Datamuse part-of-speech
 * tags, which mark a word 'adj' if it is *ever* adjectival — so 'stone', 'gas'
 * and 'tea' land in the same bucket as 'warm' and 'bold', and the only role the
 * bank can state with confidence, 'mod', fills up with past participles
 * ('soaked', 'packed', 'asked') because those are adjectival and never nouns.
 * Drawing from the bank gave two recognizable adjectives in a pool of a hundred
 * and forty, which is why compounds read as noun+noun.
 *
 * `rel_jjb` answers a different and much better question: which adjectives do
 * people actually put in front of this noun. That is a corpus fact rather than a
 * grammatical label, so it returns 'golden harvest', 'royal court', 'wooden
 * table' — adjectives that are genuinely adjectives, already known to sit in
 * front of the brief's own vocabulary.
 */

import { getJSON } from '../core/net.ts';
import { isCommonWord } from './dictionary.ts';
import { isInflectedForm, normalize } from '../core/text.ts';
import type { Seed } from '../core/types.ts';

interface DatamuseWord {
  word: string;
  numSyllables?: number;
  tags?: string[];
}

/**
 * Uses per million, as a band rather than a floor.
 *
 * The ceiling is the load-bearing half and it is doing the job a stoplist would
 * otherwise do. The adjectives that collocate with any noun at all are the
 * contentless ones — 'small' (293), 'own' (397), 'little' (343), 'long' (382),
 * 'first' (758) — because they modify everything, and frequency is exactly the
 * measure of that. The adjectives worth a brand name sit an order of magnitude
 * lower: 'wooden' (17), 'tiny' (19), 'golden' (23), 'warm' (34), 'royal' (44).
 *
 * The floor drops the other failure: adjectives so specific to one noun that
 * they carry its context with them ('papal' at 3.9 from 'court', 'routing' at
 * 4.8 from 'table').
 */
const MIN_FREQUENCY = 8;
const MAX_FREQUENCY = 90;

function metadata(row: DatamuseWord): { pos: Set<string>; frequency: number } {
  const pos = new Set<string>();
  let frequency = 0;
  for (const tag of row.tags ?? []) {
    if (tag.startsWith('f:')) frequency = Number.parseFloat(tag.slice(2));
    else pos.add(tag);
  }
  return { pos, frequency };
}

/**
 * Adjectives people actually use in front of `noun`.
 *
 * Deliberately not cached as a failure: an empty answer here silently costs the
 * run its entire adjective supply, and the bank has none to fall back on.
 */
export async function modifiersFor(noun: string, max = 40): Promise<string[]> {
  const rows = await getJSON<DatamuseWord[]>(
    `https://api.datamuse.com/words?rel_jjb=${encodeURIComponent(noun)}&md=psf&max=${max}`,
    { ttlMs: 90 * 24 * 60 * 60 * 1000 },
  );
  if (!Array.isArray(rows)) return [];

  const out: string[] = [];
  for (const row of rows) {
    const word = normalize(row.word);
    if (word !== row.word || word.length < 3 || word.length > 8) continue;
    // Two beats at most: the noun it joins brings its own, and the generator
    // discards anything past three syllables anyway.
    if ((row.numSyllables ?? 9) > 2) continue;
    if (isInflectedForm(word)) continue;

    const { pos, frequency } = metadata(row);
    // Datamuse over-tags 'adj', but it is reliable in the negative — a word it
    // does not consider adjectival at all has no business leading a compound.
    if (!pos.has('adj')) continue;
    if (frequency < MIN_FREQUENCY || frequency > MAX_FREQUENCY) continue;
    if (!(await isCommonWord(word))) continue;
    out.push(word);
  }
  return out;
}

/**
 * Modifier seeds for the brief's own nouns.
 *
 * Each adjective is tagged with the noun that produced it, so a later pairing
 * has the collocation available — but nothing forces it back onto that noun.
 * 'golden' arrived via 'harvest' and is free to land on 'field' instead, which
 * is where compounds stop being phrases and start being names.
 */
export async function modifierSeeds(nouns: string[], perNoun = 6): Promise<Seed[]> {
  const seeds: Seed[] = [];
  const taken = new Set<string>();

  for (const noun of nouns) {
    const words = await modifiersFor(noun);
    let kept = 0;
    for (const word of words) {
      if (kept >= perNoun) break;
      if (taken.has(word)) continue;
      taken.add(word);
      kept++;
      seeds.push({
        form: word,
        gloss: `describes a ${noun}`,
        language: 'english',
        source: 'thesaurus',
        tags: [noun],
        weight: 0.7,
        role: 'mod',
        note: `modifier — people say '${word} ${noun}'`,
      });
    }
  }
  return seeds;
}
