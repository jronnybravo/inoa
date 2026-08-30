/**
 * Concept source (Stage 3).
 *
 * Selects from the curated cross-domain bank by brief overlap, and — this is
 * the important part — deliberately injects concepts from domains the brief
 * never mentioned. A brief about scheduling software will never say 'tide' or
 * 'cadence'; that is exactly why those are where the good names are.
 */

import { CONCEPTS, type Concept } from '../data/concepts.ts';
import { briefRelevance, usageDecay } from '../core/text.ts';
import type { Rng } from '../core/rng.ts';
import type { ConceptDomain, Seed } from '../core/types.ts';

/** Drawn by weight so a new seed reaches different concepts. */
export function conceptsFor(
  tags: string[],
  limit = 40,
  rng?: Rng,
  vocabulary: Set<string> = new Set(),
  usage?: Map<string, number>,
): Concept[] {
  const wanted = new Set(tags.map((t) => t.toLowerCase()));
  const scored = CONCEPTS.map((c) => ({
    c,
    score:
      briefRelevance({ form: c.term, gloss: c.meaning, tags: c.tags }, wanted, vocabulary) +
      c.beauty,
  })).filter((r) => r.score > 1.4);

  if (!rng) return scored.sort((a, b) => b.score - a.score).slice(0, limit).map((r) => r.c);
  return rng
    .weighted(scored, (r) => r.score ** 2 * usageDecay(r.c.term, usage), limit)
    .map((r) => r.c);
}

export function conceptsInDomain(domain: ConceptDomain): Concept[] {
  return CONCEPTS.filter((c) => c.domain === domain);
}

export function conceptSeeds(
  tags: string[],
  limit = 40,
  rng?: Rng,
  vocabulary?: Set<string>,
  usage?: Map<string, number>,
): Seed[] {
  return conceptsFor(tags, limit, rng, vocabulary, usage).map(toSeed);
}

/**
 * Concepts from domains the brief has nothing to do with. The lateral move that
 * separates 'TaskFlow' from 'Cadence'.
 */
export function lateralSeeds(
  tags: string[],
  rng: Rng,
  count = 12,
  usage?: Map<string, number>,
): Seed[] {
  const onBrief = new Set(conceptsFor(tags, 60).map((c) => c.term));
  const pool = CONCEPTS.filter((c) => !onBrief.has(c.term) && c.beauty >= 0.74);
  // This draw is deliberately independent of the brief — that is the point of a
  // lateral concept — which is exactly why it needs the usage decay. Otherwise
  // the same handful of pretty words arrive whatever the subject.
  return rng.weighted(pool, (c) => usageDecay(c.term, usage), count).map((c) => ({
    ...toSeed(c),
    weight: 0.65,
    note: `lateral from ${c.domain} — ${c.meaning}`,
  }));
}

function toSeed(c: Concept): Seed {
  return {
    form: c.term,
    gloss: c.meaning,
    language: 'english',
    source: 'concept',
    domain: c.domain,
    tags: c.tags,
    weight: 0.55 + c.beauty * 0.45,
    note: `${c.domain} — ${c.meaning}`,
  };
}
