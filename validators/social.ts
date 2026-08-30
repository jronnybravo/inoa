/**
 * Handle availability.
 *
 * Only two of these are trustworthy: GitHub and npm both expose real APIs that
 * answer 404 for a free name. The consumer social platforms actively block
 * automated probes and will happily return 200 for a nonexistent profile, so
 * they are checked on an opt-in basis and always reported as indicative.
 *
 * Treat everything here as a shortlist filter, not a reservation.
 */

import { isOffline, mapLimit, probe } from '../core/net.ts';
import { normalize } from '../core/text.ts';
import type { Availability, SocialCheck } from '../core/types.ts';

interface Platform {
  name: string;
  /** The endpoint that answers truthfully. */
  url: (handle: string) => string;
  /** The page a person would open. */
  page: (handle: string) => string;
  /** Does this platform give a truthful 404? */
  reliable: boolean;
  method: 'GET' | 'HEAD';
}

const PLATFORMS: Platform[] = [
  {
    name: 'github',
    url: (h) => `https://api.github.com/users/${h}`,
    page: (h) => `https://github.com/${h}`,
    reliable: true,
    method: 'GET',
  },
  {
    name: 'npm',
    url: (h) => `https://registry.npmjs.org/${h}`,
    page: (h) => `https://www.npmjs.com/package/${h}`,
    reliable: true,
    method: 'GET',
  },
  {
    name: 'x',
    url: (h) => `https://x.com/${h}`,
    page: (h) => `https://x.com/${h}`,
    reliable: false,
    method: 'GET',
  },
  {
    name: 'instagram',
    url: (h) => `https://www.instagram.com/${h}/`,
    page: (h) => `https://www.instagram.com/${h}/`,
    reliable: false,
    method: 'GET',
  },
  {
    name: 'linkedin',
    url: (h) => `https://www.linkedin.com/company/${h}`,
    page: (h) => `https://www.linkedin.com/company/${h}`,
    reliable: false,
    method: 'GET',
  },
];

function interpret(status: number | undefined, reliable: boolean): Availability {
  if (status === undefined) return 'unknown';
  if (status === 404 || status === 410) return 'available';
  if (status === 200) return reliable ? 'taken' : 'unknown';
  // 301/302/403/429 from a consumer platform means "we noticed you", not "taken".
  return 'unknown';
}

export async function checkSocial(name: string, deep = false): Promise<SocialCheck[]> {
  const handle = normalize(name);
  const platforms = deep ? PLATFORMS : PLATFORMS.filter((p) => p.reliable);

  if (isOffline()) {
    return platforms.map((p) => ({
      platform: p.name,
      handle,
      status: 'unknown' as Availability,
      method: 'offline',
    }));
  }

  return mapLimit(platforms, 3, async (platform) => {
    const status = await probe(platform.url(handle), {
      method: platform.method,
      timeoutMs: 6000,
      ttlMs: 7 * 24 * 60 * 60 * 1000,
    });
    return {
      platform: platform.name,
      handle,
      status: interpret(status, platform.reliable),
      method: platform.reliable ? 'api' : 'page-probe (indicative only)',
      // The human-facing page, not the API endpoint that was probed: a taken
      // handle is worth going and looking at.
      url: platform.page(handle),
    };
  });
}

export function socialScore(checks: SocialCheck[]): number {
  if (checks.length === 0) return 50;
  let earned = 0;
  for (const check of checks) {
    if (check.status === 'available') earned += 1;
    else if (check.status === 'unknown') earned += 0.5;
  }
  return Math.round((earned / checks.length) * 100);
}
