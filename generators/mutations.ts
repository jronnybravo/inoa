/**
 * Stage 5: mutation.
 *
 * Take a name that is nearly right and breed it. Most descendants are worse —
 * that is fine and expected, the scorer kills them. What matters is that the
 * operators are *phonetically* motivated rather than random letter noise:
 * every one of them is a move a real brand has made.
 */

import { makeCandidate, join, type GenContext } from '../core/candidate.ts';
import { profile, syllabify, VOWELS } from '../core/phonology.ts';
import { unique } from '../core/text.ts';
import { BRAND_SUFFIXES } from '../data/morphemes.ts';
import type { Candidate } from '../core/types.ts';

const VOWEL_SHIFTS: Record<string, string[]> = {
  a: ['e', 'o'],
  e: ['a', 'i'],
  i: ['y', 'e'],
  o: ['a', 'u'],
  u: ['o', 'a'],
};

const CONSONANT_SWAPS: Record<string, string[]> = {
  c: ['k'],
  k: ['c', 'q'],
  s: ['z'],
  z: ['s'],
  f: ['v', 'ph'],
  v: ['f'],
  t: ['d'],
  d: ['t'],
  g: ['j'],
  j: ['g'],
  x: ['ks'],
};

interface Mutation {
  label: string;
  apply: (name: string, ctx: GenContext) => string[];
}

const MUTATIONS: Mutation[] = [
  {
    label: 'suffix swap',
    apply: (name, ctx) => {
      const stem = name.replace(/[aeiou]+$/, '');
      if (stem.length < 3) return [];
      return ctx.rng
        .sample(BRAND_SUFFIXES, 5)
        .map((s) => join(stem, s.form))
        .filter((f): f is string => Boolean(f));
    },
  },
  {
    label: 'vowel shift',
    apply: (name) => {
      const out: string[] = [];
      for (let i = 0; i < name.length; i++) {
        const ch = name[i] as string;
        for (const replacement of VOWEL_SHIFTS[ch] ?? []) {
          out.push(name.slice(0, i) + replacement + name.slice(i + 1));
        }
      }
      return out;
    },
  },
  {
    label: 'consonant swap',
    apply: (name) => {
      const out: string[] = [];
      for (let i = 0; i < name.length; i++) {
        const ch = name[i] as string;
        for (const replacement of CONSONANT_SWAPS[ch] ?? []) {
          out.push(name.slice(0, i) + replacement + name.slice(i + 1));
        }
      }
      return out;
    },
  },
  {
    label: 'consonant doubling',
    apply: (name) => {
      const out: string[] = [];
      // Doubling only reads as intentional in the middle of a word.
      for (let i = 1; i < name.length - 1; i++) {
        const ch = name[i] as string;
        if (VOWELS.has(ch) || ch === name[i + 1]) continue;
        if (!'bdfgklmnprstz'.includes(ch)) continue;
        out.push(name.slice(0, i) + ch + name.slice(i));
      }
      return out;
    },
  },
  {
    label: 'truncation',
    apply: (name) => {
      const syllables = syllabify(name);
      if (syllables.length < 3) return [];
      return [syllables.slice(0, -1).map((s) => s.text).join('')];
    },
  },
  {
    label: 'vowel drop',
    apply: (name) => {
      // The Flickr / Tumblr move: only legal on an unstressed final vowel.
      const m = name.match(/^(.*[bcdfgklmnprstv])e(r|l)$/);
      return m ? [`${m[1]}${m[2]}`] : [];
    },
  },
  {
    label: 'onset hardening',
    apply: (name) => {
      const first = name[0] as string;
      if (VOWELS.has(first)) return [`k${name}`, `v${name}`];
      return [];
    },
  },
  {
    label: 'reduplication',
    apply: (name) => {
      const syllables = syllabify(name);
      const first = syllables[0]?.text;
      // Only open CV syllables reduplicate into something wearable (Lulu, Coco,
      // Miro). A closed syllable gives you 'Ruhruhvio', which is not a name.
      if (!first || syllables.length > 2) return [];
      if (!/^[bcdfgklmnprstvz][aeiou]$/.test(first)) return [];
      if (name.length + first.length > 8) return [];
      return [first + name];
    },
  },
  {
    label: 'terminal vowel',
    apply: (name) => {
      if (VOWELS.has(name.at(-1) as string)) return [];
      return ['a', 'o', 'i'].map((v) => name + v);
    },
  },
  {
    label: 'internal elision',
    apply: (name) => {
      const syllables = syllabify(name);
      if (syllables.length < 3) return [];
      // Drop the middle syllable: 'veritana' -> 'vertana'.
      return [[syllables[0]!.text, ...syllables.slice(2).map((s) => s.text)].join('')];
    },
  },
];

/**
 * A name that still reads as two whole words is not bred.
 *
 * Every operator here reduces legibility, which is the entire value of a
 * transparent compound — and the damaged descendants were outranking their
 * parents. Truncation cut 'Warmvale' to 'Warmva'; a terminal vowel turned
 * 'Warmglow' into 'Warmglowo', which then took the top slot. Coinages have no
 * such structure to lose, so they are bred as before.
 */
function readsAsWords(candidate: Candidate): boolean {
  const intact = candidate.seeds.filter(
    (s) => s.form.length >= 3 && candidate.name.includes(s.form),
  );
  return new Set(intact.map((s) => s.form)).size >= 2;
}

/** Breed one candidate into descendants. */
export function mutate(parent: Candidate, ctx: GenContext, perParent = 12): Candidate[] {
  if (readsAsWords(parent)) return [];

  const out: Candidate[] = [];
  const seen = new Set([parent.name]);

  for (const mutation of ctx.rng.shuffle(MUTATIONS)) {
    for (const form of unique(mutation.apply(parent.name, ctx))) {
      if (seen.has(form)) continue;
      seen.add(form);

      const p = profile(form);
      if (p.illegalClusters.length > 0 || p.syllableCount > 4) continue;

      const candidate = makeCandidate(
        form,
        'mutation',
        parent.seeds,
        `${mutation.label} on ${parent.display} — ${parent.rationale}`,
        ctx,
        [...parent.lineage, parent.name],
      );
      if (candidate) out.push(candidate);
      if (out.length >= perParent) return out;
    }
  }
  return out;
}

/** Breed a whole generation from the surviving elite. */
export function mutateAll(parents: Candidate[], ctx: GenContext, perParent = 12): Candidate[] {
  return parents.flatMap((p) => mutate(p, ctx, perParent));
}
