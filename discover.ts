#!/usr/bin/env node
/**
 * Brand Discovery Platform — the orchestrator.
 *
 * Runs the seven stages end to end:
 *   1. Brand DNA          — turn a brief into an explicit strategic posture
 *   2. Language expansion — mine the curated multilingual lexicon
 *   3. Meaning expansion  — roots, concepts, lateral domains, live thesaurus
 *   4. Generation         — every naming strategy, gated by phonotactics
 *   5. Mutation           — breed the survivors
 *   6. Evaluation         — score, veto, rank
 *   7. Repeat             — a different naming philosophy every cycle
 *
 * Run: node discover.ts --brief "..." [--cycles 3] [--offline]
 */

import { writeFile } from 'node:fs/promises';
import { createRng } from './core/rng.ts';
import { loadSeen, loadWordUsage, recordSeen } from './core/history.ts';
import { setOffline, netStats, mapLimit } from './core/net.ts';
import { editSimilarity, normalize, phoneticSimilarity, unique, usageDecay } from './core/text.ts';
import { mutate, mutateAll } from './generators/mutations.ts';
import {
  generateCompounds,
  generatePrefixed,
  generateSuffixed,
  generateWordCompounds,
} from './generators/compounds.ts';
import { generatePortmanteaus } from './generators/portmanteau.ts';
import { generateMisspellings } from './generators/misspellings.ts';
import { generateAcronyms, generateSyllabicAcronyms } from './generators/acronyms.ts';
import { generateAnchoredInventions, generateInvented } from './generators/phonetics.ts';
import { conceptSeeds, lateralSeeds } from './sources/concepts.ts';
import { morphemeSeeds } from './sources/etymology.ts';
import { translationSeeds } from './sources/translations.ts';
import { expandBriefTerm, expandConcept } from './sources/thesaurus.ts';
import { modifierSeeds } from './sources/modifiers.ts';
import { mineDomain } from './sources/wikipedia.ts';
import { WORD_TO_TAGS } from './data/tag-vocabulary.ts';
import { makeCandidate, type GenContext } from './core/candidate.ts';
import { rescoreWithValidation, scoreCandidate } from './scorers/overall.ts';
import { checkDomain, checkDomains, DEFAULT_TLDS } from './validators/domains.ts';
import { checkSocial } from './validators/social.ts';
import { checkAppStores } from './validators/appstores.ts';
import { checkTrademark, clearanceLinks } from './validators/trademarks.ts';
import type {
  BrandDNA,
  Candidate,
  CycleReport,
  DiscoveryOptions,
  DiscoveryResult,
  Philosophy,
  Seed,
} from './core/types.ts';

// ---------------------------------------------------------------------------
// Stage 1 — Brand DNA
// ---------------------------------------------------------------------------

/** Words in the brief worth searching on — everything but the connective tissue. */
const BRIEF_STOP_WORDS = new Set([
  'a', 'an', 'and', 'the', 'of', 'for', 'to', 'in', 'on', 'with', 'that', 'this', 'is',
  'are', 'be', 'by', 'at', 'from', 'as', 'it', 'its', 'their', 'your', 'our', 'we', 'you',
  'they', 'them', 'people', 'thing', 'things', 'them', 'through', 'across', 'into', 'over',
  'using', 'via', 'app', 'platform', 'product', 'service', 'company', 'business', 'startup',
  'tool', 'system', 'unified', 'new', 'simple', 'easy', 'best', 'first', 'more', 'most',
  'help', 'helps', 'make', 'makes', 'built', 'build', 'lets', 'let', 'can', 'will',
  // Words that describe the *shape* of a product rather than its field. Nearly
  // every brief contains them, and expanding them is actively harmful: asking
  // what relates to 'places' returns place names — Mayo, Siena, Chennai — and
  // asking about 'organizations' returns institutions and acronyms. The field
  // lives in the remaining words.
  'connect', 'connects', 'connecting', 'connected', 'connection',
  'place', 'places', 'organization', 'organizations', 'organisation', 'organisations',
  'user', 'users', 'customer', 'customers', 'client', 'clients', 'member', 'members',
  'everyone', 'anyone', 'everything', 'anything', 'solution', 'solutions', 'website',
  'software', 'application', 'applications', 'digital', 'online', 'across',
]);

function contentWords(brief: string): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of brief.toLowerCase().split(/[^a-z]+/)) {
    const word = raw.trim();
    if (word.length < 3 || BRIEF_STOP_WORDS.has(word) || seen.has(word)) continue;
    seen.add(word);
    out.push(word);
  }
  return out;
}

/** Brief vocabulary → concept tags. The bridge from prose to the concept bank. */
const KEYWORD_TAGS: Record<string, string[]> = {
  ai: ['intelligence', 'insight'], intelligent: ['intelligence'], smart: ['intelligence'],
  assistant: ['care', 'guidance'], agent: ['guidance', 'craft'],
  private: ['protection', 'trust'], privacy: ['protection', 'trust'], secure: ['protection', 'safety'],
  security: ['protection', 'safety'], safe: ['safety', 'protection'], trust: ['trust'],
  family: ['home', 'community', 'warmth'], home: ['home', 'warmth'], parent: ['care', 'home'],
  kids: ['care', 'growth'], child: ['care', 'growth'],
  calm: ['calm', 'rest'], simple: ['simplicity', 'clarity'], clarity: ['clarity'],
  organize: ['order', 'structure'], organized: ['order', 'structure'], plan: ['order', 'guidance'],
  schedule: ['time', 'rhythm', 'order'], calendar: ['time', 'rhythm'], time: ['time'],
  fast: ['speed'], speed: ['speed'], instant: ['speed'], realtime: ['speed', 'flow'],
  money: ['exchange', 'abundance'], finance: ['trust', 'precision'], payment: ['exchange', 'flow'],
  bank: ['trust', 'protection'], invest: ['growth', 'abundance'], wealth: ['abundance', 'growth'],
  health: ['care', 'life'], medical: ['care', 'precision'], wellness: ['calm', 'life'],
  fitness: ['energy', 'growth'], sleep: ['calm', 'rest'], mental: ['calm', 'insight'],
  learn: ['insight', 'growth'], education: ['insight', 'growth'], teach: ['guidance', 'insight'],
  data: ['insight', 'structure'], analytics: ['insight', 'precision'], insight: ['insight'],
  search: ['discovery', 'insight'], discover: ['discovery', 'wonder'], research: ['discovery', 'insight'],
  build: ['craft', 'structure'], developer: ['craft', 'precision'], code: ['craft', 'precision'],
  design: ['craft', 'beauty'], creative: ['creativity', 'craft'], art: ['beauty', 'expression'],
  music: ['sound', 'rhythm'], audio: ['sound'], video: ['vision', 'expression'],
  travel: ['journey', 'discovery'], map: ['navigation', 'guidance'], navigate: ['navigation', 'guidance'],
  connect: ['connection', 'community'], social: ['community', 'connection'], team: ['community', 'craft'],
  collaborate: ['community', 'connection'], share: ['sharing', 'community'], network: ['network', 'connection'],
  marketplace: ['exchange', 'community'], commerce: ['exchange'], retail: ['exchange'],
  energy: ['energy', 'power'], climate: ['nature', 'scale'], sustainable: ['nature', 'endurance'],
  green: ['nature', 'growth'], carbon: ['nature', 'measurement'], solar: ['light', 'energy'],
  space: ['scale', 'ambition'], robot: ['precision', 'motion'], hardware: ['craft', 'precision'],
  logistics: ['flow', 'precision'], supply: ['flow', 'structure'], delivery: ['speed', 'flow'],
  memory: ['memory'], archive: ['memory', 'preservation'], photo: ['memory', 'vision'],
  luxury: ['premium', 'beauty'], premium: ['premium'], craft: ['craft'], artisan: ['craft'],
  legal: ['proof', 'protection'], compliance: ['proof', 'order'], insurance: ['protection', 'trust'],
  game: ['play', 'joy'], play: ['play', 'joy'], fun: ['joy'],
  food: ['warmth', 'abundance'], restaurant: ['warmth', 'community'], farm: ['growth', 'nature'],
  sport: ['energy', 'play', 'community'], sports: ['energy', 'play', 'community'],
  athlete: ['energy', 'craft'], coach: ['guidance', 'craft'], club: ['community', 'belonging'],
  league: ['community', 'structure'], match: ['play', 'energy'], tournament: ['play', 'community'],
  compete: ['energy', 'ambition'], train: ['craft', 'growth'], player: ['play', 'community'],
  place: ['space', 'belonging'], places: ['space', 'belonging'], venue: ['space', 'community'],
  city: ['community', 'structure'], local: ['community', 'belonging'], region: ['space', 'community'],
  organization: ['structure', 'community'], organisations: ['structure', 'community'],
  people: ['community', 'warmth'], member: ['community', 'belonging'],
  unify: ['connection', 'wholeness'], unified: ['connection', 'wholeness'],
  together: ['connection', 'community'], directory: ['order', 'discovery'],
  booking: ['exchange', 'order'], ticket: ['exchange', 'play'],
};

const EMOTION_VOCAB = new Set([
  'calm', 'trust', 'warmth', 'care', 'energy', 'speed', 'precision', 'power', 'strength',
  'premium', 'luxury', 'playful', 'joy', 'intelligence', 'clarity', 'wonder', 'freedom',
  'safety', 'growth', 'craft', 'simplicity',
]);

/** Crude stemming, enough to match 'connecting' and 'organizations' to the map. */
function stems(word: string): string[] {
  const out = [word];
  for (const [suffix, replacement] of [
    ['ing', ''], ['ions', 'e'], ['ion', 'e'], ['ations', 'ate'], ['ers', ''],
    ['er', ''], ['es', ''], ['s', ''], ['ed', ''], ['ies', 'y'],
  ] as const) {
    if (word.length > suffix.length + 2 && word.endsWith(suffix)) {
      out.push(word.slice(0, -suffix.length) + replacement);
    }
  }
  return out;
}

export function buildDNA(options: DiscoveryOptions): BrandDNA {
  const tokens = options.brief.toLowerCase().split(/[^a-z]+/).filter(Boolean);

  const concepts = new Set<string>();
  for (const token of tokens) {
    // Inflected forms were silently missing every mapping, which dropped the
    // brief onto the generic fallback concepts.
    for (const stem of stems(token)) {
      for (const tag of KEYWORD_TAGS[stem] ?? []) concepts.add(tag);
    }
    if (EMOTION_VOCAB.has(token)) concepts.add(token);
  }
  for (const emotion of options.emotions ?? []) concepts.add(emotion.toLowerCase());
  // No generic fallback here. Injecting 'trust, clarity, craft, growth' whenever
  // the keyword map missed meant every unmapped brief drew identical material —
  // a mortgage brief and a nonsense brief produced half the same shortlist.
  // gatherSeeds derives the real tags from the brief's own expanded vocabulary.

  const emotions =
    options.emotions && options.emotions.length > 0
      ? options.emotions.map((e) => e.toLowerCase())
      : [...concepts].filter((c) => EMOTION_VOCAB.has(c)).slice(0, 3);
  if (emotions.length === 0) emotions.push('trust', 'clarity');

  const soundTargets: string[] = [];
  if (emotions.some((e) => ['calm', 'trust', 'warmth', 'care', 'premium', 'luxury'].includes(e))) {
    soundTargets.push('liquid consonants (l, r, m, n)', 'open vowels', 'vowel-final endings');
  }
  if (emotions.some((e) => ['energy', 'speed', 'precision', 'power'].includes(e))) {
    soundTargets.push('voiceless plosives (k, t, p)', 'front vowels', 'two syllables or fewer');
  }
  if (soundTargets.length === 0) soundTargets.push('balanced consonant-vowel alternation');

  return {
    brief: options.brief,
    problem: options.brief,
    users: options.audience ?? 'not specified — inferred from the brief',
    emotions,
    industryNow: options.industry ?? 'unspecified',
    industryLater: `adjacent categories the brand could credibly enter from ${options.industry ?? 'its first market'}`,
    posture: options.posture ?? 'evoke',
    concepts: [...concepts],
    briefTerms: contentWords(options.brief).slice(0, 8),
    soundTargets,
    avoid: (options.avoid ?? []).map((a) => a.toLowerCase()),
    syllableRange: options.syllableRange ?? [2, 3],
  };
}

// ---------------------------------------------------------------------------
// Stages 2 & 3 — expand language and meaning
// ---------------------------------------------------------------------------

/**
 * Concept tags implied by a set of words, ranked by how many of them agree.
 *
 * The hand-written keyword map covered about a hundred words, so any brief
 * outside it produced no tags at all and fell back to generic material — which
 * is why a mortgage brief and a nonsense brief returned the same names. The
 * shipped tag index covers all 167 tags from the other direction, so an
 * arbitrary brief now lands somewhere real: 'mortgage' expands to loan, credit,
 * property, lender, and those words imply finance, trust, home and shelter.
 */
function deriveConcepts(words: Iterable<string>, limit = 10): string[] {
  const votes = new Map<string, number>();

  for (const word of words) {
    for (const stem of stems(word)) {
      // The literal map still wins where it applies — it was written on purpose.
      for (const tag of KEYWORD_TAGS[stem] ?? []) {
        votes.set(tag, (votes.get(tag) ?? 0) + 3);
      }
      for (const tag of WORD_TO_TAGS.get(stem) ?? []) {
        votes.set(tag, (votes.get(tag) ?? 0) + 1);
      }
    }
    if (EMOTION_VOCAB.has(word)) votes.set(word, (votes.get(word) ?? 0) + 3);
  }

  return [...votes]
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([tag]) => tag);
}

export async function gatherSeeds(
  dna: BrandDNA,
  ctx: GenContext,
  wordUsage: Map<string, number> = new Map(),
): Promise<Seed[]> {
  const seeds: Seed[] = [];

  // The brief's own vocabulary comes FIRST, because everything else is chosen
  // against it. Drawing the curated banks from concept tags alone meant any
  // brief outside the keyword map fell back to the same four generic tags —
  // 'mortgage underwriting for credit unions' and a line of nonsense words drew
  // half the same shortlist.
  const briefTerms = dna.briefTerms;
  const vocabulary = new Set<string>(briefTerms);

  if (briefTerms.length) {
    const domainWords = await mapLimit(briefTerms, 3, (term) => expandBriefTerm(term));
    for (const seed of domainWords.flat()) {
      seeds.push(seed);
      vocabulary.add(seed.form);
    }
    // Adjectives, which no other source supplies. The banks classify roles from
    // part-of-speech tags, and those cannot separate 'warm' from 'stone' — so
    // without this every compound comes out noun+noun.
    for (const seed of await modifierSeeds(briefTerms.slice(0, 6))) {
      seeds.push(seed);
      vocabulary.add(seed.form);
    }

    // The brief's own words are candidates too, not just their expansions.
    for (const term of briefTerms) {
      seeds.push({
        form: normalize(term),
        gloss: 'from the brief',
        language: 'english',
        source: 'dictionary',
        tags: [term],
        weight: 0.8,
      });
    }
  }

  // Concepts derived from the expansion, not just from the brief's literal
  // words. Written back onto the DNA so the report shows what actually drove
  // the run.
  for (const tag of deriveConcepts(vocabulary)) {
    if (!dna.concepts.includes(tag)) dna.concepts.push(tag);
  }
  if (dna.concepts.length === 0) dna.concepts.push('craft', 'clarity', 'growth');

  // Curated banks, now selected against both the concept tags and that vocabulary.
  seeds.push(
    ...morphemeSeeds(dna.concepts, 44, ctx.rng, vocabulary, wordUsage),
    ...translationSeeds(dna.concepts, 34, ctx.rng, vocabulary, wordUsage),
    ...conceptSeeds(dna.concepts, 40, ctx.rng, vocabulary, wordUsage),
    ...lateralSeeds(dna.concepts, ctx.rng, 14, wordUsage),
  );

  // Live expansion of the abstract tags, plus Wikipedia for domains the curated
  // bank cannot cover exhaustively.
  const topConcepts = dna.concepts.slice(0, 6);
  const expanded = await mapLimit(topConcepts, 3, (concept) => expandConcept(concept));
  seeds.push(...expanded.flat());

  const wikiQueries: [string, Parameters<typeof mineDomain>[1], string[]][] = [
    [`${briefTerms[0] ?? dna.concepts[0] ?? 'light'} mythology`, 'mythology', dna.concepts.slice(0, 2)],
    ['star names astronomy', 'astronomy', ['guidance', 'ambition']],
  ];
  const mined = await mapLimit(wikiQueries, 2, ([query, domain, tags]) =>
    mineDomain(query, domain, tags, 10),
  );
  seeds.push(...mined.flat());

  // Drop seeds the brief explicitly rules out, and anything unusable as material.
  const usable = unique(
    seeds.filter((s) => {
      const form = normalize(s.form);
      if (form.length < 3 || form.length > 11) return false;
      return !dna.avoid.some((a) => a.length >= 3 && form.includes(a));
    }),
    (s) => `${s.form}:${s.source}`,
  );

  // Every source converges here, so this is the one place a usage limit can
  // actually bite. Weighting the curated draws was not enough: the same word
  // also arrives from Datamuse and Wikipedia, and once it is in the pool the
  // generators pick it with no usage weighting of their own. Thinning it out of
  // the pool itself reduces its presence whatever brought it in.
  //
  // Probabilistic rather than a ban, and driven by the run's rng so it stays
  // reproducible: a word used once survives half the time, used three times a
  // quarter of the time, and never disappears entirely.
  return usable.filter((seed) => {
    const used = wordUsage.get(seed.form) ?? 0;
    if (used === 0) return true;
    return ctx.rng.chance(usageDecay(seed.form, wordUsage));
  });
}

// ---------------------------------------------------------------------------
// Stage 4 — generation, one philosophy at a time
// ---------------------------------------------------------------------------

export const PHILOSOPHIES: Philosophy[] = [
  'evocative-classical',
  'invented-phonetic',
  'plain-english-metaphor',
  'mythic-symbolic',
  'compound-utility',
  'minimal-abstract',
];

export const PHILOSOPHY_NOTES: Record<Philosophy, string> = {
  'evocative-classical': 'Latin and Greek roots given modern brand endings — Lumora, Veritas, Novaris. Meaning without description.',
  'invented-phonetic': 'Pure coinage from curated sound palettes. Zero prior meaning, total ownership, highest build cost.',
  'plain-english-metaphor': 'One real English word borrowed from another domain — Keystone, Cadence, Fathom. Instant imagery, harder to own.',
  'mythic-symbolic': 'Mythology, astronomy and navigation. Names that arrive pre-loaded with a story.',
  'compound-utility': 'Two meanings fused into one word. The most explainable strategy, the most crowded.',
  'minimal-abstract': 'Short, clipped, abstract. Maximum flexibility, minimum inherent meaning.',
};

function realWordCandidates(seeds: Seed[], ctx: GenContext, limit: number): Candidate[] {
  const out: Candidate[] = [];
  const wanted = new Set([...ctx.dna.concepts, ...ctx.dna.briefTerms]);

  const pool = ctx.rng.shuffle(
    seeds.filter((s) => {
      if (s.source !== 'concept' && s.source !== 'wikipedia' && s.source !== 'translation') {
        return false;
      }
      // Shipping a real word AS the name is the strongest claim the engine can
      // make, so it has to be squarely on-brief. A single incidental tag match
      // is how 'Ikigai' ended up proposed for a sports platform, on the
      // strength of sharing 'warmth'.
      const overlap = s.tags.filter((t) => wanted.has(t)).length;
      return overlap >= 2 || wanted.has(s.form);
    }),
  );
  for (const seed of pool) {
    const candidate = makeCandidate(
      seed.form,
      seed.source === 'translation' ? 'symbolic' : 'real-word',
      [seed],
      `${seed.note ?? seed.gloss}`,
      ctx,
    );
    if (candidate) out.push(candidate);
    if (out.length >= limit) break;
  }
  return out;
}

function generateForPhilosophy(seeds: Seed[], ctx: GenContext, target: number): Candidate[] {
  const dna = ctx.dna;
  const roots = seeds.filter((s) => s.source === 'etymology' || s.source === 'translation');
  const concepts = seeds.filter((s) => s.source === 'concept' || s.source === 'wikipedia');
  const phrases = [dna.brief, dna.concepts.join(' '), dna.emotions.join(' ')];

  switch (ctx.philosophy) {
    case 'evocative-classical':
      return [
        ...generateSuffixed(roots, ctx, Math.round(target * 0.45)),
        ...generateCompounds(roots, ctx, Math.round(target * 0.3)),
        ...generatePortmanteaus(roots, ctx, Math.round(target * 0.25)),
      ];
    case 'invented-phonetic':
      return [
        ...generateInvented(dna.concepts, ctx, Math.round(target * 0.55)),
        ...generateAnchoredInventions(roots, ctx, Math.round(target * 0.45)),
      ];
    case 'plain-english-metaphor':
      return [
        ...realWordCandidates(concepts, ctx, Math.round(target * 0.35)),
        ...generateWordCompounds([...dna.concepts, ...dna.briefTerms], seeds, ctx, Math.round(target * 0.25)),
        ...generateCompounds(concepts, ctx, Math.round(target * 0.2)),
        ...generateMisspellings(concepts, ctx, Math.round(target * 0.2)),
      ];
    case 'mythic-symbolic':
      return [
        ...realWordCandidates(seeds, ctx, Math.round(target * 0.35)),
        ...generateSuffixed(concepts, ctx, Math.round(target * 0.35)),
        ...generatePortmanteaus(concepts, ctx, Math.round(target * 0.3)),
      ];
    case 'compound-utility':
      // Word compounds lead: they are the point of this philosophy, and they
      // were previously drowned out by clipped-root blends and prefixed forms.
      return [
        ...generateWordCompounds([...dna.concepts, ...dna.briefTerms], seeds, ctx, Math.round(target * 0.45)),
        ...generateCompounds(seeds, ctx, Math.round(target * 0.3)),
        ...generatePrefixed(seeds, ctx, Math.round(target * 0.1)),
        ...generateSyllabicAcronyms(phrases, ctx, Math.round(target * 0.1)),
        ...generateAcronyms(phrases, ctx, Math.round(target * 0.05)),
      ];
    case 'minimal-abstract':
      return [
        ...generateInvented(dna.concepts, ctx, Math.round(target * 0.5)),
        ...generateMisspellings(roots, ctx, Math.round(target * 0.2)),
        ...generatePortmanteaus(seeds, ctx, Math.round(target * 0.3)),
      ];
  }
}

// ---------------------------------------------------------------------------
// Stages 5 & 6 — mutate, score, rank
// ---------------------------------------------------------------------------

async function scoreAll(candidates: Candidate[], dna: BrandDNA): Promise<Candidate[]> {
  const scored: Candidate[] = [];
  for (const candidate of candidates) {
    const result = await scoreCandidate(candidate, dna);
    scored.push({
      ...candidate,
      scores: result.scores,
      risks: [...candidate.risks, ...result.risks],
      rationale: candidate.rationale,
    });
  }
  return scored;
}

/** The bar a candidate has to clear to be worth a human's attention. */
const STRONG_SCORE = 75;

const byScore = (a: Candidate, b: Candidate) => (b.scores?.overall ?? 0) - (a.scores?.overall ?? 0);

/** Do two names share a whole word or stem at either end? */
function sharesChunk(a: string, b: string, min = 4): boolean {
  for (let n = Math.min(a.length, b.length); n >= min; n--) {
    if (a.slice(0, n) === b.slice(0, n)) return true;
    if (a.slice(-n) === b.slice(-n)) return true;
  }
  return false;
}

/**
 * Stop one lucky stem from filling the shortlist with its own descendants.
 *
 * Without this the ranking collapses: a root that scores well produces twenty
 * mutations that all score well, and a shortlist of Vegtix / Vegtixo / Vegtixa
 * looks like thoroughness while actually being one idea.
 *
 * A candidate joins an existing family on any of four grounds, because each
 * catches a case the others miss:
 *
 *   - shared ancestry, which is definitional — a mutation and its parent are
 *     one idea however far the spelling drifted;
 *   - a shared word at either end, so a shortlist does not arrive as
 *     Warmgrove / Fairgrove / Ferngrove;
 *   - near-identical spelling, for look-alikes generated independently;
 *   - near-identical sound, for the ones spelled apart but heard the same.
 *
 * Grouping on a three-letter phonetic prefix, as this did before, missed all
 * but the last: Adnavy, Adnavya and Atnavy each landed in their own family and
 * took three of the top slots between them.
 */
function createFamilyFilter(perFamily: number): (candidate: Candidate) => boolean {
  const counts = new Map<string, number>();
  const kept: { name: string; parts: Set<string>; family: string }[] = [];

  return (candidate: Candidate): boolean => {
    const name = candidate.name;
    // A compound's own seeds name its parts exactly, which beats guessing at
    // word boundaries from the string: 'kin' is three letters and would slip
    // past any sensible shared-substring rule.
    const parts = new Set(
      candidate.seeds.filter((s) => s.form.length >= 3 && name.includes(s.form)).map((s) => s.form),
    );
    let family = candidate.lineage[0] ?? name;

    for (const previous of kept) {
      if (
        (candidate.lineage[0] ?? name) === previous.family ||
        [...parts].some((part) => previous.parts.has(part)) ||
        sharesChunk(name, previous.name) ||
        editSimilarity(name, previous.name) >= 0.75 ||
        phoneticSimilarity(name, previous.name) >= 0.82
      ) {
        family = previous.family;
        break;
      }
    }

    const used = counts.get(family) ?? 0;
    if (used >= perFamily) return false;
    counts.set(family, used + 1);
    kept.push({ name, parts, family });
    return true;
  };
}

function diversify(candidates: Candidate[], perFamily = 2): Candidate[] {
  return candidates.filter(createFamilyFilter(perFamily));
}

/**
 * Build the shortlist by taking the best surviving candidate from each
 * philosophy in turn.
 *
 * Ranking straight down the list does not do what selecting three strategies
 * implies: one strategy tends to sweep, and a run with compounds enabled comes
 * back as nine compounds. Round-robin guarantees every strategy the user chose
 * is represented before any of them takes a second slot, then score fills the
 * remainder.
 */
function buildShortlist(ranked: Candidate[], want: number): Candidate[] {
  const accept = createFamilyFilter(1);
  const queues = new Map<Philosophy, Candidate[]>();
  for (const candidate of ranked) {
    const queue = queues.get(candidate.philosophy) ?? [];
    queue.push(candidate);
    queues.set(candidate.philosophy, queue);
  }

  const lists = [...queues.values()];
  const cursors = lists.map(() => 0);
  const out: Candidate[] = [];

  let progressed = true;
  while (out.length < want && progressed) {
    progressed = false;
    for (let i = 0; i < lists.length && out.length < want; i++) {
      const list = lists[i] as Candidate[];
      let cursor = cursors[i] as number;
      while (cursor < list.length) {
        const candidate = list[cursor] as Candidate;
        cursor++;
        if (accept(candidate)) {
          out.push(candidate);
          progressed = true;
          break;
        }
      }
      cursors[i] = cursor;
    }
  }

  // Clustering hard enough to be useful can leave fewer distinct families than
  // the caller asked for. Top up from the ranking rather than returning a short
  // list — the spread is a preference, not a cap on how much they get.
  const chosen = new Set(out.map((c) => c.name));
  for (const candidate of ranked) {
    if (out.length >= want) break;
    if (chosen.has(candidate.name)) continue;
    chosen.add(candidate.name);
    out.push(candidate);
  }

  return out.sort(byScore);
}

/**
 * A cycle reports its highlights and hands back its whole surviving pool.
 *
 * These are different jobs. The report is read by a human and wants 25 names;
 * selection wants everything, because a requirement like "the .com must be
 * free" eliminates roughly nine candidates in ten and has to reach much deeper
 * to fill a shortlist. Keeping the pool out of the report also keeps it out of
 * the JSON sent to the browser.
 */
async function runCycle(
  seeds: Seed[],
  ctx: GenContext,
  target: number,
  seen: Set<string>,
  alreadyShown: Set<string>,
): Promise<{ report: CycleReport; pool: Candidate[]; stale: Candidate[] }> {
  const raw = unique(generateForPhilosophy(seeds, ctx, target), (c) => c.name).filter(
    (c) => !seen.has(c.name),
  );
  for (const candidate of raw) seen.add(candidate.name);

  const scored = (await scoreAll(raw, ctx.dna)).sort(byScore);

  // Stage 5: breed the elite, score the descendants, merge both generations.
  const elite = scored.slice(0, 20);
  const children = unique(mutateAll(elite, ctx, 10), (c) => c.name).filter((c) => !seen.has(c.name));
  for (const child of children) seen.add(child.name);
  const scoredChildren = await scoreAll(children, ctx.dna);

  const all = [...scored, ...scoredChildren].sort(byScore);
  const survived = all.filter((c) => (c.scores?.overall ?? 0) >= STRONG_SCORE).length;
  const diversified = diversify(all, 2);

  // Names earlier runs already showed are removed HERE, not after the cycles.
  // Filtering later left them in `report.top`, which is what the streaming
  // preview and the 'Best of this cycle' summary display — so a blacklisted
  // name still appeared on screen even though it could never be a finalist.
  const pool = diversified.filter((c) => !alreadyShown.has(c.name));
  const stale = diversified.filter((c) => alreadyShown.has(c.name));

  return {
    report: {
      cycle: ctx.cycle,
      philosophy: ctx.philosophy,
      generated: raw.length + children.length,
      survived,
      top: pool.slice(0, 25),
    },
    pool,
    stale,
  };
}

// ---------------------------------------------------------------------------
// Stage 7 — repeat, then validate the finalists
// ---------------------------------------------------------------------------

export async function discover(options: DiscoveryOptions): Promise<DiscoveryResult> {
  setOffline(options.offline);
  const dna = buildDNA(options);
  const rng = createRng(options.seedValue);
  const emit = options.onProgress ?? (() => {});

  // An explicit selection wins; otherwise take the head of the rotation.
  const plan: Philosophy[] = options.philosophies?.length
    ? options.philosophies
    : PHILOSOPHIES.slice(0, options.cycles);

  // Seeds are roughly the first sixth of a run; cycles take most of the rest,
  // and validation is the tail. Enough to drive an honest progress bar.
  const cycleShare = 0.62 / Math.max(1, plan.length);

  const seedCtx: GenContext = { dna, philosophy: plan[0] as Philosophy, cycle: 0, rng };
  const wordUsage = options.excludeSeen === false ? new Map<string, number>() : await loadWordUsage();
  log(`gathering seeds for: ${dna.concepts.join(', ')}`);
  emit({
    stage: 'seeds',
    message: `Reading ${dna.concepts.length} concepts across 13 languages`,
    progress: 0.04,
  });
  const seeds = await gatherSeeds(dna, seedCtx, wordUsage);
  const sourceCount = new Set(seeds.map((s) => s.source)).size;
  log(`${seeds.length} seeds from ${sourceCount} source types`);
  emit({
    stage: 'seeds',
    message: `${seeds.length} seeds from ${sourceCount} source types`,
    progress: 0.16,
  });

  const seen = new Set<string>();
  const cycles: CycleReport[] = [];
  const pools: Candidate[][] = [];
  const stalePools: Candidate[][] = [];

  /**
   * Every name this run puts in front of the user, recorded at the moment it is
   * displayed rather than at the end.
   *
   * Recording only the finalists was not enough: names also appear in the
   * streaming preview and in each cycle's 'Best of' line, and those were never
   * written to the history — so a name you had already seen was free to come
   * back as a finalist in a later run. Writing here, where the display happens,
   * is what stops the two drifting apart again.
   */
  const shown = new Set<string>();
  const show = <T extends { display: string }>(candidates: T[]): string[] => {
    const names = candidates.map((c) => c.display);
    for (const name of names) shown.add(name);
    return names;
  };

  // Loaded before the cycles run, so nothing already shown reaches the preview.
  const alreadyShown =
    options.excludeSeen === false ? new Set<string>() : new Set(await loadSeen());

  for (let i = 0; i < plan.length; i++) {
    const philosophy = plan[i] as Philosophy;
    const ctx: GenContext = { dna, philosophy, cycle: i + 1, rng };
    log(`cycle ${i + 1}/${plan.length} — ${philosophy}`);
    emit({
      stage: 'cycle',
      message: `Cycle ${i + 1} of ${plan.length} — ${philosophy}`,
      progress: 0.16 + cycleShare * i,
    });
    const { report, pool, stale } = await runCycle(
      seeds,
      ctx,
      options.perCycle,
      seen,
      alreadyShown,
    );
    pools.push(pool);
    stalePools.push(stale);
    log(`  generated ${report.generated}, ${report.survived} scored ${STRONG_SCORE}+`);
    emit({
      stage: 'cycle',
      message: `Cycle ${i + 1}: ${report.generated} generated, ${report.survived} scored ${STRONG_SCORE}+`,
      progress: 0.16 + cycleShare * (i + 1),
      preview: show(report.top.slice(0, 6)),
    });
    cycles.push(report);
  }

  const scoredPool = unique(pools.flat(), (c) => c.name).sort(byScore);
  const stalePool = unique(stalePools.flat(), (c) => c.name).sort(byScore);

  let history: DiscoveryResult['history'];
  let ranked = scoredPool;

  if (options.excludeSeen !== false) {
    // Once the history covers most of what this brief produces, repeats beat a
    // short sheet — so the excluded names come back rather than the run
    // returning fewer finalists than asked for.
    const exhausted = scoredPool.length < options.validate;
    ranked = exhausted ? [...scoredPool, ...stalePool].sort(byScore) : scoredPool;
    history = {
      excluded: stalePool.length,
      remembered: alreadyShown.size,
      exhausted,
    };
    if (stalePool.length > 0) {
      log(`skipping ${stalePool.length} names shown by earlier runs`);
    }
    if (exhausted) {
      log(`  history covers this brief — allowing repeats so the sheet is not short`);
    }
  }

  // Ask for more than we need, so names a screen rejects can be replaced without
  // another ranking pass.
  const wantAppStoreClear = options.requireAppStoreClear !== false && !options.offline;
  const requiredTld = options.offline ? undefined : options.requireTld;
  const screening = wantAppStoreClear || Boolean(requiredTld);
  const ordered = buildShortlist(ranked, options.validate * (screening ? 4 : 1));

  let shortlist = ordered.slice(0, options.validate);
  let appStoreScreen: DiscoveryResult['appStoreScreen'];
  let prescreen: DiscoveryResult['prescreen'];
  const storeChecks = new Map<string, Awaited<ReturnType<typeof checkAppStores>>>();
  const domainChecks = new Map<string, Awaited<ReturnType<typeof checkDomain>>>();

  if (screening) {
    // Both dealbreakers are checked here rather than across the whole pool: the
    // iTunes Search API is rate limited at roughly twenty calls a minute, and
    // the domain check costs an HTTP fetch each. Verify the shortlist, drop what
    // fails, pull replacements, repeat.
    log(
      `screening ${options.validate} finalists` +
        `${wantAppStoreClear ? ' — app stores' : ''}${requiredTld ? ` — .${requiredTld} in use` : ''}`,
    );
    emit({
      stage: 'validate',
      message: wantAppStoreClear
        ? 'Checking the App Store, Play Store and live sites'
        : 'Checking for live sites on the domain',
      progress: 0.8,
    });

    const cleared: Candidate[] = [];
    const rejectedByStore: string[] = [];
    const rejectedByDomain: string[] = [];
    let unresolved = 0;
    let cursor = 0;

    while (cleared.length < options.validate && cursor < ordered.length) {
      const batch = ordered.slice(cursor, cursor + (options.validate - cleared.length));
      cursor += batch.length;

      const results = await mapLimit(batch, 3, async (candidate) => {
        const [store, domain] = await Promise.all([
          wantAppStoreClear ? checkAppStores(candidate.display) : Promise.resolve(undefined),
          requiredTld ? checkDomain(candidate.name, requiredTld) : Promise.resolve(undefined),
        ]);
        return { candidate, store, domain };
      });

      for (const { candidate, store, domain } of results) {
        if (store) storeChecks.set(candidate.name, store);
        if (domain) domainChecks.set(candidate.name, domain);

        if (store?.taken) {
          rejectedByStore.push(candidate.display);
          continue;
        }
        // Only a live business is disqualifying. Parked, for sale, squatted and
        // dormant domains all serve nothing and can be acquired or waited out.
        if (domain?.status === 'taken') {
          rejectedByDomain.push(`${candidate.display} (${domain.detail ?? 'live site'})`);
          continue;
        }
        if (store && !store.conclusive) unresolved++;
        cleared.push(candidate);
      }

      emit({
        stage: 'validate',
        message: `${cleared.length} of ${options.validate} clear`,
        progress: 0.8 + 0.06 * (cursor / Math.max(1, ordered.length)),
      });
    }

    shortlist = cleared.slice(0, options.validate);
    if (wantAppStoreClear) {
      appStoreScreen = {
        examined: cursor,
        rejected: rejectedByStore.length,
        unresolved,
        names: rejectedByStore.slice(0, 12),
      };
    }
    if (requiredTld) {
      prescreen = {
        tld: requiredTld,
        examined: cursor,
        available: cleared.length,
      };
    }
    log(
      `  ${rejectedByStore.length} rejected for an app listing, ` +
        `${rejectedByDomain.length} for a live site on the domain`,
    );
  }

  log(`validating ${shortlist.length} finalists${options.offline ? ' (offline — heuristics only)' : ''}`);
  emit({
    stage: 'validate',
    message: options.offline
      ? `Screening ${shortlist.length} finalists (offline — heuristics only)`
      : `Checking domains, handles and marks for ${shortlist.length} finalists`,
    progress: 0.88,
    preview: show(shortlist.slice(0, 6)),
  });

  let checked = 0;
  const validated = await mapLimit(shortlist, 4, async (candidate) => {
    const [domains, social, trademark] = await Promise.all([
      checkDomains(candidate.name, options.tlds),
      checkSocial(candidate.name),
      checkTrademark(candidate.name, dna.industryNow, !options.offline),
    ]);
    checked++;
    emit({
      stage: 'validate',
      message: `Checked ${checked} of ${shortlist.length} — ${candidate.display}`,
      progress: 0.88 + (0.11 * checked) / Math.max(1, shortlist.length),
    });
    const stores = storeChecks.get(candidate.name);
    return rescoreWithValidation(
      {
        ...candidate,
        validation: {
          domains,
          social,
          trademark,
          appStores: stores?.verdicts.map((v) => ({
            store: v.store,
            status: v.status,
            matches: v.matches,
            method: v.method,
            url: v.url,
          })),
        },
      },
      dna,
    );
  });

  const finalists = validated.sort(byScore);

  // Stage 7 hand-off: where the next run should look.
  const mutationCtx: GenContext = {
    dna,
    philosophy: PHILOSOPHIES[plan.length % PHILOSOPHIES.length] as Philosophy,
    cycle: plan.length + 1,
    rng,
  };
  const nextMutations = unique(
    finalists.slice(0, 3).flatMap((c) => mutate(c, mutationCtx, 8).map((m) => m.display)),
  ).filter((name) => !seen.has(normalize(name))).slice(0, 15);

  emit({
    stage: 'done',
    message: `${cycles.reduce((sum, c) => sum + c.generated, 0)} candidates considered`,
    progress: 1,
    preview: show(finalists.slice(0, 6)),
  });

  if (options.recordSeen !== false) {
    // Every finalist, plus everything the previews and cycle summaries already
    // put on screen. Deliberately NOT the 'next mutations' list: that is a
    // forward-looking suggestion of where to search, and blacklisting it would
    // guarantee those names could never actually be produced.
    show(finalists);

    // Which source words each shown name actually spent, so later runs can
    // weight that material down.
    const wordsFor = new Map<string, string[]>();
    for (const candidate of [...finalists, ...cycles.flatMap((c) => c.top.slice(0, 6))]) {
      if (!shown.has(candidate.display)) continue;
      const used = candidate.seeds
        .filter((s) => s.form.length >= 3 && candidate.name.includes(s.form))
        .map((s) => s.form);
      // Keyed by the normalized name, because that is what recordSeen writes.
      if (used.length) wordsFor.set(candidate.name, [...new Set(used)]);
    }
    await recordSeen([...shown], options.brief, wordsFor);
  }

  return {
    dna,
    seedValue: options.seedValue,
    prescreen,
    appStoreScreen,
    history,
    cycles,
    finalists,
    nextMutations,
    generatedTotal: cycles.reduce((sum, c) => sum + c.generated, 0),
  };
}

// ---------------------------------------------------------------------------
// Report
// ---------------------------------------------------------------------------

function bar(value: number): string {
  const filled = Math.round(value / 10);
  return '█'.repeat(filled) + '░'.repeat(10 - filled);
}

function availabilityLine(candidate: Candidate): string {
  const v = candidate.validation;
  if (!v) return '_not validated_';
  const domains = v.domains
    .map((d) => `${d.domain} **${d.status}**${d.method === 'offline' ? '' : ` (${d.method})`}`)
    .join(' · ');
  const social = v.social.map((s) => `${s.platform} **${s.status}**`).join(' · ');
  return `${domains}\n\n  Handles: ${social}`;
}

export function renderReport(result: DiscoveryResult, options: DiscoveryOptions): string {
  const { dna, finalists, cycles } = result;
  const lines: string[] = [];

  lines.push('# Brand Discovery Report', '');
  lines.push(`**Brief:** ${dna.brief}`, '');

  lines.push('## Brand DNA', '');
  lines.push(`| | |`, `|---|---|`);
  lines.push(`| Problem | ${dna.problem} |`);
  lines.push(`| Users | ${dna.users} |`);
  lines.push(`| Emotional target | ${dna.emotions.join(', ')} |`);
  lines.push(`| Industry today | ${dna.industryNow} |`);
  lines.push(`| Industry tomorrow | ${dna.industryLater} |`);
  lines.push(`| Posture | **${dna.posture}** — ${dna.posture === 'evoke' ? 'the name should create a feeling, not explain the product' : dna.posture === 'describe' ? 'the name should tell people what this is' : 'the name should hint at the category while carrying feeling'} |`);
  lines.push(`| Concept space | ${dna.concepts.join(', ')} |`);
  lines.push(`| Sound targets | ${dna.soundTargets.join('; ')} |`);
  lines.push(`| Syllable target | ${dna.syllableRange[0]}–${dna.syllableRange[1]} |`);
  if (dna.avoid.length) lines.push(`| Ruled out | ${dna.avoid.join(', ')} |`);
  lines.push('');

  lines.push('## Naming strategy by cycle', '');
  for (const cycle of cycles) {
    lines.push(
      `**Cycle ${cycle.cycle} — ${cycle.philosophy}.** ${PHILOSOPHY_NOTES[cycle.philosophy]} ` +
        `Generated ${cycle.generated}; ${cycle.survived} scored ${STRONG_SCORE}+. ` +
        `Best: ${cycle.top.slice(0, 5).map((c) => c.display).join(', ')}.`,
    );
    lines.push('');
  }

  lines.push('## Top candidates', '');
  lines.push('| # | Name | Overall | Mem | Pron | Prem | Scale | Intl | TM est. | Domains | Strategy |');
  lines.push('|---|------|---------|-----|------|------|-------|------|---------|---------|----------|');
  finalists.slice(0, 20).forEach((c, i) => {
    const s = c.scores;
    const domains = c.validation
      ? c.validation.domains.filter((d) => d.status === 'available').map((d) => `.${d.domain.split('.').at(-1)}`).join(' ') || '—'
      : '—';
    lines.push(
      `| ${i + 1} | **${c.display}** | ${s?.overall ?? 0} | ${Math.round(s?.memorability ?? 0)} | ${Math.round(s?.pronunciation ?? 0)} | ${Math.round(s?.premium ?? 0)} | ${Math.round(s?.scalability ?? 0)} | ${Math.round(s?.international ?? 0)} | ${Math.round(s?.trademarkUniqueness ?? 0)} | ${domains} | ${c.strategy} |`,
    );
  });
  lines.push('');

  lines.push('## The shortlist in detail', '');
  for (const [index, c] of finalists.slice(0, 8).entries()) {
    const s = c.scores;
    lines.push(`### ${index + 1}. ${c.display}`, '');
    lines.push(`*${c.rationale}*`, '');
    lines.push('```');
    lines.push(`overall        ${bar(s?.overall ?? 0)} ${s?.overall ?? 0}`);
    lines.push(`memorability   ${bar(s?.memorability ?? 0)} ${Math.round(s?.memorability ?? 0)}`);
    lines.push(`pronunciation  ${bar(s?.pronunciation ?? 0)} ${Math.round(s?.pronunciation ?? 0)}`);
    lines.push(`visual         ${bar(s?.visual ?? 0)} ${Math.round(s?.visual ?? 0)}`);
    lines.push(`emotional fit  ${bar(s?.emotion ?? 0)} ${Math.round(s?.emotion ?? 0)}`);
    lines.push(`premium feel   ${bar(s?.premium ?? 0)} ${Math.round(s?.premium ?? 0)}`);
    lines.push(`scalability    ${bar(s?.scalability ?? 0)} ${Math.round(s?.scalability ?? 0)}`);
    lines.push(`international  ${bar(s?.international ?? 0)} ${Math.round(s?.international ?? 0)}`);
    lines.push(`trademark est. ${bar(s?.trademarkUniqueness ?? 0)} ${Math.round(s?.trademarkUniqueness ?? 0)}`);
    lines.push(`domain est.    ${bar(s?.domainUniqueness ?? 0)} ${Math.round(s?.domainUniqueness ?? 0)}`);
    lines.push('```', '');

    if (c.seeds.length) {
      lines.push(`**Roots:** ${c.seeds.map((seed) => `${seed.form} — ${seed.gloss} (${seed.language})`).join('; ')}`, '');
    }
    lines.push(`**Availability:** ${availabilityLine(c)}`, '');

    if (c.risks.length) {
      lines.push('**Risks:**');
      for (const risk of unique(c.risks)) lines.push(`- ${risk}`);
      lines.push('');
    } else {
      lines.push('**Risks:** none detected by the offline screens.', '');
    }

    if (index < 3) {
      lines.push(
        `**Clear it properly:** ${clearanceLinks(c.display).map((l) => `[${l.registry}](${l.url})`).join(' · ')}`,
        '',
      );
    }
  }

  lines.push('## Suggested next mutations', '');
  lines.push(
    result.nextMutations.length
      ? result.nextMutations.join(' · ')
      : '_no untried descendants — widen the seed set or change philosophy._',
  );
  lines.push('');

  lines.push('## Method and limits', '');
  lines.push(
    `- ${result.generatedTotal} candidates generated across ${cycles.length} cycles; ${finalists.length} validated.`,
    result.prescreen
      ? `- Required .${result.prescreen.tld}: ${result.prescreen.examined} candidates were checked for a live site, and names with a working business on the domain were dropped. Parked, for-sale, squatted and dormant domains were kept — those are obtainable, and registry data cannot tell them apart.`
      : options.requireTld
        ? `- **A .${options.requireTld} requirement was set but could not be enforced**, because this run was offline.`
        : `- No domain requirement was set, so names with a live site on the exact-match domain can appear. Their status is stamped on each entry.`,
    result.history && result.history.excluded > 0
      ? `- ${result.history.excluded} candidates were skipped because earlier runs already showed them (${result.history.remembered} names remembered)${result.history.exhausted ? '. The history now covers most of what this brief produces, so repeats were allowed to avoid a short sheet.' : '.'}`
      : `- No candidates had been shown before.`,
    result.appStoreScreen
      ? `- App stores: ${result.appStoreScreen.rejected} names dropped for an existing listing${result.appStoreScreen.unresolved > 0 ? `; ${result.appStoreScreen.unresolved} could not be confirmed on Play, which has no public API` : ''}.`
      : `- App store listings were not checked on this run.`,
    `- Domain status is from RDAP (the registry protocol) with DNS as a fallback. \`unknown\` means no authoritative answer — check a registrar.`,
    `- Handle checks are authoritative for GitHub and npm only; consumer platforms block automated probes.`,
    `- **Trademark scores are estimates**, computed from a corpus of well-known marks plus sight/sound/relatedness heuristics. They are a shortlisting filter, not a clearance search, and not legal advice. Every finalist needs a real search before you commit.`,
    `- Run seed \`${result.seedValue}\` — pass \`--seed ${result.seedValue}\` to reproduce this exact report.`,
  );

  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

function log(message: string): void {
  process.stderr.write(`  ${message}\n`);
}

/** A fresh search each run; `--seed` pins one you want back. */
function randomSeed(): number {
  return Math.floor(Math.random() * 2 ** 31) + 1;
}

function parseArgs(argv: string[]): DiscoveryOptions {
  const get = (flag: string): string | undefined => {
    const index = argv.indexOf(flag);
    return index >= 0 ? argv[index + 1] : undefined;
  };
  const has = (flag: string) => argv.includes(flag);
  const list = (flag: string) => get(flag)?.split(',').map((s) => s.trim()).filter(Boolean);

  const brief = get('--brief') ?? argv.filter((a) => !a.startsWith('--'))[2];
  if (!brief) {
    process.stderr.write(
      [
        'Brand Discovery Platform',
        '',
        'Usage: node discover.ts --brief "<what you are naming>" [options]',
        '',
        '  --brief <text>        what the thing is, in a sentence (required)',
        '  --industry <name>     current category, e.g. fintech, health, dev',
        '  --emotion <a,b,c>     emotional targets: calm, trust, energy, premium, ...',
        '  --audience <text>     who it is for',
        '  --posture <mode>      evoke | describe | balanced        (default: evoke)',
        '  --avoid <a,b>         words or fragments to rule out',
        '  --cycles <n>          naming philosophies to run          (default: 3)',
        `  --strategies <a,b>    run these philosophies by name instead of the first N:`,
        `                        ${PHILOSOPHIES.join(', ')}`,
        '  --per-cycle <n>       candidates generated per cycle      (default: 140)',
        '  --validate <n>        finalists to check availability for (default: 12)',
        '  --require-tld <tld>   drop candidates with a LIVE SITE on this domain',
        '                        (default: com; parked, for-sale, squatted and',
        '                        dormant domains are kept). "none" disables it.',
        '  --allow-app-collisions  keep names already shipping as an App Store or',
        '                        Play Store listing (default: those are dropped)',
        '  --repeat              allow names shown by earlier runs (default: skipped)',
        '  --no-history          do not remember this run\'s finalists',
        '  --forget              erase the history of shown names, then exit',

        '  --tlds <a,b>          TLDs to check          (default: com,io,ai,co)',
        '  --syllables <a-b>     target syllable range               (default: 2-3)',
        '  --seed <n>            pin the run seed to reproduce a run  (default: random)',
        '  --out <file>          write the markdown report to a file',
        '  --json                emit JSON instead of markdown',
        '  --offline             skip every network call',
        '',
      ].join('\n'),
    );
    process.exit(1);
  }

  const syllables = get('--syllables')?.split('-').map(Number);
  const strategies = list('--strategies')?.filter((p): p is Philosophy =>
    (PHILOSOPHIES as string[]).includes(p),
  );

  return {
    brief: brief as string,
    industry: get('--industry'),
    emotions: list('--emotion'),
    audience: get('--audience'),
    posture: (get('--posture') as DiscoveryOptions['posture']) ?? 'evoke',
    avoid: list('--avoid'),
    cycles: Number(get('--cycles') ?? 3),
    perCycle: Number(get('--per-cycle') ?? 140),
    validate: Number(get('--validate') ?? 12),
    // On by default, but it now rejects only domains with a live business on
    // them. Parked, for-sale, squatted and dormant all stay in.
    requireTld: (() => {
      const asked = get('--require-tld')?.replace(/^\./, '').toLowerCase() ?? 'com';
      return asked === 'none' ? undefined : asked;
    })(),
    requireAppStoreClear: !has('--allow-app-collisions'),
    excludeSeen: !has('--repeat'),
    recordSeen: !has('--no-history'),
    philosophies:
      strategies ??
      // Match the form's default: roots, compounds and real-word metaphor, which
      // spans three genuinely different searches. Taking the head of the
      // rotation gave two coinage-heavy cycles and no compounds at all.
      (['evocative-classical', 'compound-utility', 'plain-english-metaphor'] as Philosophy[]),
    prescreen: get('--prescreen') ? Number(get('--prescreen')) : undefined,
    tlds: list('--tlds') ?? DEFAULT_TLDS,
    offline: has('--offline'),
    seedValue: Number(get('--seed') ?? randomSeed()),
    syllableRange:
      syllables && syllables.length === 2 && syllables.every((n) => Number.isFinite(n))
        ? [syllables[0] as number, syllables[1] as number]
        : undefined,
    outFile: get('--out'),
  };
}

async function main(): Promise<void> {
  if (process.argv.includes('--forget')) {
    const { forgetSeen, historyPath } = await import('./core/history.ts');
    await forgetSeen();
    process.stderr.write(`  erased ${historyPath()}\n`);
    return;
  }

  const options = parseArgs(process.argv);
  const started = Date.now();

  const result = await discover(options);

  const output = process.argv.includes('--json')
    ? JSON.stringify(result, null, 2)
    : renderReport(result, options);

  if (options.outFile) {
    await writeFile(options.outFile, output, 'utf8');
    log(`report written to ${options.outFile}`);
  } else {
    process.stdout.write(`${output}\n`);
  }

  const stats = netStats();
  log(
    `done in ${((Date.now() - started) / 1000).toFixed(1)}s — ` +
      `${result.generatedTotal} candidates, ${stats.calls} network calls, ${stats.cacheHits} cache hits`,
  );
}

const invokedDirectly = process.argv[1]?.endsWith('discover.ts');
if (invokedDirectly) {
  main().catch((error: unknown) => {
    process.stderr.write(`brandy failed: ${String(error)}\n`);
    process.exitCode = 1;
  });
}
