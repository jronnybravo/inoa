/**
 * Grapheme-level phonology.
 *
 * We work on spelling rather than IPA on purpose: a brand name is experienced
 * as letters first (typed, read on a slide, spelled down a phone line), and
 * the failure modes we care about — illegal clusters, ambiguous vowels, names
 * nobody can spell back — all show up at this layer.
 */

export const VOWELS = new Set('aeiou');
export const SEMI_VOWELS = new Set('y');

/** Onset clusters English speakers produce without thinking. */
export const LEGAL_ONSETS = new Set([
  'bl', 'br', 'cl', 'cr', 'dr', 'fl', 'fr', 'gl', 'gr', 'pl', 'pr', 'sc', 'sk', 'sl', 'sm',
  'sn', 'sp', 'st', 'sw', 'tr', 'tw', 'th', 'sh', 'ch', 'ph', 'wh', 'wr', 'kn', 'gn', 'qu',
  'kr', 'kl', 'vr', 'vl', 'zl', 'dw', 'gw', 'kw', 'ts', 'ps', 'pn', 'mn', 'sv', 'sf',
  'scr', 'spr', 'str', 'spl', 'thr', 'shr', 'sch', 'squ', 'chr', 'phr',
]);

/** Codas that land cleanly at the end of a syllable. */
export const LEGAL_CODAS = new Set([
  'ct', 'ft', 'ld', 'lf', 'lk', 'lm', 'lp', 'lt', 'mp', 'nd', 'ng', 'nk', 'nt', 'pt', 'rb',
  'rd', 'rk', 'rl', 'rm', 'rn', 'rp', 'rt', 'sk', 'sp', 'st', 'th', 'sh', 'ch', 'ck', 'ss',
  'll', 'ff', 'zz', 'nce', 'nse', 'rth', 'lth', 'nch', 'rch', 'rst', 'nts', 'x',
]);

/** 'c' and 'q' are included: as letters they are realized as stops far more often than not. */
export const PLOSIVES = new Set('bcdgkpqt');
export const FRICATIVES = new Set(['f', 'v', 's', 'z', 'h', 'th', 'sh']);
export const SIBILANTS = new Set('szx');
export const NASALS = new Set('mn');
export const LIQUIDS = new Set('lr');
export const GLIDES = new Set('wy');

/** Front vowels read bright/small/fast; back vowels read deep/large/calm. */
export const FRONT_VOWELS = new Set('ie');
export const BACK_VOWELS = new Set('ou');
export const OPEN_VOWELS = new Set('ao');

/** Letter pairs that blur at small sizes or in condensed type. */
export const AWKWARD_PAIRS = ['rn', 'cl', 'vv', 'ii', 'll', 'nn', 'rnn', 'lj', 'jl', 'q'];

/** Vowel spellings a listener cannot reconstruct from sound alone. */
export const AMBIGUOUS_GRAPHEMES = ['ough', 'augh', 'eigh', 'aoi', 'uy', 'yi', 'ae', 'oe', 'eu'];

export interface Syllable {
  onset: string;
  nucleus: string;
  coda: string;
  text: string;
}

export interface PhonoProfile {
  word: string;
  syllables: Syllable[];
  syllableCount: number;
  /** 'CVCV', 'CVCCV'... using C/V per letter group. */
  cvPattern: string;
  vowelRatio: number;
  /** Onsets/codas that break English phonotactics. */
  illegalClusters: string[];
  maxClusterLength: number;
  ambiguous: string[];
  endsInVowel: boolean;
  /** Consecutive identical letters, e.g. 'zz' in 'buzz'. */
  doubles: number;
  letters: number;
}

function isVowel(ch: string): boolean {
  return VOWELS.has(ch) || SEMI_VOWELS.has(ch);
}

/**
 * Onset-maximizing syllabification: consonants between vowels attach to the
 * following syllable whenever they form a legal onset ('ma-tris', not 'mat-ris').
 */
export function syllabify(word: string): Syllable[] {
  const w = word.toLowerCase().replace(/[^a-z]/g, '');
  if (!w) return [];

  // Split into alternating consonant / vowel runs.
  const runs: { type: 'c' | 'v'; text: string }[] = [];
  for (const ch of w) {
    const type = isVowel(ch) ? 'v' : 'c';
    const last = runs.at(-1);
    if (last && last.type === type) last.text += ch;
    else runs.push({ type, text: ch });
  }

  const syllables: Syllable[] = [];
  let pendingOnset = runs[0]?.type === 'c' ? (runs.shift() as { text: string }).text : '';

  for (let i = 0; i < runs.length; i++) {
    const run = runs[i] as { type: 'c' | 'v'; text: string };
    if (run.type !== 'v') continue;
    const nucleus = run.text;
    const nextConsonants = runs[i + 1]?.type === 'c' ? (runs[i + 1] as { text: string }).text : '';
    const hasMoreVowels = runs.slice(i + 2).some((r) => r.type === 'v');

    let coda = '';
    let nextOnset = '';
    if (!hasMoreVowels) {
      coda = nextConsonants;
    } else if (nextConsonants.length <= 1) {
      nextOnset = nextConsonants;
    } else {
      // Give the next syllable the longest legal onset it can carry.
      let split = nextConsonants.length - 1;
      for (let take = Math.min(3, nextConsonants.length - 1); take >= 1; take--) {
        const cand = nextConsonants.slice(nextConsonants.length - take);
        if (LEGAL_ONSETS.has(cand)) {
          split = nextConsonants.length - take;
          break;
        }
      }
      coda = nextConsonants.slice(0, split);
      nextOnset = nextConsonants.slice(split);
    }

    syllables.push({
      onset: pendingOnset,
      nucleus,
      coda,
      text: pendingOnset + nucleus + coda,
    });
    pendingOnset = nextOnset;
  }

  // A word with no vowels at all ('xkr') still deserves one syllable.
  if (syllables.length === 0 && w) {
    syllables.push({ onset: w, nucleus: '', coda: '', text: w });
  }
  return syllables;
}

export function profile(word: string): PhonoProfile {
  const w = word.toLowerCase().replace(/[^a-z]/g, '');
  const syllables = syllabify(w);
  const vowelCount = [...w].filter((c) => isVowel(c)).length;

  const illegal: string[] = [];
  let maxCluster = 0;
  for (const s of syllables) {
    if (s.onset.length > 1 && !LEGAL_ONSETS.has(s.onset)) illegal.push(s.onset);
    if (s.coda.length > 1 && !LEGAL_CODAS.has(s.coda)) illegal.push(s.coda);
    maxCluster = Math.max(maxCluster, s.onset.length, s.coda.length);
  }

  const cvPattern = [...w].map((c) => (isVowel(c) ? 'V' : 'C')).join('');
  const ambiguous = AMBIGUOUS_GRAPHEMES.filter((g) => w.includes(g));
  const doubles = (w.match(/(.)\1/g) ?? []).length;

  return {
    word: w,
    syllables,
    syllableCount: Math.max(1, syllables.length),
    cvPattern,
    vowelRatio: w.length ? vowelCount / w.length : 0,
    illegalClusters: illegal,
    maxClusterLength: maxCluster,
    ambiguous,
    endsInVowel: isVowel(w.at(-1) ?? ''),
    doubles,
    letters: w.length,
  };
}

/** Fraction of letters drawn from a given class — used for sound symbolism. */
export function letterShare(word: string, set: Set<string>): number {
  const w = word.toLowerCase().replace(/[^a-z]/g, '');
  if (!w) return 0;
  return [...w].filter((c) => set.has(c)).length / w.length;
}
