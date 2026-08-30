/**
 * Stage 6: composite scoring.
 *
 * Two passes. `scoreCandidate` runs every analyzer and sub-scorer and produces
 * a ranking score for the hundreds of candidates in a cycle — cheap, offline,
 * and good enough to sort by. `rescoreWithValidation` folds in the network
 * verdicts for the handful of finalists that earn a real availability check.
 *
 * Vetoes matter more than weights here. A name with a blocking meaning or a
 * near-identical famous mark is not a low-scoring name, it is a dead name, and
 * averaging cannot be allowed to rescue it.
 */

import { analyzePronounceability } from '../analyzers/pronounceability.ts';
import { analyzeReadability } from '../analyzers/readability.ts';
import { analyzeSentiment } from '../analyzers/sentiment.ts';
import { analyzeUniqueness } from '../analyzers/uniqueness.ts';
import { scoreBrandability, scoreInternational, scoreScalability } from './brandability.ts';
import { scoreMemorability } from './memorability.ts';
import { scorePremium } from './premium.ts';
import { domainScore } from '../validators/domains.ts';
import { socialScore } from '../validators/social.ts';
import { profile } from '../core/phonology.ts';
import { clamp } from '../core/text.ts';
import type { BrandDNA, Candidate, Scores } from '../core/types.ts';

const WEIGHTS: Record<keyof Omit<Scores, 'overall'>, number> = {
  memorability: 0.22,
  pronunciation: 0.12,
  visual: 0.07,
  brandability: 0.13,
  emotion: 0.1,
  premium: 0.08,
  scalability: 0.08,
  international: 0.06,
  trademarkUniqueness: 0.08,
  domainUniqueness: 0.04,
  socialUniqueness: 0.02,
};

/**
 * Offline stand-in for a domain check. Short real words are gone; long coined
 * words are almost always free. Replaced by the real answer for finalists.
 */
function estimateDomainScarcity(name: string, rarity: number, isRealWord: boolean): number {
  const letters = name.length;
  let score = 30 + (rarity - 40) * 0.5 + Math.max(0, letters - 5) * 9;
  if (isRealWord) score -= 40;
  if (letters <= 4) score -= 25;
  return clamp(score);
}

/** How much inherited meaning a candidate still carries. */
const IMAGERY_BY_SOURCE: Record<string, number> = {
  concept: 1,
  wikipedia: 1,
  dictionary: 0.85,
  thesaurus: 0.8,
  translation: 0.75,
  etymology: 0.6,
  brief: 0.12,
};

/**
 * How much of a root actually survives in the finished name. 'Lumora' keeps
 * all of 'lum'; 'Jyotnaa' keeps four letters of 'jyoti'; 'Kavrix' keeps a 'k'.
 * Only what survives can carry meaning to an audience.
 */
function retention(name: string, root: string): number {
  if (!root) return 0;
  if (name.includes(root)) return 1;
  let shared = 0;
  while (shared < root.length && shared < name.length && name[shared] === root[shared]) shared++;
  return shared / root.length;
}

function imageryOf(candidate: Candidate, isRealWord: boolean): number {
  if (isRealWord) return 1;
  const parts = candidate.seeds.map((s) => {
    const base = IMAGERY_BY_SOURCE[s.source] ?? 0.3;
    // A root you can no longer hear in the name is a story for the deck,
    // not a signal the audience receives.
    return base * (0.3 + 0.7 * retention(candidate.name, s.form));
  });

  // A name assembled from more than one root means what it means because ALL of
  // them are readable, so the parts average rather than compete. Taking the best
  // part let a mutation that destroyed one half — 'Clayslate' cut down to
  // 'Claysla' — keep the full imagery credit of the half that happened to
  // survive, and then outrank the intact compound it came from.
  const best =
    candidate.seeds.length > 1
      ? Math.max(0.12, parts.reduce((sum, p) => sum + p, 0) / parts.length)
      : Math.max(0.12, ...parts);
  // Every mutation step dilutes the tie back to the root. 'Lumora' still reads
  // as light; three vowel shifts later, that connection is a story we tell
  // ourselves rather than one an audience can hear.
  return best / (1 + 0.6 * candidate.lineage.length);
}

/**
 * How many whole, familiar words the finished name still contains. Only roots
 * that survived intact count — a clipped stem is not a chunk a reader parses.
 */
function chunksIn(candidate: Candidate): number {
  const intact = candidate.seeds.filter(
    (s) => s.form.length >= 3 && s.language === 'english' && candidate.name.includes(s.form),
  );
  return Math.max(1, new Set(intact.map((s) => s.form)).size);
}

export interface ScoringResult {
  scores: Scores;
  risks: string[];
  notes: string[];
}

export async function scoreCandidate(candidate: Candidate, dna: BrandDNA): Promise<ScoringResult> {
  const name = candidate.name;

  const pronounce = analyzePronounceability(name);
  const visual = analyzeReadability(name);
  const sentiment = analyzeSentiment(name, dna.emotions);
  const uniqueness = await analyzeUniqueness(name);

  const chunks = chunksIn(candidate);
  const memorability = scoreMemorability(name, {
    rarity: uniqueness.rarity,
    imagery: imageryOf(candidate, uniqueness.isRealWord),
    isRealWord: uniqueness.isRealWord,
    chunks,
  });
  const premium = scorePremium(name, candidate.strategy, chunks);
  const scalability = scoreScalability(name, dna);
  const international = scoreInternational(name);
  const brandability = scoreBrandability(name, {
    pronunciation: pronounce.score,
    visual: visual.score,
    uniqueness: uniqueness.score,
    spellability: pronounce.spellability,
    strategy: candidate.strategy,
  });

  const scores: Scores = {
    memorability: memorability.score,
    pronunciation: pronounce.score,
    visual: visual.score,
    brandability: brandability.score,
    emotion: sentiment.score,
    premium: premium.score,
    scalability: scalability.score,
    international: international.score,
    trademarkUniqueness: uniqueness.score,
    domainUniqueness: estimateDomainScarcity(name, uniqueness.rarity, uniqueness.isRealWord),
    socialUniqueness: estimateDomainScarcity(name, uniqueness.rarity, uniqueness.isRealWord) * 0.9,
    overall: 0,
  };

  const risks = [...sentiment.risks];
  if (uniqueness.alienShare > 0.5) {
    risks.push('reads as random syllables — no morphological anchor in any source language');
  }

  const p = profile(name);
  if (p.syllableCount < dna.syllableRange[0] || p.syllableCount > dna.syllableRange[1]) {
    risks.push(
      `${p.syllableCount} syllables, outside the ${dna.syllableRange[0]}–${dna.syllableRange[1]} target for this brief`,
    );
  }
  for (const avoid of dna.avoid) {
    if (avoid.length >= 3 && name.includes(avoid.toLowerCase())) {
      risks.push(`contains '${avoid}', which the brief rules out`);
    }
  }

  scores.overall = composite(scores, risks, dna, p.syllableCount);

  return {
    scores,
    risks,
    notes: [
      ...memorability.notes,
      ...sentiment.notes,
      ...premium.notes,
      ...visual.notes,
      ...international.notes,
      ...scalability.notes,
      ...brandability.notes,
      ...uniqueness.notes,
      ...pronounce.notes,
    ],
  };
}

function composite(scores: Scores, risks: string[], dna: BrandDNA, syllables: number): number {
  let total = 0;
  for (const [key, weight] of Object.entries(WEIGHTS) as [keyof typeof WEIGHTS, number][]) {
    total += scores[key] * weight;
  }

  // Posture reweighting: a brand meant to evoke lives or dies on feeling; one
  // meant to describe is judged on clarity.
  if (dna.posture === 'evoke') total += (scores.emotion - 60) * 0.05 + (scores.memorability - 60) * 0.04;
  if (dna.posture === 'describe') total += (scores.pronunciation - 60) * 0.05;

  if (syllables < dna.syllableRange[0] || syllables > dna.syllableRange[1]) total -= 6;

  // Vetoes.
  const blocking = risks.some((r) => r.startsWith('BLOCK:'));
  if (blocking) return Math.min(total, 12);
  // The brief rules out random syllables outright, so this is a veto rather
  // than a deduction — no amount of rhythm rescues a name nobody can hold.
  if (risks.some((r) => r.startsWith('reads as random syllables'))) total = Math.min(total, 58);
  if (scores.pronunciation < 45) total = Math.min(total, 45);
  if (scores.trademarkUniqueness < 30) total = Math.min(total, 42);

  return Math.round(clamp(total) * 10) / 10;
}

/** Fold real availability data into an already-scored finalist. */
export function rescoreWithValidation(candidate: Candidate, dna: BrandDNA): Candidate {
  if (!candidate.scores || !candidate.validation) return candidate;

  const scores: Scores = {
    ...candidate.scores,
    domainUniqueness: domainScore(candidate.validation.domains),
    socialUniqueness: socialScore(candidate.validation.social),
    trademarkUniqueness: Math.round(
      (candidate.scores.trademarkUniqueness + candidate.validation.trademark.uniqueness) / 2,
    ),
  };

  const risks = [...candidate.risks];
  for (const collision of candidate.validation.trademark.collisions) {
    const line = `trademark: ${collision.reason} '${collision.mark}'`;
    if (!risks.some((r) => r.includes(collision.mark))) risks.push(line);
  }
  const takenCom = candidate.validation.domains.find(
    (d) => d.domain.endsWith('.com') && d.status === 'taken',
  );
  if (takenCom) risks.push('exact-match .com is registered');

  const syllables = profile(candidate.name).syllableCount;
  scores.overall = composite(scores, risks, dna, syllables);

  return { ...candidate, scores, risks };
}
