/**
 * App store presence.
 *
 * A name already shipping as an app is a harder collision than a registered
 * domain: the listing is public, indexed, and the first thing anyone searching
 * the name will find. A parked or for-sale domain can be bought; an app you are
 * competing with in search results cannot.
 *
 * Two very different sources:
 *
 *   - Apple's iTunes Search API is official, free and unauthenticated. It is
 *     also fuzzy — searching 'Warmgrove' returns 'WarmLife' — so the verdict
 *     comes from comparing titles, never from the result count.
 *   - Google Play has no public search API. This reads the public search page,
 *     which is best-effort by nature: it can be rate limited, blocked, or
 *     changed without notice. It was NOT verifiable from the environment this
 *     was written in, where play.google.com is unreachable, so treat a 'clear'
 *     verdict from it with more suspicion than Apple's.
 *
 * `unknown` is never folded into `clear`. A store we could not reach has not
 * cleared anything.
 */

import { getJSON, isOffline } from '../core/net.ts';
import { normalize } from '../core/text.ts';

export type StoreStatus = 'clear' | 'taken' | 'unknown';

export interface StoreVerdict {
  store: 'app-store' | 'play-store';
  status: StoreStatus;
  /** Listings whose title collides with the name. */
  matches: string[];
  method: string;
  /** The colliding listing, or the store search that surfaced it. */
  url?: string;
}

export interface AppStoreCheck {
  verdicts: StoreVerdict[];
  /** True when any store has a confirmed collision. */
  taken: boolean;
  /** True when every store answered. */
  conclusive: boolean;
}

/**
 * Does a listing title collide with this name?
 *
 * An exact title is obviously a collision. So is a title whose first word is
 * the name — 'Slack for EMM' is not a different brand from 'Slack'. Anything
 * further away is the search API being loose and is ignored.
 */
function collides(name: string, title: string): boolean {
  const target = normalize(name);
  if (!target) return false;
  if (normalize(title) === target) return true;
  const firstWord = title.split(/[^\p{L}\p{N}]+/u)[0] ?? '';
  return normalize(firstWord) === target;
}

interface ItunesResponse {
  resultCount?: number;
  results?: { trackName?: string; trackViewUrl?: string }[];
}

async function checkAppStore(name: string): Promise<StoreVerdict> {
  const url = `https://itunes.apple.com/search?term=${encodeURIComponent(name)}&entity=software&limit=25&country=us`;
  const data = await getJSON<ItunesResponse>(url, { timeoutMs: 9000, ttlMs: 7 * 24 * 60 * 60 * 1000 });

  if (!data) {
    return { store: 'app-store', status: 'unknown', matches: [], method: 'itunes search api (no answer)' };
  }
  const hits = (data.results ?? []).filter((r) => collides(name, r.trackName ?? ''));
  const matches = hits.map((r) => r.trackName ?? '');

  return {
    store: 'app-store',
    status: matches.length > 0 ? 'taken' : 'clear',
    matches: [...new Set(matches)].slice(0, 5),
    method: 'itunes search api',
    // The listing itself when Apple gave us one, otherwise the store search.
    url:
      hits[0]?.trackViewUrl ??
      (matches.length > 0
        ? `https://www.apple.com/us/search/${encodeURIComponent(name)}?src=itunes_serp`
        : undefined),
  };
}

/** App ids and titles as they appear in Play's public search markup. */
function parsePlayTitles(html: string): string[] {
  const titles = new Set<string>();
  // Play renders each result's title in an aria-label on the listing link.
  for (const match of html.matchAll(/aria-label="([^"]{1,60})"/g)) {
    const value = match[1]?.trim();
    if (value) titles.add(value);
  }
  return [...titles];
}

async function checkPlayStore(name: string): Promise<StoreVerdict> {
  const url = `https://play.google.com/store/search?q=${encodeURIComponent(name)}&c=apps&hl=en&gl=us`;
  let html: string | undefined;

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 12000);
    const response = await fetch(url, {
      signal: controller.signal,
      headers: {
        // Play serves a different, unusable page to non-browser clients.
        'user-agent':
          'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36',
        'accept-language': 'en-US,en;q=0.9',
      },
    });
    clearTimeout(timer);
    if (response.ok) html = await response.text();
  } catch {
    // Unreachable, blocked, or timed out — all reported as unknown below.
  }

  if (!html) {
    return {
      store: 'play-store',
      status: 'unknown',
      matches: [],
      method: 'play search page (unreachable)',
    };
  }

  const matches = parsePlayTitles(html).filter((title) => collides(name, title));
  return {
    store: 'play-store',
    status: matches.length > 0 ? 'taken' : 'clear',
    matches: [...new Set(matches)].slice(0, 5),
    method: 'play search page (best effort)',
    // Play gives no stable per-listing link from the search markup, so this
    // points at the search that found the collision.
    url: matches.length > 0 ? url : undefined,
  };
}

export async function checkAppStores(name: string): Promise<AppStoreCheck> {
  if (isOffline()) {
    return {
      verdicts: [
        { store: 'app-store', status: 'unknown', matches: [], method: 'offline' },
        { store: 'play-store', status: 'unknown', matches: [], method: 'offline' },
      ],
      taken: false,
      conclusive: false,
    };
  }

  const verdicts = await Promise.all([checkAppStore(name), checkPlayStore(name)]);
  return {
    verdicts,
    taken: verdicts.some((v) => v.status === 'taken'),
    conclusive: verdicts.every((v) => v.status !== 'unknown'),
  };
}

/** 0..100, for the composite. Unknown sits below clear but above taken. */
export function appStoreScore(check: AppStoreCheck | undefined): number {
  if (!check) return 50;
  if (check.taken) return 0;
  return check.conclusive ? 100 : 55;
}
