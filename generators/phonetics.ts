/**
 * De novo invention from phonotactic templates.
 *
 * This is how Zeneca, Altria, Xerox and Verizon were built: choose a phoneme
 * inventory that carries the right feel, choose a syllable template that is
 * legal in the target languages, and fill it. Nothing here is random — the
 * inventories are curated by sound symbolism, and every output is checked
 * against the same phonotactic rules the rest of the engine uses.
 */

import { makeCandidate, type GenContext } from '../core/candidate.ts';
import { profile } from '../core/phonology.ts';
import { unique } from '../core/text.ts';
import type { Candidate, Seed } from '../core/types.ts';

interface Inventory {
  name: string;
  feel: string;
  onsets: string[];
  medials: string[];
  vowels: string[];
  codas: string[];
  tags: string[];
}

export const INVENTORIES: Inventory[] = [
  {
    name: 'luminous',
    feel: 'open, warm, premium — liquids and open vowels',
    onsets: ['l', 'm', 'n', 'v', 'r', 's', 'al', 'el', 'au'],
    medials: ['m', 'n', 'r', 'l', 'v', 'ri', 'mo', 'na', 'le'],
    vowels: ['a', 'e', 'o', 'ia', 'io', 'ea'],
    codas: ['', '', 'n', 'l', 'r'],
    tags: ['calm', 'premium', 'light', 'warmth', 'care', 'trust'],
  },
  {
    name: 'precise',
    feel: 'clipped, engineered — plosives and front vowels',
    onsets: ['k', 't', 'p', 'd', 'g', 'kr', 'tr', 'pr', 'ax'],
    medials: ['t', 'k', 'd', 'v', 'x', 'kt', 'st', 'nd'],
    vowels: ['i', 'e', 'a', 'o'],
    codas: ['', 'x', 't', 'k', 'n'],
    tags: ['precision', 'speed', 'intelligence', 'structure', 'proof'],
  },
  {
    name: 'grounded',
    feel: 'solid, plain-spoken — stops and closed syllables',
    onsets: ['b', 'd', 'g', 'h', 'k', 'm', 'br', 'gr', 'st'],
    medials: ['d', 'k', 'm', 'nd', 'rt', 'lt', 'st'],
    vowels: ['a', 'o', 'u', 'e'],
    codas: ['n', 'k', 't', 'd', 'r', ''],
    tags: ['strength', 'stability', 'home', 'craft', 'endurance'],
  },
  {
    name: 'airy',
    feel: 'light, fast, weightless — fricatives and high vowels',
    onsets: ['f', 's', 'v', 'z', 'h', 'fl', 'sv', 'ai'],
    medials: ['f', 's', 'v', 'r', 'ri', 'fi', 'so'],
    vowels: ['i', 'e', 'a', 'ai', 'ei'],
    codas: ['', '', 'r', 's'],
    tags: ['speed', 'flow', 'freedom', 'lightness', 'motion'],
  },
  {
    name: 'mythic',
    feel: 'old, elevated, storied — Norse and classical textures',
    onsets: ['th', 'v', 'br', 'sk', 'r', 'h', 'y', 'or'],
    medials: ['dr', 'nd', 'rn', 'lv', 'th', 'gr'],
    vowels: ['a', 'o', 'e', 'u', 'ei'],
    codas: ['r', 'n', 'l', 'th', ''],
    tags: ['origin', 'wonder', 'authority', 'memory', 'protection'],
  },
];

/** Syllable templates, weighted toward the two- and three-beat shapes that scan. */
const TEMPLATES: string[][] = [
  ['O', 'V', 'M', 'V'],
  ['O', 'V', 'M', 'V', 'C'],
  ['O', 'V', 'M', 'V', 'M', 'V'],
  ['V', 'M', 'V', 'C'],
  ['O', 'V', 'C'],
  ['O', 'V', 'M', 'V', 'M', 'V', 'C'],
];

function pickInventory(tags: string[], ctx: GenContext): Inventory {
  const scored = INVENTORIES.map((inv) => ({
    inv,
    score: inv.tags.filter((t) => tags.includes(t)).length,
  }));
  const best = Math.max(...scored.map((s) => s.score));
  const pool = best > 0 ? scored.filter((s) => s.score === best).map((s) => s.inv) : INVENTORIES;
  return ctx.rng.pick(pool);
}

function build(inv: Inventory, ctx: GenContext): string {
  const template = ctx.rng.pick(TEMPLATES);
  let out = '';
  for (const slot of template) {
    if (slot === 'O') out += ctx.rng.pick(inv.onsets);
    else if (slot === 'V') out += ctx.rng.pick(inv.vowels);
    else if (slot === 'M') out += ctx.rng.pick(inv.medials);
    else out += ctx.rng.pick(inv.codas);
  }
  return out;
}

/** Pure invention, guided only by the feel the brief needs. */
export function generateInvented(tags: string[], ctx: GenContext, limit = 60): Candidate[] {
  const out: Candidate[] = [];
  const attempts = limit * 12;

  for (let i = 0; i < attempts && out.length < limit; i++) {
    const inv = pickInventory(tags, ctx);
    const form = build(inv, ctx);
    const p = profile(form);
    if (p.illegalClusters.length > 0) continue;
    if (p.syllableCount < 2 || p.syllableCount > 3) continue;
    if (p.letters < 4 || p.letters > 9) continue;
    if (p.doubles > 0) continue;

    const seed: Seed = {
      form,
      gloss: `invented from the ${inv.name} inventory`,
      language: 'english',
      source: 'brief',
      tags: inv.tags,
      weight: 0.5,
      note: inv.feel,
    };
    const candidate = makeCandidate(
      form,
      'invented',
      [seed],
      `coined from the ${inv.name} sound palette — ${inv.feel}`,
      ctx,
    );
    if (candidate) out.push(candidate);
  }
  return unique(out, (c) => c.name);
}

/**
 * Invention anchored to a real root: keep the first syllable so the name still
 * means something, invent the rest so it is ownable.
 */
export function generateAnchoredInventions(
  seeds: Seed[],
  ctx: GenContext,
  limit = 40,
): Candidate[] {
  const out: Candidate[] = [];
  const pool = ctx.rng.shuffle(seeds.filter((s) => s.form.length >= 3));

  for (const seed of pool) {
    const inv = pickInventory(seed.tags, ctx);
    const head = seed.form.slice(0, seed.form.search(/[aeiou](?=[^aeiou])/) + 2 || 3);
    if (head.length < 2) continue;

    for (let attempt = 0; attempt < 4; attempt++) {
      const tail = ctx.rng.pick(inv.medials) + ctx.rng.pick(inv.vowels) + ctx.rng.pick(inv.codas);
      const form = head + tail;
      const p = profile(form);
      if (p.illegalClusters.length > 0 || p.syllableCount > 3 || p.letters > 10) continue;

      const candidate = makeCandidate(
        form,
        'invented',
        [seed],
        `built on '${head}' from ${seed.form} (${seed.gloss}), completed in the ${inv.name} palette`,
        ctx,
      );
      if (candidate) out.push(candidate);
      if (out.length >= limit) return unique(out, (c) => c.name);
    }
  }
  return unique(out, (c) => c.name);
}
