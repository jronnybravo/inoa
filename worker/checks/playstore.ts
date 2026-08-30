/**
 * Google Play, by reading the public search page.
 *
 * Play has no public search API. Two things make this work, and both are
 * load-bearing:
 *
 *   1. play.google.com refuses a plain request from here outright — the
 *      connection fails, not a 403. Resolving the host over DNS-over-HTTPS and
 *      connecting to the address directly gets through. This is not a fallback;
 *      without it the check never runs at all.
 *   2. Titles are read out of the anchor blocks. An earlier implementation read
 *      them from `aria-label`, which now carries only page chrome — 'Page
 *      Header', 'Google Play logo' — so every name came back clear.
 */

import * as cheerio from 'cheerio';
import { isBrandCollision, type CheckOutcome } from './shared.ts';

const UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 ' +
  '(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

let cachedAddress: string | undefined;

async function resolveViaDoh(hostname: string): Promise<string | undefined> {
  if (cachedAddress) return cachedAddress;
  try {
    const response = await fetch(
      `https://cloudflare-dns.com/dns-query?name=${hostname}&type=A`,
      { headers: { accept: 'application/dns-json' }, signal: AbortSignal.timeout(8000) }
    );
    const data = (await response.json()) as { Answer?: { type: number; data: string }[] };
    cachedAddress = data.Answer?.find((a) => a.type === 1)?.data;
    return cachedAddress;
  } catch {
    return undefined;
  }
}

export async function checkPlayStore(name: string): Promise<CheckOutcome> {
  const path = `/store/search?q=${encodeURIComponent(name)}&c=apps&hl=en&gl=us`;
  const address = await resolveViaDoh('play.google.com');
  if (!address) return { status: 'unknown', detail: 'Could not resolve play.google.com' };

  try {
    // Connect to the resolved address, but keep the Host header so TLS and
    // routing still see play.google.com.
    const response = await fetch(`https://${address}${path}`, {
      headers: { 'user-agent': UA, host: 'play.google.com', 'accept-language': 'en-US,en;q=0.9' },
      signal: AbortSignal.timeout(20000)
    });
    if (!response.ok) return { status: 'unknown', detail: `Play returned ${response.status}` };

    const $ = cheerio.load(await response.text());
    const titles = new Set<string>();
    $("a[href*='/store/apps/details?id=']").each((_, el) => {
      const text = $(el).text().trim();
      // The first readable line of an app block is its title.
      const first = text.split('\n')[0]?.trim();
      if (first && first.length <= 60) titles.add(first);
    });

    if (titles.size === 0) return { status: 'unknown', detail: 'No parseable Play results' };

    const matches = [...titles].filter((t) => isBrandCollision(name, t));
    if (matches.length === 0) return { status: 'clear' };
    return { status: 'taken', detail: matches.slice(0, 4).join(' | ') };
  } catch (error) {
    return { status: 'unknown', detail: (error as Error).message };
  }
}
