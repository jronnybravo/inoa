/** String utilities shared by generators, analyzers and validators. */

const DIACRITICS = /[̀-ͯ]/g;

/** Romanize, strip accents, keep a-z only. Everything upstream feeds through this. */
export function normalize(input: string): string {
  return input
    .normalize('NFD')
    .replace(DIACRITICS, '')
    .toLowerCase()
    .replace(/[^a-z]/g, '');
}

export function titleCase(word: string): string {
  return word.charAt(0).toUpperCase() + word.slice(1);
}

export function unique<T>(items: T[], key: (item: T) => string = (i) => String(i)): T[] {
  const seen = new Set<string>();
  const out: T[] = [];
  for (const item of items) {
    const k = key(item);
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(item);
  }
  return out;
}

export function clamp(value: number, min = 0, max = 100): number {
  return Math.max(min, Math.min(max, value));
}

/** Map a raw value in [lo, hi] onto a 0..100 score. */
export function scale(value: number, lo: number, hi: number): number {
  if (hi === lo) return 50;
  return clamp(((value - lo) / (hi - lo)) * 100);
}

export function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const curr = [i];
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      curr[j] = Math.min(
        (curr[j - 1] as number) + 1,
        (prev[j] as number) + 1,
        (prev[j - 1] as number) + cost,
      );
    }
    prev = curr;
  }
  return prev[b.length] as number;
}

/** 0..1 similarity, length-normalized. */
export function editSimilarity(a: string, b: string): number {
  const max = Math.max(a.length, b.length);
  if (max === 0) return 1;
  return 1 - levenshtein(a, b) / max;
}

/** Jaro-Winkler — better than edit distance at catching brand look-alikes. */
export function jaroWinkler(a: string, b: string): number {
  if (a === b) return 1;
  if (!a.length || !b.length) return 0;
  const window = Math.max(0, Math.floor(Math.max(a.length, b.length) / 2) - 1);
  const aFlags = new Array<boolean>(a.length).fill(false);
  const bFlags = new Array<boolean>(b.length).fill(false);
  let matches = 0;
  for (let i = 0; i < a.length; i++) {
    const start = Math.max(0, i - window);
    const end = Math.min(i + window + 1, b.length);
    for (let j = start; j < end; j++) {
      if (bFlags[j] || a[i] !== b[j]) continue;
      aFlags[i] = true;
      bFlags[j] = true;
      matches++;
      break;
    }
  }
  if (matches === 0) return 0;
  let transpositions = 0;
  let k = 0;
  for (let i = 0; i < a.length; i++) {
    if (!aFlags[i]) continue;
    while (!bFlags[k]) k++;
    if (a[i] !== b[k]) transpositions++;
    k++;
  }
  transpositions /= 2;
  const jaro =
    (matches / a.length + matches / b.length + (matches - transpositions) / matches) / 3;
  let prefix = 0;
  while (prefix < 4 && prefix < a.length && prefix < b.length && a[prefix] === b[prefix]) prefix++;
  return jaro + prefix * 0.1 * (1 - jaro);
}

/**
 * A phonetic key for "do these two names sound alike" — the test a trademark
 * examiner applies.
 *
 * Consonants are normalized across their common spellings (ph/f, ck/k, z/s),
 * but the vowel skeleton is deliberately *kept*. Metaphone-style algorithms
 * drop vowels because they are built for surname matching, where the consonant
 * frame carries the identity. Brand names are the opposite case: vowels are
 * most of what a listener retains, and discarding them collapses 'Solace' onto
 * 'Slack' and 'Aurora' onto 'Oura' — which turns collision detection into an
 * indiscriminate veto.
 */
export function soundKey(word: string): string {
  let w = normalize(word);
  if (!w) return '';
  w = w
    .replace(/^(kn|gn|pn|wr)/, (m) => m[1] as string)
    .replace(/^x/, 's')
    .replace(/^wh/, 'w');
  return w
    .replace(/ph/g, 'f')
    .replace(/gh/g, 'g')
    .replace(/ck/g, 'k')
    .replace(/sch/g, 'sk')
    .replace(/sh/g, 'x')
    .replace(/ch/g, 'x')
    .replace(/th/g, '0')
    .replace(/c([iey])/g, 's$1')
    .replace(/[cq]/g, 'k')
    .replace(/z/g, 's')
    .replace(/x/g, 'ks')
    .replace(/[vw]/g, 'f')
    .replace(/y/g, 'i')
    .replace(/h/g, '')
    // Silent final e, then collapse vowel runs and doubled letters.
    .replace(/([bcdfgklmnprstv])e$/, '$1')
    .replace(/[aeiou]+/g, (m) => m[0] as string)
    .replace(/(.)\1+/g, '$1');
}

/** Do two names collide to the ear? 0..1. */
export function phoneticSimilarity(a: string, b: string): number {
  const ka = soundKey(a);
  const kb = soundKey(b);
  if (!ka || !kb) return 0;
  return Math.max(editSimilarity(ka, kb), jaroWinkler(ka, kb) * 0.95);
}

export function ngrams(word: string, n: number): string[] {
  const padded = `^${word}$`;
  const out: string[] = [];
  for (let i = 0; i + n <= padded.length; i++) out.push(padded.slice(i, i + n));
  return out;
}

/**
 * How strongly a bank entry answers this brief.
 *
 * Tag overlap alone was the whole story, which meant any brief outside the
 * hand-written keyword map fell back to the same four generic tags and drew the
 * same material — a mortgage brief and a nonsense brief produced half the same
 * shortlist. Matching the entry's own word and gloss against the vocabulary the
 * brief actually expanded into makes the banks respond to briefs nobody
 * anticipated.
 */
export function briefRelevance(
  entry: { form: string; gloss: string; tags: string[] },
  wantedTags: Set<string>,
  vocabulary: Set<string>,
): number {
  const tagOverlap = entry.tags.filter((t) => wantedTags.has(t)).length;
  const formHit = vocabulary.has(entry.form) ? 1 : 0;
  const glossHit = entry.gloss
    .toLowerCase()
    .split(/[^a-z]+/)
    .some((w) => w.length >= 4 && vocabulary.has(w))
    ? 1
    : 0;
  return tagOverlap * 2 + formHit * 2.5 + glossHit * 1.5;
}

/**
 * How much to discount material that earlier runs already spent.
 *
 * Blocking a repeated name does not stop the same word being reused to build a
 * new one: 'freya' appeared in ten of one hundred and forty names across six
 * unrelated briefs, because short, vowel-final, high-beauty words win every
 * draw no matter what the brief says.
 *
 * Squared rather than linear. A linear decay leaves a word used once surviving
 * half of all later draws, which over six briefs still puts it in three of them
 * — arithmetically correct and far too weak to feel like a fix. Squared drops
 * that to a quarter, then a ninth, and still never bans a word outright: a word
 * that genuinely fits a brief can always come back.
 */
export function usageDecay(form: string, usage: Map<string, number> | undefined): number {
  const used = usage?.get(form) ?? 0;
  return used === 0 ? 1 : 1 / (1 + used) ** 2;
}

/**
 * Is this a verb wearing an adjective's clothes?
 *
 * English lets participles and gerunds modify a noun — 'soaked cloth', 'writing
 * table' — so both corpus collocation data and part-of-speech tagging report
 * them as adjectival. They are not adjectives, and in a brand name they read as
 * a half-finished sentence: 'Soakedmart', 'Fearedsol', 'Packedforge'.
 *
 * A superlative fails for a different reason. 'Bestforge' is a claim rather than
 * a name, and it is the kind of claim a trademark examiner refuses.
 */
export function isInflectedForm(word: string): boolean {
  return /(?:ed|ing|est)$/.test(word);
}

export function countSyllablesRough(word: string): number {
  const groups = normalize(word).match(/[aeiouy]+/g);
  if (!groups) return 1;
  let count = groups.length;
  // Silent trailing 'e' as in 'stride' — but not 'the' or 'apple'.
  if (/[^aeiouy]e$/.test(word) && count > 1) count--;
  return Math.max(1, count);
}
