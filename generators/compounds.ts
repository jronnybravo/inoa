/**
 * Compound generation.
 *
 * Two kinds. Transparent compounds pair whole English words ('Keystone',
 * 'Lodestar') and read instantly. Root compounds fuse combining forms
 * ('Lumora', 'Veranex') and read as invented while still carrying meaning.
 *
 * The generator is deliberately conservative: it only emits a compound when the
 * seam survives `join()`, which kills the manufactured-sounding majority.
 */

import { join, makeCandidate, clip, type GenContext } from '../core/candidate.ts';
import { profile, syllabify } from '../core/phonology.ts';
import { countSyllablesRough, isInflectedForm, unique } from '../core/text.ts';
import { BRAND_PREFIXES, BRAND_SUFFIXES } from '../data/morphemes.ts';
import { COMPOUND_WORDS, HEAD_ONLY, MOD_ONLY } from '../data/word-bank.ts';
import type { Candidate, Seed } from '../core/types.ts';

const COMPOUND_FORMS = new Set(COMPOUND_WORDS.map((w) => w.word));

/**
 * Is this seed a whole English word a reader would recognize?
 *
 * The old test — both halves coming from the concept bank — was far too narrow,
 * so genuine word compounds were labelled 'blend' and lost the imagery credit
 * they had actually earned.
 */
function isPlainWord(seed: Seed): boolean {
  if (COMPOUND_FORMS.has(seed.form)) return true;
  // A source that can state the grammatical role has already established the
  // word is real — that is what establishing the role required.
  if (seed.role) return true;
  return (
    seed.language === 'english' &&
    (seed.source === 'concept' || seed.source === 'wikipedia' || seed.source === 'dictionary')
  );
}

/**
 * Seeds worth compounding at all.
 *
 * Datamuse's `describes` relation returns adjectives like 'more' and 'very',
 * which are grammatically incapable of carrying half a compound. They were
 * producing 'Sharmore' and 'Comore'.
 */
function compoundable(seed: Seed): boolean {
  if (seed.note?.includes('describes')) return false;
  return seed.form.length >= 3 && seed.form.length <= 8;
}

// syllabify() is tuned for splitting a word into onset/nucleus/coda and reads
// 'freya' as a single beat. For counting, the vowel-group heuristic is right.
const syllablesIn = (form: string) => countSyllablesRough(form);

/**
 * Did two whole words meet without help?
 *
 * `join` pads an awkward seam with a linking vowel, which is right for roots
 * ('flux' + 'grid' -> 'fluxagrid') and wrong for real words, where it produces
 * 'Folkaglow' and 'Flowafreya'. Elision of a doubled letter still counts as
 * clean: 'iron' + 'nest' -> 'ironest'.
 */
function joinsCleanly(first: string, second: string, joined: string): boolean {
  const plain = first + second;
  const elided = first.at(-1) === second[0] ? first + second.slice(1) : plain;
  return joined === plain || joined === elided;
}

/** Pairs of seeds whose meanings actually add up to something. */
function pairSeeds(seeds: Seed[], ctx: GenContext, limit: number): [Seed, Seed][] {
  const pool = seeds.filter(compoundable);
  const pairs: [Seed, Seed][] = [];
  const shuffled = ctx.rng.shuffle(pool);
  for (let i = 0; i < shuffled.length && pairs.length < limit * 3; i++) {
    for (let j = 0; j < shuffled.length && pairs.length < limit * 3; j++) {
      if (i === j) continue;
      const a = shuffled[i] as Seed;
      const b = shuffled[j] as Seed;
      // Two seeds saying the same thing produce a tautology, not a compound.
      if (a.tags.length && b.tags.length && a.tags.every((t) => b.tags.includes(t))) continue;
      // Mixing three languages in one word is where compounds go to die.
      if (a.language !== b.language && a.language !== 'english' && b.language !== 'english') continue;
      // Four beats is where a compound stops being a name. Two words of two
      // syllables each can never work, so they are never paired.
      if (syllablesIn(a.form) + syllablesIn(b.form) > 3) continue;
      pairs.push([a, b]);
    }
  }
  return ctx.rng.sample(pairs, limit);
}

export function generateCompounds(seeds: Seed[], ctx: GenContext, limit = 60): Candidate[] {
  const out: Candidate[] = [];

  for (const [a, b] of pairSeeds(seeds, ctx, limit * 2)) {
    const transparent = isPlainWord(a) && isPlainWord(b);
    // Whole words are never clipped — clipping is what turns a compound into
    // mush. Only roots get shortened, and only when the full join runs long.
    const variants = transparent
      ? [join(a.form, b.form)]
      : [join(a.form, b.form), join(clip(a.form, 4), b.form), join(a.form, clip(b.form, 4))];

    for (const form of unique(variants.filter((v): v is string => Boolean(v)))) {
      const p = profile(form);
      if (p.illegalClusters.length > 0 || p.syllableCount > 3) continue;
      // Same rule as the word-compound path: whole words meet cleanly or not at
      // all. A linking vowel between two real words gives 'Flowafreya'.
      if (transparent && !joinsCleanly(a.form, b.form, form)) continue;
      const candidate = makeCandidate(
        form,
        transparent ? 'compound' : 'blend',
        [a, b],
        transparent
          ? `${a.form} + ${b.form} — ${a.gloss}, ${b.gloss}`
          : `${a.form} (${a.gloss}) + ${b.form} (${b.gloss})`,
        ctx,
      );
      if (candidate) out.push(candidate);
      if (out.length >= limit) return out;
    }
  }
  return out;
}

/**
 * Transparent word compounds: Keystone, Lodestar, Ironforge.
 *
 * Kept separate from `generateCompounds` because it has a different job. This
 * one never clips, never blends across languages, and respects which words can
 * lead and which must land last — 'Forgeiron' and 'Starnorth' are the failures
 * that role-blind pairing produces.
 */
export function generateWordCompounds(
  tags: string[],
  extra: Seed[],
  ctx: GenContext,
  limit = 60,
): Candidate[] {
  const wanted = new Set(tags.map((t) => t.toLowerCase()));

  type Word = { word: string; gloss: string; tags: string[]; role: 'head' | 'mod' | 'any' };

  // Words the brief actually brought in — 'court', 'league', 'pitch' for a
  // sports product. Marked as nouns, because that is what domain vocabulary
  // almost always is and their real part of speech is unknown. They can still
  // lead ('Courtjump'), since noun leaders are built deliberately now; calling
  // them 'any' had them counted as adjectives too, which crowded the real
  // adjectives out of the leading slot entirely.
  const fromRun: Word[] = extra
    .filter(
      (s) =>
        isPlainWord(s) &&
        // Up to two beats: almost no domain vocabulary is monosyllabic
        // ('rugby', 'tennis', 'athlete'), and the three-syllable ceiling on the
        // finished compound already stops the pair running long.
        syllablesIn(s.form) <= 2 &&
        s.form.length >= 3 &&
        s.form.length <= 8,
    )
    // Nouns unless a source established otherwise. Adjectives arrive from
    // `sources/modifiers.ts`, which knows they are adjectives because it found
    // them in front of the brief's own nouns in real usage.
    .map((s) => ({ word: s.form, gloss: s.gloss, tags: s.tags, role: s.role ?? 'head' }));

  /**
   * The bank supplies nouns. It cannot supply adjectives, and it should stop
   * being asked to.
   *
   * Its roles are read off part-of-speech tags, and a word earns the adjective
   * tag if it is EVER used adjectivally — true of every past participle in
   * English. So the 'mod' class fills with 'soaked', 'packed', 'feared' and
   * 'paid', while 'warm' and 'bold', being nouns as well, are filed under 'any'
   * next to 'stone' and 'gas'. In neither class is the tag evidence of anything.
   *
   * The tag IS reliable in the negative: a word never tagged adjectival is
   * certainly not an adjective. That is exactly the 'head' class, so that is the
   * only class kept. Adjectives come from sources/modifiers.ts, which establishes
   * them from usage instead of from a label.
   */
  const banked: Word[] = COMPOUND_WORDS.filter(
    (w) => w.role === 'head' && !isInflectedForm(w.word),
  ).map((w) => ({ word: w.word, gloss: w.gloss, tags: w.tags, role: 'head' as const }));

  const briefWords = new Set(fromRun.map((w) => w.word));
  const scored = unique([...fromRun, ...banked], (w) => w.word).map((word) => ({
    word,
    // A word the brief actually supplied outranks a bank word that merely
    // shares an abstract tag. Without this the generator exhausted its limit on
    // generic material and never reached the domain vocabulary at all — the
    // seeds were present and simply unused.
    score: word.tags.filter((t) => wanted.has(t)).length + (briefWords.has(word.word) ? 2 : 0),
  }));

  // Weighted draw, not a sort: sorting by score made the highest-scoring bank
  // words lead every single run regardless of seed, which is why 'kin' and
  // 'loom' turned up in every shortlist.
  const pool = ctx.rng
    .weighted(scored, (entry) => (entry.score + 0.6) ** 2, 140)
    .map((entry) => entry.word);

  const out: Candidate[] = [];
  const seen = new Set<string>();

  /**
   * Compounds come in two grammatical shapes and both have to be built.
   *
   * 'mod' and 'any' words can qualify something (Warmgrove, Truenorth); 'head'
   * words are the thing being qualified (Ironforge, Keystone). Previously only
   * the first group could lead, so a noun-only word could never start a name —
   * 'Stonegate' was unreachable while 'Gatestone' was fine — and because the
   * bank's adjectives sit mostly in 'any' alongside plenty of nouns, what came
   * out read as noun+noun almost every time.
   *
   * Leading alternately from each group guarantees both shapes appear rather
   * than letting one weighting decide.
   */
  const adjectival = pool.filter((w) => w.role === 'mod');
  const nominal = pool.filter((w) => w.role !== 'mod');
  const leaders: Word[] = [];
  for (let i = 0; i < Math.max(adjectival.length, nominal.length); i++) {
    const adj = adjectival[i];
    const noun = nominal[i];
    if (adj) leaders.push(adj);
    if (noun && noun !== adj) leaders.push(noun);
  }

  for (const first of unique(leaders, (w) => w.word)) {
    // A modifier cannot be the thing being named, so it never trails.
    const partners = ctx.rng.shuffle(
      pool.filter((w) => w.word !== first.word && w.role !== 'mod'),
    );

    const firstOnBrief = first.tags.some((t) => wanted.has(t));

    for (const second of partners.slice(0, 8)) {
      // At least one half must answer the brief, or the compound is just two
      // nouns colliding — 'Breadiron', 'Slateclay'.
      if (!firstOnBrief && !second.tags.some((t) => wanted.has(t))) continue;
      const form = join(first.word, second.word);
      if (!form || seen.has(form)) continue;
      if (!joinsCleanly(first.word, second.word, form)) continue;
      seen.add(form);

      const p = profile(form);
      if (p.illegalClusters.length > 0 || p.syllableCount > 3 || p.letters > 12) continue;
      // A compound that just repeats itself ('stonestone') is not a name.
      if (first.word === second.word) continue;

      const toSeed = (w: Word): Seed => ({
        form: w.word,
        gloss: w.gloss,
        language: 'english',
        source: 'concept',
        tags: w.tags,
        weight: 0.8,
        // Carried so the report can say which half is the adjective. Without it
        // the finished candidate cannot be told apart from a noun+noun pair.
        role: w.role === 'any' ? undefined : w.role,
      });

      const candidate = makeCandidate(
        form,
        'compound',
        [toSeed(first), toSeed(second)],
        `${first.word} + ${second.word} — ${first.gloss}, joined to ${second.gloss}`,
        ctx,
      );
      if (candidate) out.push(candidate);
      if (out.length >= limit) return out;
    }
  }
  return out;
}

/** Root + brand suffix: the 'Lumora' / 'Verita' / 'Novaris' family. */
export function generateSuffixed(seeds: Seed[], ctx: GenContext, limit = 60): Candidate[] {
  const out: Candidate[] = [];
  const pool = seeds.filter((s) => s.form.length >= 3 && s.form.length <= 7);

  for (const seed of ctx.rng.shuffle(pool)) {
    for (const suffix of ctx.rng.sample(BRAND_SUFFIXES, 4)) {
      const form = join(seed.form, suffix.form);
      if (!form) continue;
      const p = profile(form);
      if (p.illegalClusters.length > 0 || p.syllableCount > 4) continue;
      const candidate = makeCandidate(
        form,
        'suffixed',
        [seed],
        `${seed.form} (${seed.gloss}) with a -${suffix.form} ending: ${suffix.feel}`,
        ctx,
      );
      if (candidate) out.push(candidate);
      if (out.length >= limit) return out;
    }
  }
  return out;
}

/** Brand prefix + root: 'Novaris', 'Solterra', 'Verano'. */
export function generatePrefixed(seeds: Seed[], ctx: GenContext, limit = 40): Candidate[] {
  const out: Candidate[] = [];
  const pool = seeds.filter((s) => s.form.length >= 3 && s.form.length <= 7);

  for (const seed of ctx.rng.shuffle(pool)) {
    for (const prefix of ctx.rng.sample(BRAND_PREFIXES, 3)) {
      const form = join(prefix.form, seed.form);
      if (!form) continue;
      const p = profile(form);
      if (p.illegalClusters.length > 0 || p.syllableCount > 4) continue;
      const candidate = makeCandidate(
        form,
        'prefixed',
        [seed],
        `${prefix.form}- (${prefix.feel}) + ${seed.form} (${seed.gloss})`,
        ctx,
      );
      if (candidate) out.push(candidate);
      if (out.length >= limit) return out;
    }
  }
  return out;
}
