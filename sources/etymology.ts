/**
 * Etymology source.
 *
 * Roots are the highest-yield naming material there is: they carry meaning,
 * they are already short, and they combine without sounding like a compound
 * ('Verita', 'Novara', 'Lumora'). The curated morpheme bank is the primary
 * source; Wiktionary supplies real etymologies for words we want to justify.
 */

import { getJSON } from '../core/net.ts';
import { briefRelevance, usageDecay } from '../core/text.ts';
import { MORPHEMES, type Morpheme } from '../data/morphemes.ts';
import type { Rng } from '../core/rng.ts';
import type { Language, Seed } from '../core/types.ts';

/**
 * Morphemes whose tags overlap the brief.
 *
 * Drawn by weight rather than taken as a strict top-N: with a strict cut, every
 * seed pulled the same roots and only the assembly order changed, so two runs
 * of the same brief kept returning the same handful of stems.
 */
export function rootsFor(
  tags: string[],
  limit = 40,
  rng?: Rng,
  vocabulary: Set<string> = new Set(),
  usage?: Map<string, number>,
): Morpheme[] {
  const wanted = new Set(tags.map((t) => t.toLowerCase()));
  const scored = MORPHEMES.map((m) => ({
    m,
    score: briefRelevance(m, wanted, vocabulary) + m.beauty,
  })).filter((r) => r.score > 1);

  if (!rng) return scored.sort((a, b) => b.score - a.score).slice(0, limit).map((r) => r.m);
  // Squared, so on-brief roots still dominate — this widens the draw, it does
  // not flatten it.
  return rng
    .weighted(scored, (r) => r.score ** 2 * usageDecay(r.m.form, usage), limit)
    .map((r) => r.m);
}

export function rootsByLanguage(language: Language): Morpheme[] {
  return MORPHEMES.filter((m) => m.language === language);
}

export function morphemeSeeds(
  tags: string[],
  limit = 40,
  rng?: Rng,
  vocabulary?: Set<string>,
  usage?: Map<string, number>,
): Seed[] {
  return rootsFor(tags, limit, rng, vocabulary, usage).map((m) => ({
    form: m.form,
    gloss: m.gloss,
    language: m.language,
    source: 'etymology',
    tags: m.tags,
    weight: 0.5 + m.beauty * 0.5,
    note: `${m.language} ${m.role === 'free' ? 'word' : m.role} — ${m.gloss}`,
  }));
}

/**
 * Real etymology text from Wiktionary, for the report's reasoning section.
 * Best-effort: returns undefined offline or when the page has no etymology.
 */
export async function etymologyOf(word: string): Promise<string | undefined> {
  const page = encodeURIComponent(word.toLowerCase());
  const data = await getJSON<{ parse?: { wikitext?: { '*'?: string } } }>(
    `https://en.wiktionary.org/w/api.php?action=parse&page=${page}&prop=wikitext&formatversion=2&format=json`,
    { cacheFailures: true, timeoutMs: 7000 },
  );
  const wikitext = data?.parse?.wikitext?.['*'] ?? (data?.parse?.wikitext as unknown as string);
  if (typeof wikitext !== 'string') return undefined;

  const section = wikitext.split(/===?\s*Etymology[^=]*=+/)[1];
  if (!section) return undefined;
  const text = section
    .split(/\n=/)[0]
    ?.replace(/\{\{[^}]*\}\}/g, (m) => {
      // Template arguments usually hold the actual root, e.g. {{der|en|la|lumen}}.
      const parts = m.slice(2, -2).split('|').filter((p) => p && !p.includes('='));
      return parts.slice(2).join(' ');
    })
    .replace(/\[\[([^\]|]*\|)?([^\]]*)\]\]/g, '$2')
    .replace(/''+/g, '')
    .replace(/<[^>]*>/g, '')
    .replace(/\s+/g, ' ')
    .trim();

  if (!text || text.length < 12) return undefined;
  return text.slice(0, 320);
}
