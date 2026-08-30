/**
 * Web presence — is someone already trading under this name?
 *
 * Two tiers, because the cheap one cannot always be believed.
 *
 * TIER 1 is plain HTTP against Bing and Google. It is fast (~0.5s) and right
 * most of the time, and for a name that is obviously taken it is all we need.
 *
 * TIER 2 launches a real browser against Google. It costs a few seconds, so it
 * only runs when tier 1 could not produce a trustworthy answer.
 *
 * WHAT "COULD NOT" HAS TO MEAN
 *
 * The subtle part, and the reason the previous tool reported 500 names clean
 * without ever checking them: an HTTP tier does not fail loudly. Measured
 * behaviour of both engines:
 *
 *   - Bing answers some queries with a complete, well-formed results page
 *     about something else entirely. Searching "Duolingo" returned French
 *     holiday calendars, apartment listings and the Assam State Portal on
 *     consecutive attempts — each time ten valid result blocks with the query
 *     correctly echoed. It is stable per query, not intermittent: Spotify and
 *     Notion worked every time, Duolingo failed 12 of 12 across three query
 *     shapes. Retrying does not help.
 *   - Google over plain HTTP returns 200 with zero parseable results for every
 *     query, because its results are rendered by script.
 *
 * So escalating only on a thrown error or an empty page would escalate almost
 * never, and the decoy answers would be taken at face value. Tier 1 is trusted
 * only when its results actually MENTION the name — that is the evidence that
 * the engine understood the question. Anything else escalates.
 *
 * A name that is genuinely free also produces no mentions, and from one engine
 * that is indistinguishable from a decoy. Only tier 2 can resolve it.
 *
 * TIER 2 has two implementations, tried in order.
 *
 * The Brave Search API is the reliable one: structured JSON, no scraping, no
 * decoys, and a free tier of about 2,000 queries a month. Because tier 1
 * already resolves every obviously-taken name for free, only the ambiguous
 * remainder spends that quota.
 *
 * A real browser against Google is the fallback when no key is configured. It
 * gives a genuinely better answer than any scraper — Google states "did not
 * match any documents" outright, which is a positive statement of absence — but
 * it does not survive volume. Measured: Google began returning its /sorry/
 * interstitial after roughly 25 queries from one residential address, in both
 * headless and headed real Chrome. A run needs 50 to 200. So it is best effort,
 * it reports 'unknown' the moment it is challenged, and it is never made to look
 * like something other than a browser — a challenge means the answer was not
 * obtained, not that it should be obtained another way.
 */

import { chromium, type Browser } from 'playwright';
import * as cheerio from 'cheerio';
import { isBrandCollision, jitter, sleep, squash, type CheckOutcome } from './shared.ts';

const UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 ' +
  '(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

interface Hit {
  title: string;
  url: string;
  snippet: string;
}

/** Both intents in one query: separate ones quadrupled the rate-limit exposure. */
const queryFor = (name: string) => `"${name}" (app OR software OR platform OR company)`;

// ---------------------------------------------------------------------------
// Tier 1 — plain HTTP
// ---------------------------------------------------------------------------

async function httpSearch(url: string, selector: string, titleSel: string): Promise<Hit[] | null> {
  try {
    const response = await fetch(url, {
      headers: { 'user-agent': UA, 'accept-language': 'en-US,en;q=0.9' },
      signal: AbortSignal.timeout(12000)
    });
    if (!response.ok) return null;
    const $ = cheerio.load(await response.text());
    const blocks = $(selector);
    if (blocks.length === 0) return null;

    const hits: Hit[] = [];
    blocks.each((_, el) => {
      const title = $(el).find(titleSel).first().text().trim();
      const href = $(el).find('a').first().attr('href') ?? '';
      if (!title) return;
      hits.push({ title, url: href, snippet: $(el).text().trim() });
    });
    return hits;
  } catch {
    return null;
  }
}

const ENGINES = [
  {
    label: 'Bing',
    run: (q: string) =>
      httpSearch(
        `https://www.bing.com/search?q=${encodeURIComponent(q)}&count=20`,
        'li.b_algo',
        'h2'
      )
  },
  {
    label: 'Google',
    run: (q: string) =>
      httpSearch(
        `https://www.google.com/search?q=${encodeURIComponent(q)}&num=20`,
        'div.MjjYud, div.g',
        'h3'
      )
  }
];

/** Did the engine answer the question we asked, or something else? */
function pertains(name: string, hits: Hit[]): boolean {
  const target = squash(name);
  return hits.some((h) => squash(h.title + h.snippet + h.url).includes(target));
}

// ---------------------------------------------------------------------------
// Tier 2 — a real browser
// ---------------------------------------------------------------------------

/**
 * Brave Search API — the dependable tier 2.
 *
 * Returns null when no key is set or the call fails, so the caller falls
 * through to the browser rather than treating an outage as a clear.
 */
async function braveSearch(query: string): Promise<Hit[] | null> {
  const key = process.env.BRAVE_API_KEY;
  if (!key) return null;
  try {
    const response = await fetch(
      `https://api.search.brave.com/res/v1/web/search?q=${encodeURIComponent(query)}&count=20`,
      {
        headers: { Accept: 'application/json', 'X-Subscription-Token': key },
        signal: AbortSignal.timeout(15000)
      }
    );
    if (!response.ok) return null;
    const data = (await response.json()) as {
      web?: { results?: { title?: string; url?: string; description?: string }[] };
    };
    const results = data.web?.results;
    if (!Array.isArray(results)) return null;
    return results.map((r) => ({
      title: r.title ?? '',
      url: r.url ?? '',
      snippet: r.description ?? ''
    }));
  } catch {
    return null;
  }
}

let browser: Browser | undefined;

async function getBrowser(): Promise<Browser> {
  if (browser?.isConnected()) return browser;
  browser = await chromium.launch({ headless: true });
  return browser;
}

export async function closeBrowser(): Promise<void> {
  await browser?.close();
  browser = undefined;
}

/**
 * Google's own words for an empty result set. This is the signal that makes
 * the browser tier worth its cost: it is a positive statement of absence, not
 * the absence of a statement.
 */
const NO_RESULTS = /did not match any documents|no results found for/i;

/** Google deciding we look automated. Never solved — reported as unknown. */
const CHALLENGED = /unusual traffic|are you a robot|recaptcha|\/sorry\//i;

async function browserSearch(name: string): Promise<CheckOutcome> {
  const page = await (await getBrowser()).newPage({ userAgent: UA, locale: 'en-US' });
  try {
    const url = `https://www.google.com/search?q=${encodeURIComponent(queryFor(name))}&num=20`;
    const response = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 25000 });

    const body = await page.evaluate(() => document.body?.innerText ?? '');

    if (CHALLENGED.test(body) || CHALLENGED.test(page.url()) || response?.status() === 429) {
      return {
        status: 'unknown',
        detail: 'Google challenged the request; not verified'
      };
    }

    if (NO_RESULTS.test(body)) {
      return { status: 'clear', detail: 'No Google results (browser)' };
    }

    // Titles are what a competing brand looks like; body text merely mentioning
    // the word is not a collision.
    const titles = await page.evaluate(() =>
      Array.from(document.querySelectorAll('h3')).map((h) => h.textContent?.trim() ?? '')
    );
    const matches = [...new Set(titles.filter((t) => t && isBrandCollision(name, t)))];

    if (matches.length > 0) {
      return { status: 'taken', detail: matches.slice(0, 4).join(' | ') };
    }
    if (titles.some((t) => squash(t).includes(squash(name)))) {
      // Mentioned, but nothing that reads as a competing brand.
      return { status: 'clear', detail: 'Mentioned, no competing brand (browser)' };
    }
    return { status: 'clear', detail: 'No competing brand found (browser)' };
  } catch (error) {
    return { status: 'unknown', detail: `Browser check failed: ${(error as Error).message}` };
  } finally {
    await page.close();
  }
}

// ---------------------------------------------------------------------------

export async function checkWeb(name: string): Promise<CheckOutcome> {
  const query = queryFor(name);

  for (const engine of ENGINES) {
    const hits = await engine.run(query);
    await sleep(jitter(400));
    if (!hits || hits.length === 0) continue;

    const matches = [...new Set(hits.map((h) => h.title).filter((t) => isBrandCollision(name, t)))];
    if (matches.length > 0) {
      return { status: 'taken', detail: `${matches.slice(0, 4).join(' | ')} (${engine.label})` };
    }

    // No collision found. That only means something if the engine was
    // answering our question — see the note at the top of this file.
    if (pertains(name, hits)) {
      return { status: 'clear', detail: `No competing brand found (${engine.label})` };
    }
  }

  // Tier 1 could not be believed. Only this path spends tier-2 budget.
  const brave = await braveSearch(query);
  if (brave) {
    const matches = [
      ...new Set(brave.map((h) => h.title).filter((t) => isBrandCollision(name, t)))
    ];
    if (matches.length > 0) {
      return { status: 'taken', detail: `${matches.slice(0, 4).join(' | ')} (Brave)` };
    }
    // Brave answered the question, so an absence of collisions is real evidence
    // — unlike the same absence from a tier-1 engine that may have ignored us.
    return { status: 'clear', detail: 'No competing brand found (Brave)' };
  }

  await sleep(jitter(700));
  return browserSearch(name);
}
