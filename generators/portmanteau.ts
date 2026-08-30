/**
 * Portmanteau generation.
 *
 * A real portmanteau is not two words glued together — it is two words that
 * share material and fuse at the overlap ('smoke'+'fog' = 'smog'). We find the
 * genuine overlaps first, and fall back to syllable splicing when there are
 * none, which is how most brand blends are actually built.
 */

import { makeCandidate, type GenContext } from '../core/candidate.ts';
import { profile, syllabify } from '../core/phonology.ts';
import { unique } from '../core/text.ts';
import type { Candidate, Seed } from '../core/types.ts';

/** Longest suffix of `a` that is also a prefix of `b`. */
function overlapLength(a: string, b: string): number {
  const max = Math.min(a.length - 1, b.length - 1, 4);
  for (let n = max; n >= 2; n--) {
    if (a.slice(-n) === b.slice(0, n)) return n;
  }
  return 0;
}

/** Fuse at the shared material: 'lumen' + 'menara' -> 'lumenara'. */
function fuse(a: string, b: string): string | undefined {
  const n = overlapLength(a, b);
  if (n === 0) return undefined;
  return a + b.slice(n);
}

/** Head of one word + tail of another, cut at syllable boundaries. */
function splice(a: string, b: string): string[] {
  const sa = syllabify(a);
  const sb = syllabify(b);
  if (sa.length < 1 || sb.length < 1) return [];
  const out: string[] = [];

  const headOptions = sa.length >= 2 ? [sa[0]!.text, sa[0]!.text + sa[1]!.text] : [sa[0]!.text];
  const tailOptions =
    sb.length >= 2 ? [sb.at(-1)!.text, sb.slice(-2).map((s) => s.text).join('')] : [sb[0]!.text];

  for (const head of headOptions) {
    for (const tail of tailOptions) {
      if (!head || !tail) continue;
      // Refuse a splice that just reassembles one of the inputs.
      const joined = head + tail;
      if (joined === a || joined === b) continue;
      out.push(joined);
    }
  }
  return out;
}

export function generatePortmanteaus(seeds: Seed[], ctx: GenContext, limit = 60): Candidate[] {
  const pool = ctx.rng.shuffle(seeds.filter((s) => s.form.length >= 4 && s.form.length <= 10));
  const out: Candidate[] = [];

  for (let i = 0; i < pool.length; i++) {
    for (let j = 0; j < pool.length; j++) {
      if (i === j) continue;
      const a = pool[i] as Seed;
      const b = pool[j] as Seed;

      const fused = fuse(a.form, b.form);
      const spliced = splice(a.form, b.form);
      const forms = unique([fused, ...spliced].filter((f): f is string => Boolean(f)));

      for (const form of forms) {
        const p = profile(form);
        if (p.illegalClusters.length > 0 || p.syllableCount > 4 || p.letters > 12) continue;
        const isTrueFusion = form === fused;
        const candidate = makeCandidate(
          form,
          'portmanteau',
          [a, b],
          isTrueFusion
            ? `${a.form} and ${b.form} fused at their shared sound — ${a.gloss} carried into ${b.gloss}`
            : `head of ${a.form} (${a.gloss}) spliced to the tail of ${b.form} (${b.gloss})`,
          ctx,
        );
        if (candidate) out.push(candidate);
        if (out.length >= limit) return out;
      }
    }
  }
  return out;
}
