/**
 * Turn untrusted query parameters into a DiscoveryOptions the engine will accept.
 *
 * Everything is clamped. A discovery run is CPU- and network-bound, so the
 * request parameters are also the cost model: cycles × perCycle decides how
 * much work the server does, and `validate` decides how many outbound calls it
 * makes to public registries on someone else's behalf.
 */

import { DEFAULT_TLDS } from '../../validators/domains.ts';
import type { DiscoveryOptions, Philosophy } from '../../core/types.ts';

/**
 * Every naming philosophy the engine has, with the copy the form uses.
 *
 * All six are selectable. Taking the first N of a fixed rotation — the engine's
 * default — left compound and minimal-abstract naming unreachable from the web
 * app, which quietly narrowed the search to roots, coinages and metaphors.
 */
export const PHILOSOPHY_CHOICES: { value: Philosophy; label: string; blurb: string }[] = [
  {
    value: 'evocative-classical',
    label: 'Classical roots',
    blurb: 'Latin and Greek roots with modern brand endings — Lumora, Novaris.',
  },
  {
    value: 'compound-utility',
    label: 'Compounds',
    blurb: 'Two meanings fused into one word — Keystone, Lodestar, Nightfall.',
  },
  {
    value: 'plain-english-metaphor',
    label: 'English metaphor',
    blurb: 'One real word borrowed from another field — Cadence, Fathom.',
  },
  {
    value: 'invented-phonetic',
    label: 'Coined',
    blurb: 'Pure invention from curated sound palettes. Total ownership.',
  },
  {
    value: 'mythic-symbolic',
    label: 'Mythic',
    blurb: 'Mythology, astronomy and navigation — names with a story attached.',
  },
  {
    value: 'minimal-abstract',
    label: 'Minimal',
    blurb: 'Short, clipped, abstract. Maximum flexibility, least inherent meaning.',
  },
];

const VALID_PHILOSOPHIES = new Set(PHILOSOPHY_CHOICES.map((p) => p.value));

/**
 * Two ceilings, because there are two situations.
 *
 * On a public deployment a run spends this server's CPU and makes outbound
 * calls to Datamuse, Wikipedia and the RDAP registries on a stranger's behalf,
 * so it is capped tightly. On your own machine neither is a concern and the
 * limits are simply in the way — which is why a single hardcoded 12 was wrong.
 */
const PUBLIC_LIMITS = {
  cycles: { min: 1, max: 6, fallback: 3 },
  perCycle: { min: 40, max: 200, fallback: 130 },
  validate: { min: 1, max: 12, fallback: 8 },
  prescreen: { min: 10, max: 60, fallback: 60 },
} as const;

const LOCAL_LIMITS = {
  cycles: { min: 1, max: 6, fallback: 3 },
  perCycle: { min: 40, max: 400, fallback: 130 },
  validate: { min: 1, max: 40, fallback: 8 },
  prescreen: { min: 10, max: 250, fallback: 120 },
} as const;

const ALLOWED_TLDS = new Set([
  'com', 'io', 'ai', 'co', 'app', 'dev', 'net', 'org', 'so', 'xyz', 'studio', 'design',
]);

function int(value: string | null, limit: { min: number; max: number; fallback: number }): number {
  const parsed = Number.parseInt(value ?? '', 10);
  if (!Number.isFinite(parsed)) return limit.fallback;
  return Math.min(limit.max, Math.max(limit.min, parsed));
}

function list(value: string | null, max = 8): string[] | undefined {
  if (!value) return undefined;
  const items = value
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter((s) => s.length > 0 && s.length <= 30)
    .slice(0, max);
  return items.length ? items : undefined;
}

export class InvalidBriefError extends Error {}

export function optionsFromParams(
  params: URLSearchParams,
  opts: { local?: boolean } = {},
): DiscoveryOptions {
  const LIMITS = opts.local ? LOCAL_LIMITS : PUBLIC_LIMITS;
  const brief = (params.get('brief') ?? '').trim();
  if (brief.length < 10) {
    throw new InvalidBriefError('Describe what you are naming in at least a few words.');
  }
  if (brief.length > 600) {
    throw new InvalidBriefError('Keep the brief under 600 characters — a sentence or two is ideal.');
  }

  const posture = params.get('posture');
  const philosophies = list(params.get('philosophies'), 6)?.filter((p): p is Philosophy =>
    VALID_PHILOSOPHIES.has(p as Philosophy),
  );
  const syllables = params.get('syllables')?.split('-').map(Number);
  const tlds = list(params.get('tlds'), 6)?.filter((t) => ALLOWED_TLDS.has(t));
  // Off by default. A parked or for-sale .com is still purchasable, and RDAP
  // cannot tell those apart from a domain in active use, so requiring one
  // rejects names that are genuinely obtainable.
  const required = params.get('requireTld')?.replace(/^\./, '').toLowerCase() ?? 'none';

  return {
    brief,
    industry: params.get('industry')?.trim().slice(0, 60) || undefined,
    emotions: list(params.get('emotions'), 6),
    audience: params.get('audience')?.trim().slice(0, 200) || undefined,
    posture:
      posture === 'describe' || posture === 'balanced' || posture === 'evoke' ? posture : 'evoke',
    avoid: list(params.get('avoid'), 10),
    // The number of cycles IS the number of philosophies chosen.
    cycles: philosophies?.length ? philosophies.length : int(params.get('cycles'), LIMITS.cycles),
    philosophies: philosophies?.length ? philosophies : undefined,
    perCycle: int(params.get('perCycle'), LIMITS.perCycle),
    validate: int(params.get('validate'), LIMITS.validate),
    requireTld: ALLOWED_TLDS.has(required) ? required : undefined,
    // The real dealbreaker: a name already shipping as an app.
    requireAppStoreClear: params.get('allowAppCollisions') !== 'true',
    prescreen: int(params.get('prescreen'), LIMITS.prescreen),
    tlds: tlds?.length ? tlds : DEFAULT_TLDS,
    offline: params.get('offline') === 'true',
    // Random unless pinned: two runs of the same brief should explore
    // different ground. The seed used is reported back so a run can be replayed.
    seedValue: int(params.get('seed'), {
      min: 1,
      max: 2 ** 31 - 1,
      fallback: Math.floor(Math.random() * 2 ** 31) + 1,
    }),
    syllableRange:
      syllables?.length === 2 && syllables.every((n) => Number.isFinite(n) && n >= 1 && n <= 5)
        ? [syllables[0] as number, syllables[1] as number]
        : undefined,
  };
}

/** The emotional targets the scorer actually knows how to reason about. */
export const EMOTIONS = [
  'calm', 'trust', 'warmth', 'care', 'energy', 'speed', 'precision', 'power', 'strength',
  'premium', 'luxury', 'playful', 'joy', 'intelligence', 'clarity', 'wonder', 'freedom',
  'safety', 'growth', 'craft', 'simplicity',
] as const;

export const TLD_CHOICES = ['com', 'io', 'ai', 'co', 'app', 'dev'] as const;
