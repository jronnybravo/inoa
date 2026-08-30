/**
 * Sound symbolism and safety screening.
 *
 * Phonetic sound symbolism is one of the few genuinely reliable findings in
 * naming research: front vowels and voiceless stops read small, sharp and fast;
 * back vowels and voiced continuants read large, soft and slow. This analyzer
 * measures a name's phonetic profile and asks how well it matches the feeling
 * the brief asked for — then screens the result for meanings nobody intended.
 */

import { profile, FRONT_VOWELS, BACK_VOWELS, OPEN_VOWELS, LIQUIDS, NASALS, PLOSIVES, SIBILANTS, letterShare } from '../core/phonology.ts';
import { clamp } from '../core/text.ts';

type Feature =
  | 'liquid' | 'nasal' | 'plosive' | 'sibilant'
  | 'front' | 'back' | 'open'
  | 'endsVowel' | 'brevity';

/** Desired level (0..1) of each feature for a given emotional target. */
const EMOTION_PROFILES: Record<string, Partial<Record<Feature, number>>> = {
  calm:      { liquid: 0.3, nasal: 0.25, plosive: 0.05, back: 0.25, open: 0.35, endsVowel: 0.8 },
  trust:     { liquid: 0.25, nasal: 0.3, plosive: 0.15, open: 0.3, sibilant: 0.05 },
  warmth:    { liquid: 0.25, nasal: 0.3, open: 0.4, back: 0.3, endsVowel: 0.8 },
  care:      { liquid: 0.3, nasal: 0.3, plosive: 0.1, open: 0.35, endsVowel: 0.7 },
  energy:    { plosive: 0.35, front: 0.3, sibilant: 0.2, brevity: 0.8 },
  speed:     { plosive: 0.3, front: 0.4, brevity: 0.9, endsVowel: 0.2 },
  precision: { plosive: 0.35, front: 0.35, sibilant: 0.15, brevity: 0.7, endsVowel: 0.2 },
  power:     { plosive: 0.35, back: 0.35, open: 0.4, brevity: 0.6 },
  strength:  { plosive: 0.3, back: 0.3, nasal: 0.15, brevity: 0.6 },
  premium:   { liquid: 0.25, open: 0.35, plosive: 0.1, endsVowel: 0.7, sibilant: 0.05 },
  luxury:    { liquid: 0.3, open: 0.4, plosive: 0.05, endsVowel: 0.8 },
  playful:   { plosive: 0.3, front: 0.35, brevity: 0.85, endsVowel: 0.5 },
  joy:       { open: 0.4, liquid: 0.25, front: 0.3, endsVowel: 0.7 },
  intelligence: { sibilant: 0.15, plosive: 0.25, front: 0.3, liquid: 0.2 },
  clarity:   { front: 0.35, liquid: 0.25, plosive: 0.2, brevity: 0.7 },
  wonder:    { open: 0.4, liquid: 0.3, back: 0.25, endsVowel: 0.7 },
  freedom:   { open: 0.4, liquid: 0.25, endsVowel: 0.6 },
  safety:    { nasal: 0.3, liquid: 0.25, plosive: 0.15, back: 0.25 },
  growth:    { open: 0.35, liquid: 0.25, nasal: 0.2, endsVowel: 0.6 },
  craft:     { plosive: 0.25, liquid: 0.2, brevity: 0.6 },
  simplicity:{ brevity: 0.9, plosive: 0.2, liquid: 0.2 },
};

export interface SentimentReport {
  /** How well the sound matches the brief's emotional target, 0..100. */
  score: number;
  /** Intrinsic pleasantness of the sound, independent of the brief, 0..100. */
  valence: number;
  notes: string[];
  risks: string[];
}

function features(name: string): Record<Feature, number> {
  const p = profile(name);
  return {
    liquid: letterShare(name, LIQUIDS),
    nasal: letterShare(name, NASALS),
    plosive: letterShare(name, PLOSIVES),
    sibilant: letterShare(name, SIBILANTS),
    front: letterShare(name, FRONT_VOWELS),
    back: letterShare(name, BACK_VOWELS),
    open: letterShare(name, OPEN_VOWELS),
    endsVowel: p.endsInVowel ? 1 : 0,
    // 4 letters reads as maximally brief, 12 as not brief at all.
    brevity: clamp((12 - p.letters) / 8, 0, 1),
  };
}

export function analyzeSentiment(name: string, emotions: string[]): SentimentReport {
  const f = features(name);
  const notes: string[] = [];

  const targets = emotions
    .map((e) => EMOTION_PROFILES[e.toLowerCase()])
    .filter((t): t is Partial<Record<Feature, number>> => Boolean(t));

  let score = 60;
  if (targets.length > 0) {
    let total = 0;
    let count = 0;
    for (const target of targets) {
      for (const [feature, desired] of Object.entries(target) as [Feature, number][]) {
        total += 1 - Math.min(1, Math.abs(f[feature] - desired) / 0.5);
        count++;
      }
    }
    score = count > 0 ? (total / count) * 100 : 60;
  }

  // Intrinsic pleasantness: liquids and open vowels up, sibilant/plosive stacks down.
  let valence = 55;
  valence += f.liquid * 45 + f.nasal * 30 + f.open * 35;
  valence -= Math.max(0, f.plosive - 0.35) * 60;
  valence -= Math.max(0, f.sibilant - 0.25) * 50;
  if (f.endsVowel) valence += 6;

  if (f.liquid >= 0.25) notes.push('liquid consonants give it flow when spoken');
  if (f.plosive >= 0.35) notes.push('plosive-forward — reads as decisive, technical, energetic');
  if (f.open >= 0.35) notes.push('open vowels give it size and warmth');
  if (f.front >= 0.35) notes.push('front vowels read fast, small and precise');
  if (f.back >= 0.3) notes.push('back vowels read deep, calm and substantial');

  return {
    score: clamp(score),
    valence: clamp(valence),
    notes,
    // Cross-linguistic screening was removed with its word list. Nothing here
    // checks whether the name means something crude or unfortunate in another
    // language; that read is now entirely the user's to make.
    risks: [],
  };
}
