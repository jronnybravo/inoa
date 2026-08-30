/**
 * Semantic expansion via Datamuse (free, no key).
 *
 * Datamuse is used rather than a plain thesaurus because it exposes the
 * relationships that actually matter for naming: `rel_trg` (words triggered by
 * a concept) reaches sideways into a field the way a good strategist does,
 * while `ml` (means-like) stays close and safe.
 */

import { getJSON } from '../core/net.ts';
import { isCommonWord } from './dictionary.ts';
import { normalize } from '../core/text.ts';
import type { Seed } from '../core/types.ts';

interface DatamuseWord {
  word: string;
  score?: number;
  tags?: string[];
}

/**
 * Words per million. Below this a word is too obscure to carry a brand: it is
 * either a proper noun the dictionary check missed ('marco'), an abbreviation
 * ('ipc', 'oecd'), or a technical term nobody will recognize.
 */
const MIN_FREQUENCY = 1.0;

function frequencyOf(row: DatamuseWord): number | undefined {
  const tag = row.tags?.find((t) => t.startsWith('f:'));
  return tag ? Number.parseFloat(tag.slice(2)) : undefined;
}

/** Drop proper nouns, abbreviations and obscure entries from a Datamuse result. */
async function usableWords(rows: DatamuseWord[]): Promise<string[]> {
  const out: string[] = [];
  for (const row of rows) {
    const frequency = frequencyOf(row);
    if (frequency !== undefined && frequency < MIN_FREQUENCY) continue;
    if (row.word.includes(' ')) continue;
    if (!(await isCommonWord(row.word))) continue;
    out.push(row.word);
  }
  return out;
}

const BASE = 'https://api.datamuse.com/words';

async function datamuse(query: string, max = 30): Promise<DatamuseWord[]> {
  const data = await getJSON<DatamuseWord[]>(`${BASE}?${query}&md=f&max=${max}`, {
    ttlMs: 90 * 24 * 60 * 60 * 1000,
    cacheFailures: true,
  });
  return Array.isArray(data) ? data : [];
}

/** Words that mean roughly the same thing. */
export async function meansLike(term: string, max = 25): Promise<string[]> {
  return usableWords(await datamuse(`ml=${encodeURIComponent(term)}`, max));
}

/** Words strongly associated with the term — the sideways move. */
export async function triggers(term: string, max = 25): Promise<string[]> {
  return usableWords(await datamuse(`rel_trg=${encodeURIComponent(term)}`, max));
}

/** Adjectives commonly used to describe the term. */
export async function describedBy(term: string, max = 20): Promise<string[]> {
  const rows = await datamuse(`rel_jjb=${encodeURIComponent(term)}`, max);
  return rows.map((r) => r.word);
}

/** Nouns this adjective commonly modifies. */
export async function modifies(term: string, max = 20): Promise<string[]> {
  const rows = await datamuse(`rel_jja=${encodeURIComponent(term)}`, max);
  return rows.map((r) => r.word);
}

/** Words that sound like the term — the raw material for near-miss coinages. */
export async function soundsLike(term: string, max = 20): Promise<string[]> {
  const rows = await datamuse(`sl=${encodeURIComponent(term)}`, max);
  return rows.map((r) => r.word);
}

/** Words matching a spelling pattern, e.g. 'lu*a'. Wildcards: * and ?. */
export async function spelledLike(pattern: string, max = 30): Promise<string[]> {
  const rows = await datamuse(`sp=${encodeURIComponent(pattern)}`, max);
  return rows.map((r) => r.word);
}

/**
 * Expand a word taken straight from the brief into its domain vocabulary.
 *
 * This is where a brief's actual subject enters the engine. 'sport' returns
 * court, league, arena, athlete, match; 'kitchen' returns pantry, hearth,
 * chef. Without it the run only ever sees the abstract tags the brief was
 * mapped to — 'community', 'connection' — and cannot produce a name that
 * belongs to the field the product is actually in.
 *
 * Results are marked as dictionary words rather than thesaurus associations,
 * because they are real English nouns and must be eligible to form transparent
 * compounds.
 */
export async function expandBriefTerm(term: string): Promise<Seed[]> {
  const [near, assoc] = await Promise.all([meansLike(term, 18), triggers(term, 24)]);

  /**
   * Second hop.
   *
   * One hop from an abstract term returns its members, not its vocabulary:
   * 'sport' gives soccer, rugby, lacrosse. The words a namer actually wants —
   * field, arena, league, team — live one step further, inside those members.
   * Every other free provider was measured against this and lost: ConceptNet's
   * typed relations are the right shape but its public API is unreliable,
   * Wikipedia categories return encyclopedia jargon, and Wiktionary returns
   * phrases containing the term rather than the field around it.
   */
  // Hubs come from means-like, not triggers. A trigger word carries its other
  // senses with it — 'sport' triggers 'shooter', whose vocabulary is rifle,
  // xbox and quake, and 'Loomrifle' is what that produces. Means-like stays in
  // the intended sense: 'athletics' and 'recreation', whose vocabulary is jump,
  // hurdles, throw, trails, playground.
  const hubs = near
    .filter((w) => !w.includes(' ') && w.length >= 4 && w.length <= 12 && w !== term)
    .slice(0, 3);
  const deeper = await Promise.all(hubs.map((hub) => triggers(hub, 20)));

  const seeds: Seed[] = [];
  const seen = new Set<string>();

  const add = (word: string, weight: number, relation: string) => {
    const form = normalize(word);
    if (form.length < 3 || form.length > 11 || word.includes(' ') || seen.has(form)) return;
    seen.add(form);
    seeds.push({
      form,
      gloss: `${relation} '${term}'`,
      language: 'english',
      source: 'dictionary',
      tags: [term],
      weight,
      note: `from the brief: ${term}`,
    });
  };

  for (const word of assoc) add(word, 0.85, 'in the world of');
  for (const word of near) add(word, 0.7, 'means like');
  hubs.forEach((hub, index) => {
    for (const word of deeper[index] ?? []) add(word, 0.8, `in the vocabulary of ${hub}, from`);
  });

  return seeds;
}

/**
 * Full expansion of one brief concept into seeds, weighted by relationship
 * type: triggers are the most generative, means-like the safest.
 */
export async function expandConcept(concept: string): Promise<Seed[]> {
  const [near, assoc, adjectives] = await Promise.all([
    meansLike(concept, 20),
    triggers(concept, 24),
    describedBy(concept, 12),
  ]);

  const make = (word: string, weight: number, relation: string): Seed | undefined => {
    const form = normalize(word);
    // Multi-word Datamuse results and very long words are unusable as seeds.
    if (form.length < 3 || form.length > 12 || word.includes(' ')) return undefined;
    return {
      form,
      gloss: `${relation} '${concept}'`,
      language: 'english',
      source: 'thesaurus',
      tags: [concept],
      weight,
      note: `datamuse: ${relation}`,
    };
  };

  const seeds: Seed[] = [];
  for (const w of near) {
    const seed = make(w, 0.6, 'means like');
    if (seed) seeds.push(seed);
  }
  for (const w of assoc) {
    const seed = make(w, 0.72, 'associated with');
    if (seed) seeds.push(seed);
  }
  for (const w of adjectives) {
    const seed = make(w, 0.55, 'describes');
    if (seed) seeds.push(seed);
  }
  return seeds;
}
