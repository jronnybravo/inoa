/**
 * Translation source (Stage 2).
 *
 * The rule from the brief is 'never force foreign words'. That is enforced
 * structurally: this source can only return entries a human already vetted for
 * beauty and pronounceability, and it refuses to hand back a word whose
 * romanization an English speaker would stumble over.
 */

import { LEXICON, type LexEntry } from '../data/lexicon.ts';
import { profile } from '../core/phonology.ts';
import { briefRelevance, usageDecay } from '../core/text.ts';
import type { Rng } from '../core/rng.ts';
import type { Language, Seed } from '../core/types.ts';

/** Reject anything with an illegal cluster or an unreadable vowel spelling. */
function readableInLatinScript(entry: LexEntry): boolean {
  const p = profile(entry.form);
  return p.illegalClusters.length === 0 && p.ambiguous.length === 0 && p.syllableCount <= 4;
}

/** Drawn by weight so a new seed reaches different entries. */
export function translationsFor(
  tags: string[],
  limit = 30,
  rng?: Rng,
  vocabulary: Set<string> = new Set(),
  usage?: Map<string, number>,
): LexEntry[] {
  const wanted = new Set(tags.map((t) => t.toLowerCase()));
  const scored = LEXICON.filter(readableInLatinScript)
    .map((e) => ({ e, score: briefRelevance(e, wanted, vocabulary) + e.beauty }))
    .filter((r) => r.score > 1.2);

  if (!rng) return scored.sort((a, b) => b.score - a.score).slice(0, limit).map((r) => r.e);
  return rng
    .weighted(scored, (r) => r.score ** 2 * usageDecay(r.e.form, usage), limit)
    .map((r) => r.e);
}

export function byLanguage(language: Language): LexEntry[] {
  return LEXICON.filter((e) => e.language === language);
}

export function translationSeeds(
  tags: string[],
  limit = 30,
  rng?: Rng,
  vocabulary?: Set<string>,
  usage?: Map<string, number>,
): Seed[] {
  return translationsFor(tags, limit, rng, vocabulary, usage).map((e) => ({
    form: e.form,
    native: e.native,
    gloss: e.gloss,
    language: e.language,
    source: 'translation',
    tags: e.tags,
    weight: 0.55 + e.beauty * 0.45,
    note: `${e.language}${e.native ? ` (${e.native})` : ''} — ${e.gloss}`,
  }));
}

/** Every vetted way to say a concept, across the language set. */
export function sayItIn(tag: string): LexEntry[] {
  return LEXICON.filter((e) => e.tags.includes(tag) && readableInLatinScript(e));
}
