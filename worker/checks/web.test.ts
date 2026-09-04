/**
 * Which tier answers a web check, and — the part that bit — which one must not.
 *
 * The browser tier is the fallback for a deployment with no API key. It used to
 * run whenever a provider failed to answer a single name, which welded two
 * unrelated failures together: a Firecrawl timeout fell through to a Google
 * that refuses this network, came back 'challenged', and the web queue read
 * that as Google rate-limiting the whole run — thirty minutes of sleep per
 * occurrence and the queue abandoned after three.
 *
 * So the invariant is worth stating out loud: with any provider configured, the
 * browser never runs, and nothing Google says can stop the queue.
 */

import assert from 'node:assert/strict';
import { afterEach, describe, it } from 'node:test';
import { RateLimit } from './limiter.ts';
import {
    ALL_ENGINES,
    API_PROVIDERS,
    hasSearchApi,
    scrapedEngines,
    shouldTryBrowser
} from './web.ts';

/** Every key the provider list reads, so a test can clear the whole set. */
const KEYS = [
    'TAVILY_API_KEY',
    'FIRECRAWL_API_KEY',
    'SERPER_API_KEY',
    'EXA_API_KEY',
    'BRAVE_API_KEY'
];

const saved = new Map(KEYS.map((k) => [k, process.env[k]]));

function only(configured: Record<string, string> = {}): void {
    for (const key of KEYS) {
        // Assigning undefined would store the string 'undefined'; the key has to go.
        Reflect.deleteProperty(process.env, key);
    }
    for (const [key, value] of Object.entries(configured)) {
        process.env[key] = value;
    }
}

afterEach(() => {
    for (const [key, value] of saved) {
        if (value === undefined) {
            Reflect.deleteProperty(process.env, key);
        } else {
            process.env[key] = value;
        }
    }
});

describe('the provider list', () => {
    it('reads its keys at call time, so configuration is not frozen at import', () => {
        only();
        assert.equal(hasSearchApi(), false);
        only({ TAVILY_API_KEY: 'tvly-test' });
        assert.equal(hasSearchApi(), true);
    });

    it('covers every provider the module offers', () => {
        // A provider added without a key here would silently escape these tests.
        assert.equal(API_PROVIDERS.length, KEYS.length);
    });

    for (const key of KEYS) {
        it(`counts ${key} as a configured provider`, () => {
            only({ [key]: 'test-key' });
            assert.equal(hasSearchApi(), true);
        });
    }
});

describe('browser tier eligibility', () => {
    it('runs the browser when nothing else can answer', () => {
        only();
        assert.equal(shouldTryBrowser(), true);
    });

    /*
     * The regression. A provider was configured and merely hiccupped on one
     * name; the browser must not be consulted, because its answer here is a
     * Google challenge that the queue mistakes for a run-wide rate limit.
     */
    for (const key of KEYS) {
        it(`never runs the browser when ${key} is set`, () => {
            only({ [key]: 'test-key' });
            assert.equal(shouldTryBrowser(), false);
        });
    }

    it('treats an empty key as no key, so a blank line in .env is not a provider', () => {
        only({ TAVILY_API_KEY: '' });
        assert.equal(hasSearchApi(), false);
        assert.equal(shouldTryBrowser(), true);
    });

    it('still declines the browser when several providers are configured', () => {
        only({ TAVILY_API_KEY: 'a', FIRECRAWL_API_KEY: 'b', EXA_API_KEY: 'c' });
        assert.equal(shouldTryBrowser(), false);
    });
});

describe('tier 1 — the scraped tier is parked', () => {
    const set = (value?: string): void => {
        if (value === undefined) {
            Reflect.deleteProperty(process.env, 'INOA_SCRAPE_ENGINES');
        } else {
            process.env.INOA_SCRAPE_ENGINES = value;
        }
    };

    /*
     * Shipping with this off is a decision, not an oversight. Google cannot be
     * scraped at all (Search requires JavaScript), Bing answers or serves
     * decoys depending on the address, and the tier resolved about one check in
     * 585 either way — a scraped engine can confirm a collision but never an
     * absence, which is what the funnel actually needs by this point.
     */
    it('scrapes nothing by default', () => {
        set(undefined);
        assert.deepEqual(scrapedEngines(), []);
    });

    it('stays off for an empty or whitespace setting', () => {
        for (const value of ['', '   ', ',', ' , ']) {
            set(value);
            assert.deepEqual(scrapedEngines(), [], `"${value}" should enable nothing`);
        }
    });

    it("enables exactly the engines named, in the module's own order", () => {
        set('bing');
        assert.deepEqual(
            scrapedEngines().map((e) => e.label),
            ['Bing']
        );
        set('google,bing');
        assert.deepEqual(
            scrapedEngines().map((e) => e.label),
            ['Bing', 'Google']
        );
    });

    it('is case and whitespace insensitive, since it is typed into a .env', () => {
        set('  BING , Google ');
        assert.deepEqual(
            scrapedEngines().map((e) => e.label),
            ['Bing', 'Google']
        );
    });

    it('ignores an engine it does not know rather than failing a run', () => {
        set('bing,duckduckgo');
        assert.deepEqual(
            scrapedEngines().map((e) => e.label),
            ['Bing']
        );
        set(undefined);
    });

    it('still describes every engine it knows, so the doctor can probe them', () => {
        assert.ok(ALL_ENGINES.length >= 2);
        assert.ok(ALL_ENGINES.every((e) => e.label && e.block && e.title && e.url('x')));
    });
});

describe('the scraped tier is bounded by rate, not by patience', () => {
    it('grants one slot, then refuses until the interval has passed', () => {
        const limit = new RateLimit(5_000);
        assert.equal(limit.tryTake(), true, 'the first caller should get a slot');
        assert.equal(limit.tryTake(), false, 'a burst behind it must be refused');
        assert.equal(limit.tryTake(), false);
    });

    it('refuses without waiting, so a skipped name is not a stalled one', () => {
        const limit = new RateLimit(60_000);
        limit.tryTake();
        const started = Date.now();
        assert.equal(limit.tryTake(), false);
        assert.ok(Date.now() - started < 50, 'tryTake must not block');
    });

    it('caps a burst of 100 names to a single request', () => {
        const limit = new RateLimit(5_000);
        const granted = Array.from({ length: 100 }, () => limit.tryTake()).filter(Boolean).length;
        assert.equal(granted, 1);
    });

    it('an interval of 0 always grants, for anyone who wants every name scraped', () => {
        const limit = new RateLimit(0);
        assert.equal(limit.tryTake(), true);
        assert.equal(limit.tryTake(), true);
    });
});
