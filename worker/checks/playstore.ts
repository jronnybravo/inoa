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

import { request as httpsRequest } from 'node:https';
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

/**
 * Fetch play.google.com at a specific address.
 *
 * Not `fetch`. Undici forbids overriding the Host header, and pointing a URL at
 * a bare IP sends the wrong TLS SNI — which is why every check in the first run
 * came back 'fetch failed'. node:https lets us connect to the resolved address
 * while still presenting play.google.com for SNI and Host, which is exactly
 * what is needed: the hostname does not route from here, the address does.
 */
function fetchPinned(address: string, path: string): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    const req = httpsRequest(
      {
        host: address,
        servername: 'play.google.com',
        path,
        headers: {
          host: 'play.google.com',
          'user-agent': UA,
          'accept-language': 'en-US,en;q=0.9'
        },
        timeout: 20000
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () =>
          resolve({ status: res.statusCode ?? 0, body: Buffer.concat(chunks).toString('utf8') })
        );
      }
    );
    req.on('timeout', () => req.destroy(new Error('timed out')));
    req.on('error', reject);
    req.end();
  });
}

export async function checkPlayStore(name: string): Promise<CheckOutcome> {
  const path = `/store/search?q=${encodeURIComponent(name)}&c=apps&hl=en&gl=us`;
  const address = await resolveViaDoh('play.google.com');
  if (!address) return { status: 'unknown', detail: 'Could not resolve play.google.com' };

  try {
    const { status, body: html } = await fetchPinned(address, path);
    if (status !== 200) return { status: 'unknown', detail: `Play returned ${status}` };

    const $ = cheerio.load(html);
    const titles = new Set<string>();
    $("a[href*='/store/apps/details?id=']").each((_, el) => {
      const text = $(el).text().trim();
      // The first readable line of an app block is its title.
      const first = text.split('\n')[0]?.trim();
      if (first && first.length <= 60) titles.add(first);
    });

    if (titles.size === 0) {
      /*
       * No app links can mean two opposite things, and they must not share a
       * verdict. Play states its own empty result — "didn't match any" — and
       * when it does, a name with no listings is genuinely free. Without that
       * marker we parsed nothing and simply do not know.
       */
      if (/didn'?t match any|couldn'?t find|no results/i.test(html)) {
        return { status: 'clear', detail: 'No Play listings' };
      }
      return { status: 'unknown', detail: 'No parseable Play results' };
    }

    const matches = [...titles].filter((t) => isBrandCollision(name, t));
    if (matches.length === 0) return { status: 'clear' };
    return { status: 'taken', detail: matches.slice(0, 4).join(' | ') };
  } catch (error) {
    return { status: 'unknown', detail: (error as Error).message };
  }
}
