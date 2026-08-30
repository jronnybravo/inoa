/** Candidate construction and the joining rules every generator shares. */

import { normalize, titleCase } from './text.ts';
import { LEGAL_ONSETS, VOWELS } from './phonology.ts';
import type { Rng } from './rng.ts';
import type { BrandDNA, Candidate, Philosophy, Seed, Strategy } from './types.ts';

export interface GenContext {
  dna: BrandDNA;
  philosophy: Philosophy;
  cycle: number;
  rng: Rng;
}

export function makeCandidate(
  name: string,
  strategy: Strategy,
  seeds: Seed[],
  rationale: string,
  ctx: GenContext,
  lineage: string[] = [],
): Candidate | undefined {
  const clean = normalize(name);
  if (clean.length < 3 || clean.length > 14) return undefined;

  // A transformation that returns its own input is not a candidate. The suffix
  // generator was emitting bare dictionary words this way: join('plaza', 'a')
  // elides the doubled vowel and hands back 'plaza', which then scored as a
  // coined name while being an unownable common noun.
  if (
    strategy !== 'real-word' &&
    strategy !== 'symbolic' &&
    seeds.length === 1 &&
    clean === normalize(seeds[0]?.form ?? '')
  ) {
    return undefined;
  }
  // A name with no vowel cannot be spoken; a name that is all vowels cannot be typed.
  const vowels = [...clean].filter((c) => VOWELS.has(c)).length;
  if (vowels === 0 || vowels === clean.length) return undefined;
  return {
    name: clean,
    display: titleCase(clean),
    strategy,
    philosophy: ctx.philosophy,
    seeds,
    lineage,
    rationale,
    risks: [],
    cycle: ctx.cycle,
  };
}

const isVowel = (ch: string | undefined) => !!ch && VOWELS.has(ch);
/** 'y' closes a syllable as a vowel does, so 'clay' needs no help joining. */
const endsOpen = (word: string) => isVowel(word.at(-1)) || word.endsWith('y');

/**
 * Join two forms the way a native speaker would slur them together.
 *
 * Handles the four seams that make compounds sound manufactured: doubled
 * letters, vowel collisions, illegal consonant clusters, and stacked syllables
 * that push the word past what anyone will say out loud.
 */
export function join(a: string, b: string): string | undefined {
  let left = normalize(a);
  let right = normalize(b);
  if (!left || !right) return undefined;

  const lastL = left.at(-1) as string;
  const firstR = right[0] as string;

  if (lastL === firstR) {
    // 'lumen' + 'nexus' -> 'lumenexus', not 'lumennexus'.
    right = right.slice(1);
  } else if (isVowel(lastL) && isVowel(firstR)) {
    // 'aura' + 'ora' -> 'aurora': elide the left vowel rather than stacking.
    left = left.slice(0, -1);
  } else if (!endsOpen(left) && !isVowel(firstR)) {
    const seam = lastL + firstR;
    if (!LEGAL_ONSETS.has(seam) && !/^[lrmns]/.test(firstR) && !/[lrmns]$/.test(left)) {
      // 'flux' + 'grid' -> 'fluxagrid': a linking vowel rescues the cluster.
      left += 'a';
    }
  }

  const joined = left + right;
  if (joined.length < 4 || joined.length > 13) return undefined;
  if (/(.)\1\1/.test(joined)) return undefined;
  return joined;
}

/**
 * Trim a form to its first n letters, ending on something sayable.
 *
 * 'y' counts as a vowel here even though it does not elsewhere: it is the
 * nucleus of the syllable it sits in ('sym-', 'myr-'), and treating it as a
 * consonant made this strip real stems down to fragments — 'symbol' came back
 * as 'sy', which `join` then padded into the meaningless 'sya-'.
 */
export function clip(form: string, maxLetters: number): string {
  const w = normalize(form);
  if (w.length <= maxLetters) return w;
  const nucleus = (ch: string | undefined) => !!ch && (VOWELS.has(ch) || ch === 'y');

  let out = w.slice(0, maxLetters);
  // Never end a clip on a cluster that cannot close a syllable.
  while (out.length > 3 && !nucleus(out.at(-1)) && !nucleus(out.at(-2))) {
    out = out.slice(0, -1);
  }
  // A stem with no nucleus at all cannot be pronounced or extended.
  return nucleus(out.at(-1)) || [...out].some((c) => nucleus(c)) ? out : w.slice(0, maxLetters + 1);
}
