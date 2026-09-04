/**
 * Web presence — is someone already trading under this name?
 *
 * Two tiers, because the cheap one cannot always be believed.
 *
 * TIER 1 is plain HTTP against Bing. Fast (~0.5s) and right most of the time,
 * and for a name that is obviously taken it is all we need.
 *
 * TIER 2 is a search API, or a real browser against Google when no key is set.
 * It only runs when tier 1 could not produce a trustworthy answer.
 *
 * WHY GOOGLE IS NOT IN TIER 1
 *
 * It used to be, and removing it is the single change that most improves this
 * project's chances of getting an answer at all. Two reasons, and the second is
 * the important one.
 *
 * It cannot work, from any address, because Google Search requires JavaScript.
 * The 200 it returns is 89 KB carrying five script tags and this:
 *
 *   <noscript><meta http-equiv="refresh"
 *     content="0;url=/httpservice/retry/enablejs?sei=..."></noscript>
 *
 * That is a capability gate, not a reputation one, and the distinction is
 * visible in the same session: the browser tier — which does run JavaScript —
 * gets /sorry/ from the ABUSE system, while plain HTTP gets enablejs from the
 * CAPABILITY system. Different mechanisms, different causes. No IP, header set,
 * user agent or gbv=1 changes the second; all three variants returned the same
 * 89 KB stub.
 *
 * This was measured across three networks and is not an address problem. Only a
 * tier that executes script can read Google, which is what the browser tier is
 * for.
 *
 * And it was burning the address. Tier 1 runs once per name, and with a search
 * API configured the whole web check runs INLINE in the fast funnel, paced by a
 * 600ms limiter. That is roughly a hundred requests a minute at google.com for
 * the six minutes a run's web checks take — against an engine measured here to
 * start challenging at about 25 queries. The IP was spent within seconds of a
 * run starting, every run. Which then took the BROWSER tier down with it: the
 * one Google path that does return real evidence, carefully paced a minute
 * apiece, was being sabotaged by a scrape of the same host it knew nothing
 * about.
 *
 * So Google now exists in exactly one place, tier 2's browser, where it can
 * actually be paced. Putting it back in tier 1 re-breaks the browser tier, and
 * a test in web.test.ts says so.
 *
 * WHAT "COULD NOT BE BELIEVED" HAS TO MEAN
 *
 * The subtle part, and the reason the previous tool reported 500 names clean
 * without ever checking them: an HTTP tier does not fail loudly. Bing answers
 * some queries with a complete, well-formed results page about something else
 * entirely — French holiday calendars and the Assam State Portal for a query
 * about Duolingo, ten valid result blocks each time, the query correctly
 * echoed. (That was measured from one address; from another, Duolingo answered
 * correctly every time. Treat it as something an engine may do to you rather
 * than a property of the query.)
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
 * A search API is the reliable one: structured JSON, no scraping, no decoys.
 * Set any of these, and the ones you set are used in rotation:
 *
 *   TAVILY_API_KEY     1,000 searches a month, no card, so it cannot bill you
 *   FIRECRAWL_API_KEY  free monthly credits, no card
 *   EXA_API_KEY        $10 of credit a month, no card
 *   SERPER_API_KEY     2,500 free once, then $0.30 per 1,000
 *   BRAVE_API_KEY      $5 credit a month, CARD REQUIRED, then $5 per 1,000
 *
 * A real browser against Google is the fallback when no key is configured. It
 * gives a genuinely better answer than any scraper — Google states "did not
 * match any documents" outright, which is a positive statement of absence — but
 * it does not survive volume. So it is best effort, it reports 'unknown' the
 * moment it is challenged, and it is never made to look like something other
 * than a browser — a challenge means the answer was not obtained, not that it
 * should be obtained another way.
 */

import * as cheerio from 'cheerio';
import { RateLimit } from './limiter.ts';
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
export const queryFor = (name: string) => `"${name}" (app OR software OR platform OR company)`;

// ---------------------------------------------------------------------------
// Tier 1 — plain HTTP
// ---------------------------------------------------------------------------

/**
 * An engine as data rather than a closure.
 *
 * The selectors are the part that rots — Bing renames a class and every check
 * silently returns nothing — so they live in one place that both the funnel and
 * `npm run doctor` read. A diagnostic that copies them tests the copy.
 */
export interface Engine {
    label: string;
    url: (query: string) => string;
    /** One result block. */
    block: string;
    /** The title within a block. */
    title: string;
}

const BING: Engine = {
    label: 'Bing',
    url: (q) => `https://www.bing.com/search?q=${encodeURIComponent(q)}&count=20`,
    block: 'li.b_algo',
    title: 'h2'
};

const GOOGLE: Engine = {
    label: 'Google',
    url: (q) => `https://www.google.com/search?q=${encodeURIComponent(q)}&num=20`,
    block: 'div.MjjYud, div.g',
    title: 'h3'
};

/** Every engine this module knows how to read, in use or not. */
export const ALL_ENGINES: Engine[] = [BING, GOOGLE];

/**
 * The scraped tier is OFF.
 *
 * Not removed — parked. Scraping a search engine turned out to be two separate
 * unsolved problems, and neither is worth holding a release for:
 *
 *   - Google cannot be scraped at all. Search requires JavaScript; a plain
 *     request returns a <noscript> redirect to /httpservice/retry/enablejs, and
 *     no address, header set or gbv=1 changes that.
 *   - Bing can be scraped, but whether it answers depends on the address. It
 *     returned correct results for Duolingo from two networks and ten unrelated
 *     results for the same query from a third. pertains() catches that and
 *     escalates, so it is safe — just frequently useless.
 *
 * And the tier was never load-bearing: it resolved about one check in 585,
 * because by the time a name reaches the web check it has passed three earlier
 * gates and is probably genuinely free — and a scraped engine can confirm a
 * collision but never an absence. That is the paid tier's job.
 *
 * Set INOA_SCRAPE_ENGINES=bing (or bing,google) to switch it back on.
 * `npm run doctor` probes every engine either way and says which would answer
 * from where you are.
 */
export function scrapedEngines(): Engine[] {
    const wanted = (process.env.INOA_SCRAPE_ENGINES ?? '')
        .split(',')
        .map((label) => label.trim().toLowerCase())
        .filter(Boolean);
    return ALL_ENGINES.filter((engine) => wanted.includes(engine.label.toLowerCase()));
}

/**
 * How often the scraped tier may touch its engine.
 *
 * Scraped engines are banned by RATE; paid APIs are billed by VOLUME. Pacing
 * them together is what burnt this project's addresses: one shared 600ms
 * limiter meant roughly a hundred requests a minute at a search engine for the
 * six minutes a run's web checks take.
 *
 * So the scraped tier gets its own, far slower clock — and takes a slot only
 * if one is free, rather than waiting for one. Bing resolves about one check
 * in 585 (most candidates are invented words it has never seen), so it is a
 * cheap lottery ticket worth buying when it is free and never worth stalling
 * the funnel for. A skipped name simply goes to the paid tier as it would have
 * anyway. Set to 0 to scrape on every name.
 */
const SCRAPE_INTERVAL_MS = Number(process.env.INOA_SCRAPE_INTERVAL_MS ?? 5_000);
const scrapeLimit = new RateLimit(SCRAPE_INTERVAL_MS);

/** Pull the result blocks out of a page an engine returned. */
export function parseHits(engine: Engine, html: string): Hit[] {
    const $ = cheerio.load(html);
    const hits: Hit[] = [];
    $(engine.block).each((_, el) => {
        const title = $(el).find(engine.title).first().text().trim();
        const href = $(el).find('a').first().attr('href') ?? '';
        if (!title) {
            return;
        }
        hits.push({ title, url: href, snippet: $(el).text().trim() });
    });
    return hits;
}

async function httpSearch(engine: Engine, query: string): Promise<Hit[] | null> {
    try {
        const response = await fetch(engine.url(query), {
            headers: { 'user-agent': UA, 'accept-language': 'en-US,en;q=0.9' },
            signal: AbortSignal.timeout(12000)
        });
        if (!response.ok) {
            return null;
        }
        const hits = parseHits(engine, await response.text());
        return hits.length === 0 ? null : hits;
    } catch {
        return null;
    }
}

/** Did the engine answer the question we asked, or something else? */
function pertains(name: string, hits: Hit[]): boolean {
    const target = squash(name);
    return hits.some((h) => squash(h.title + h.snippet + h.url).includes(target));
}

// ---------------------------------------------------------------------------
// Tier 2 — a real browser
// ---------------------------------------------------------------------------

interface ApiProvider {
    label: string;
    key: () => string | undefined;
    search: (query: string, key: string) => Promise<Hit[] | null>;
}

/**
 * One search result, as some provider spells it.
 *
 * Every provider returns the same three facts under different names, so each
 * declares only the keys it actually uses and `toHits` normalises them. The
 * fields are optional because they come from somebody else's service and a
 * missing one is a bad response, not a crash.
 */
interface RawResult {
    title?: string;
    url?: string;
    link?: string;
    content?: string;
    description?: string;
    snippet?: string;
    text?: string;
}

function toHits(results: RawResult[]): Hit[] {
    return results.map((r) => ({
        title: r.title ?? '',
        url: r.url ?? r.link ?? '',
        snippet: r.content ?? r.description ?? r.snippet ?? r.text ?? ''
    }));
}

async function postJson<T>(
    url: string,
    headers: Record<string, string>,
    body: unknown
): Promise<T | null> {
    const response = await fetch(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json', ...headers },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(20000)
    });
    return response.ok ? ((await response.json()) as T) : null;
}

/**
 * Tier-2 providers.
 *
 * Order is a preference, not a priority: whichever are configured are used in
 * turn, so a run spreads its cost across every free allowance available rather
 * than draining one and then failing. Brave is listed last because its free
 * tier ended in February 2026 and the card it collects now gets charged.
 */
export const API_PROVIDERS: ApiProvider[] = [
    {
        label: 'Tavily',
        key: () => process.env.TAVILY_API_KEY,
        search: async (query, key) => {
            const data = await postJson<{ results?: RawResult[] }>(
                'https://api.tavily.com/search',
                { authorization: `Bearer ${key}` },
                { query, max_results: 20, search_depth: 'basic' }
            );
            return Array.isArray(data?.results) ? toHits(data.results) : null;
        }
    },
    {
        label: 'Firecrawl',
        key: () => process.env.FIRECRAWL_API_KEY,
        search: async (query, key) => {
            const data = await postJson<{ data?: RawResult[] | { web?: RawResult[] } }>(
                'https://api.firecrawl.dev/v2/search',
                { authorization: `Bearer ${key}` },
                { query, limit: 20, sources: [{ type: 'web' }] }
            );
            // v2 nests results by source; older keys may still answer with an array.
            const results = Array.isArray(data?.data) ? data.data : data?.data?.web;
            return Array.isArray(results) ? toHits(results) : null;
        }
    },
    {
        label: 'Serper',
        key: () => process.env.SERPER_API_KEY,
        search: async (query, key) => {
            const data = await postJson<{ organic?: RawResult[] }>(
                'https://google.serper.dev/search',
                { 'x-api-key': key },
                { q: query, num: 20 }
            );
            return Array.isArray(data?.organic) ? toHits(data.organic) : null;
        }
    },
    {
        label: 'Exa',
        key: () => process.env.EXA_API_KEY,
        search: async (query, key) => {
            const data = await postJson<{ results?: RawResult[] }>(
                'https://api.exa.ai/search',
                { 'x-api-key': key },
                { query, numResults: 20, type: 'auto', contents: { text: { maxCharacters: 300 } } }
            );
            return Array.isArray(data?.results) ? toHits(data.results) : null;
        }
    },
    {
        label: 'Brave',
        key: () => process.env.BRAVE_API_KEY,
        search: async (query, key) => {
            const response = await fetch(
                `https://api.search.brave.com/res/v1/web/search?q=${encodeURIComponent(query)}&count=20`,
                {
                    headers: { Accept: 'application/json', 'X-Subscription-Token': key },
                    signal: AbortSignal.timeout(20000)
                }
            );
            if (!response.ok) {
                return null;
            }
            const data = (await response.json()) as { web?: { results?: RawResult[] } };
            const results = data.web?.results;
            return Array.isArray(results) ? toHits(results) : null;
        }
    }
];

/** True when any tier-2 API is configured — the queue paces on this. */
export function hasSearchApi(): boolean {
    return API_PROVIDERS.some((p) => p.key());
}

/**
 * Whether a name no provider could answer may fall through to a browser.
 *
 * The browser tier exists for a deployment with no API key at all. Once any
 * provider is configured that is the tier which answers, and a browser attempt
 * buys nothing: a launch, several seconds, and — anywhere Google refuses the
 * network — a verdict that reads like a rate limit rather than the provider
 * hiccup it actually was.
 */
export function shouldTryBrowser(): boolean {
    return !hasSearchApi();
}

/**
 * Where the rotation is up to. Module-level, so every check in a run shares it.
 */
let rotation = 0;

/**
 * Ask the next provider in the rotation, falling through the others.
 *
 * Taking providers in turn rather than always preferring one spreads a run
 * across every free allowance configured: three providers with a thousand
 * searches each is three thousand searches, not one thousand and two idle
 * accounts. A provider that fails is skipped and the next is tried, so an
 * exhausted quota costs one wasted call rather than the rest of the run.
 */
async function apiSearch(query: string): Promise<{ hits: Hit[]; label: string } | null> {
    const configured = API_PROVIDERS.filter((p) => p.key());
    if (configured.length === 0) {
        return null;
    }

    const start = rotation++ % configured.length;
    for (let i = 0; i < configured.length; i++) {
        const provider = configured[(start + i) % configured.length];
        const key = provider?.key();
        if (!provider || !key) {
            continue;
        }
        try {
            const hits = await provider.search(query, key);
            if (hits) {
                return { hits, label: provider.label };
            }
        } catch {
            // Try the next one rather than failing the check.
        }
    }
    return null;
}

/**
 * Playwright is loaded only if a browser is actually needed.
 *
 * A top-level import pulls Chromium's bindings into anything that imports this
 * module — including a server route that only ever wants the API tier, and a
 * serverless bundle where the browser cannot run at all.
 */
type Browser = Awaited<ReturnType<typeof launchChromium>>;

async function launchChromium() {
    const { chromium } = await import('playwright');
    return chromium.launch({ headless: true });
}

let browser: Browser | undefined;

async function getBrowser(): Promise<Browser> {
    if (browser?.isConnected()) {
        return browser;
    }
    browser = await launchChromium();
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
export const CHALLENGED = /unusual traffic|are you a robot|recaptcha|\/sorry\//i;

type Page = Awaited<ReturnType<Browser['newPage']>>;

export async function browserSearch(name: string): Promise<CheckOutcome> {
    /*
     * The launch is inside the try, not before it.
     *
     * `npm install` does not download Chromium, so the commonest failure of
     * this tier is that nobody has run `npx playwright install chromium` — and
     * outside the try that threw straight past every caller: it killed a run
     * mid-queue with the run left sitting at 'checking', and it crashed the
     * doctor on the one step whose job is to report this tier as unavailable.
     * A browser that cannot start is a check that did not happen, which is
     * exactly what 'unknown' means.
     */
    let page: Page | undefined;
    try {
        page = await (await getBrowser()).newPage({ userAgent: UA, locale: 'en-US' });
        const url = `https://www.google.com/search?q=${encodeURIComponent(queryFor(name))}&num=20`;
        const response = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 25000 });

        const body = await page.evaluate(() => document.body.innerText);

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
            Array.from(document.querySelectorAll('h3')).map((h) => h.textContent.trim())
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
        await page?.close();
    }
}

// ---------------------------------------------------------------------------

export async function checkWeb(name: string): Promise<CheckOutcome> {
    const query = queryFor(name);

    for (const engine of scrapedEngines()) {
        // Only when a slot is free. Waiting here would make the free tier the
        // slowest thing in the run, which is the opposite of why it exists.
        if (!scrapeLimit.tryTake()) {
            break;
        }
        const hits = await httpSearch(engine, query);
        await sleep(jitter(400));
        if (!hits || hits.length === 0) {
            continue;
        }

        const matches = [
            ...new Set(hits.map((h) => h.title).filter((t) => isBrandCollision(name, t)))
        ];
        if (matches.length > 0) {
            return {
                status: 'taken',
                detail: `${matches.slice(0, 4).join(' | ')} (${engine.label})`
            };
        }

        // No collision found. That only means something if the engine was
        // answering our question — see the note at the top of this file.
        if (pertains(name, hits)) {
            return { status: 'clear', detail: `No competing brand found (${engine.label})` };
        }
    }

    // Tier 1 could not be believed. Only this path spends tier-2 budget.
    const api = await apiSearch(query);
    if (api) {
        const matches = [
            ...new Set(api.hits.map((h) => h.title).filter((t) => isBrandCollision(name, t)))
        ];
        if (matches.length > 0) {
            return { status: 'taken', detail: `${matches.slice(0, 4).join(' | ')} (${api.label})` };
        }
        // The API answered the question, so an absence of collisions is real
        // evidence — unlike the same absence from a tier-1 engine that ignored us.
        return { status: 'clear', detail: `No competing brand found (${api.label})` };
    }

    /*
     * A configured provider that could not answer is a provider problem, and a
     * browser is not the answer to it.
     *
     * This fall-through used to be unconditional, which welded two unrelated
     * failures together: one Firecrawl timeout on one name reached a Google
     * that refuses this network, came back 'challenged', and the web queue read
     * that as Google rate-limiting the run — thirty minutes of sleep, and three
     * of them abandoned every remaining name as unverified. A blip at the
     * provider must not stop the queue, and must not be reported as Google's
     * doing. Say what actually happened instead.
     */
    if (!shouldTryBrowser()) {
        return {
            status: 'unknown',
            detail: 'No configured search provider could answer; check their quotas'
        };
    }

    await sleep(jitter(700));
    return browserSearch(name);
}
