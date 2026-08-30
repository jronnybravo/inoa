/**
 * Acronyms and syllabic abbreviations.
 *
 * Pure initialisms (IBM, BBC) are only ownable with a century of spend behind
 * them, so this generator only emits an acronym when the letters happen to form
 * a pronounceable word. The productive mode is the syllabic abbreviation —
 * MIcro+SOFT, NABISCO, FedEx — which reads as a coined word while still being
 * derived from something true about the company.
 */

import { makeCandidate, join, type GenContext } from '../core/candidate.ts';
import { profile } from '../core/phonology.ts';
import { normalize, unique } from '../core/text.ts';
import type { Candidate, Seed } from '../core/types.ts';

const STOP_WORDS = new Set([
  'a', 'an', 'and', 'the', 'of', 'for', 'to', 'in', 'on', 'with', 'that', 'is', 'are', 'be',
  'by', 'at', 'from', 'as', 'it', 'its', 'their', 'your', 'our',
]);

function contentWords(phrase: string): string[] {
  return phrase
    .toLowerCase()
    .split(/[^a-z]+/)
    .filter((w) => w.length > 1 && !STOP_WORDS.has(w));
}

/** Initialisms — kept only when they read as a word. */
export function generateAcronyms(phrases: string[], ctx: GenContext, limit = 20): Candidate[] {
  const out: Candidate[] = [];

  for (const phrase of phrases) {
    const words = contentWords(phrase);
    if (words.length < 3) continue;

    for (const window of [words.slice(0, 4), words.slice(0, 5), words.slice(1, 5)]) {
      if (window.length < 3) continue;
      const form = normalize(window.map((w) => w[0]).join(''));
      const p = profile(form);
      // The whole test: could a stranger say this without being told how?
      if (p.illegalClusters.length > 0 || p.vowelRatio < 0.3 || p.vowelRatio > 0.7) continue;

      const seed: Seed = {
        form,
        gloss: window.join(' '),
        language: 'english',
        source: 'brief',
        tags: [],
        weight: 0.5,
      };
      const candidate = makeCandidate(
        form,
        'acronym',
        [seed],
        `initials of "${window.join(' ')}" — reads as a word rather than letters`,
        ctx,
      );
      if (candidate) out.push(candidate);
      if (out.length >= limit) return out;
    }
  }
  return out;
}

/** Syllabic abbreviation: first syllable(s) of each word, fused. */
export function generateSyllabicAcronyms(
  phrases: string[],
  ctx: GenContext,
  limit = 30,
): Candidate[] {
  const out: Candidate[] = [];

  for (const phrase of phrases) {
    const words = contentWords(phrase);
    if (words.length < 2) continue;

    const forms: { form: string; parts: string[] }[] = [];
    for (let i = 0; i < words.length - 1; i++) {
      for (let j = i + 1; j < words.length; j++) {
        const a = words[i] as string;
        const b = words[j] as string;
        for (const [takeA, takeB] of [[3, 3], [4, 3], [3, 4], [2, 4]] as const) {
          const form = join(a.slice(0, takeA), b.slice(0, takeB));
          if (form) forms.push({ form, parts: [a, b] });
        }
      }
    }

    for (const { form, parts } of unique(forms, (f) => f.form)) {
      const p = profile(form);
      if (p.illegalClusters.length > 0 || p.syllableCount > 3) continue;

      const seed: Seed = {
        form,
        gloss: parts.join(' + '),
        language: 'english',
        source: 'brief',
        tags: [],
        weight: 0.5,
      };
      const candidate = makeCandidate(
        form,
        'acronym',
        [seed],
        `syllabic abbreviation of "${parts.join(' ')}" — the Microsoft/FedEx construction`,
        ctx,
      );
      if (candidate) out.push(candidate);
      if (out.length >= limit) return out;
    }
  }
  return out;
}
