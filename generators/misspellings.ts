/**
 * Deliberate respelling.
 *
 * The point is ownership: 'Lyft' and 'Flickr' say exactly what their real-word
 * originals say, but they are ownable and the domain exists. The constraint
 * that makes this work — and that most respellings violate — is that the sound
 * must not change. If a listener cannot spell it back after hearing it, the
 * respelling has cost more than it bought.
 */

import { makeCandidate, type GenContext } from '../core/candidate.ts';
import { profile } from '../core/phonology.ts';
import { soundKey, unique } from '../core/text.ts';
import type { Candidate, Seed } from '../core/types.ts';

interface Respelling {
  from: RegExp;
  to: string;
  label: string;
  /** Cost to spellability, 0..1. Higher means harder to reconstruct by ear. */
  cost: number;
}

const RULES: Respelling[] = [
  { from: /ck/g, to: 'k', label: 'ck → k', cost: 0.1 },
  { from: /c(?=[aou])/g, to: 'k', label: 'hard c → k', cost: 0.2 },
  { from: /qu/g, to: 'kw', label: 'qu → kw', cost: 0.35 },
  { from: /ph/g, to: 'f', label: 'ph → f', cost: 0.15 },
  { from: /x$/g, to: 'ks', label: 'x → ks', cost: 0.3 },
  { from: /s$/g, to: 'z', label: 'final s → z', cost: 0.3 },
  { from: /er$/g, to: 'r', label: 'dropped final e', cost: 0.4 },
  { from: /e$/g, to: '', label: 'dropped silent e', cost: 0.25 },
  { from: /ee/g, to: 'i', label: 'ee → i', cost: 0.3 },
  { from: /oo/g, to: 'u', label: 'oo → u', cost: 0.3 },
  { from: /igh/g, to: 'y', label: 'igh → y', cost: 0.35 },
  { from: /y$/g, to: 'i', label: 'final y → i', cost: 0.25 },
  { from: /i(?=[bcdfgklmnprstv][aeiou])/g, to: 'y', label: 'i → y', cost: 0.3 },
  { from: /(?<=[a-z])s(?=[aeiou])/g, to: 'z', label: 'medial s → z', cost: 0.35 },
];

export function generateMisspellings(seeds: Seed[], ctx: GenContext, limit = 40): Candidate[] {
  const out: Candidate[] = [];
  const pool = ctx.rng.shuffle(seeds.filter((s) => s.form.length >= 4 && s.form.length <= 10));

  for (const seed of pool) {
    const applied: { form: string; labels: string[]; cost: number }[] = [];

    for (const rule of RULES) {
      if (!rule.from.test(seed.form)) continue;
      rule.from.lastIndex = 0;
      const form = seed.form.replace(rule.from, rule.to);
      if (form !== seed.form) applied.push({ form, labels: [rule.label], cost: rule.cost });
    }

    // One combined two-rule variant per seed — stacking further gets illegible.
    if (applied.length >= 2) {
      const [first, second] = [applied[0]!, applied[1]!];
      const both = RULES.reduce((form, rule) => {
        rule.from.lastIndex = 0;
        return second.labels.includes(rule.label) ? form.replace(rule.from, rule.to) : form;
      }, first.form);
      if (both !== first.form) {
        applied.push({
          form: both,
          labels: [...first.labels, ...second.labels],
          cost: Math.min(0.85, first.cost + second.cost),
        });
      }
    }

    for (const variant of unique(applied, (v) => v.form)) {
      // The whole trade only pays off if the sound survives.
      if (soundKey(variant.form) !== soundKey(seed.form)) continue;
      const p = profile(variant.form);
      if (p.illegalClusters.length > 0) continue;

      const candidate = makeCandidate(
        variant.form,
        'misspelling',
        [seed],
        `'${seed.form}' respelled (${variant.labels.join(', ')}) — same sound, ownable spelling`,
        ctx,
        [seed.form],
      );
      if (!candidate) continue;
      if (variant.cost > 0.5) {
        candidate.risks.push('respelling is aggressive — expect to spell it out loud constantly');
      }
      out.push(candidate);
      if (out.length >= limit) return out;
    }
  }
  return out;
}
