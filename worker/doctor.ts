/**
 * What can the web check actually reach from this network?
 *
 * The web check has three tiers and they fail in different ways, none of them
 * loudly: a blocked engine returns the same nothing as an engine with no
 * results, and a challenged browser looks like a name with no web presence.
 * From the outside a run that resolved nothing and a run that was refused by
 * everything produce the same table of 'unverified'.
 *
 * That matters most when the address changes. Search engines ban by network,
 * the ban outlives the run, and the only way to find out used to be to start a
 * run and read the wreckage an hour later. This asks each tier one question and
 * says which of them would answer.
 *
 *   npm run doctor
 *   npm run doctor -- Duolingo    # probe with a different name
 *
 * It costs one request per engine, one browser launch, and one credit per
 * configured API provider. Deliberately small: the thing being measured is
 * provoked by volume.
 */

import 'dotenv/config';
import { SEARCH_KEYS } from '../src/lib/search.ts';
import { squash } from './checks/shared.ts';
import {
    API_PROVIDERS,
    browserSearch,
    CHALLENGED,
    closeBrowser,
    ALL_ENGINES,
    parseHits,
    queryFor,
    scrapedEngines,
    type Engine
} from './checks/web.ts';

const UA =
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 ' +
    '(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

/**
 * A brand that unquestionably exists.
 *
 * An engine that is answering must find it, so 'no results' is a diagnosis of
 * the engine rather than a fact about the name. An invented name cannot tell
 * those apart, which is the whole difficulty this file exists to resolve.
 */
const DEFAULT_PROBE = 'Duolingo';

const name = process.argv[2] ?? DEFAULT_PROBE;
const query = queryFor(name);
const usable: string[] = [];
const blocked: string[] = [];

const row = (label: string, verdict: string, note: string): void => {
    console.log(`  ${label.padEnd(11)} ${verdict.padEnd(9)} ${note}`);
};

console.log(`Probing with "${name}" — a name every working engine should find.\n`);

/**
 * Enough of a page's shape to tell a rotted selector from a refused request.
 *
 * A real results page carries headings and links even when our selectors miss
 * them. A page with neither, which never mentions the term searched for, is
 * not a page whose results are rendered by script — it is a page served to a
 * client the engine has already made up its mind about. Those two look
 * identical as "0 blocks matched" and they call for opposite responses.
 */
const countTag = (html: string, tag: string): number =>
    (html.match(new RegExp(`<${tag}[\\s>]`, 'gi')) ?? []).length;

/**
 * One engine, one request.
 *
 * `counted` is false for an engine the funnel is not configured to use: it is
 * probed for diagnosis only and must not appear in the summary as something a
 * run would rely on.
 */
async function probeEngine(engine: Engine, counted = true): Promise<void> {
    const started = Date.now();
    try {
        const response = await fetch(engine.url(query), {
            headers: { 'user-agent': UA, 'accept-language': 'en-US,en;q=0.9' },
            signal: AbortSignal.timeout(12000)
        });
        const html = await response.text();
        const challenged = CHALLENGED.test(html) || CHALLENGED.test(response.url);
        const hits = response.ok ? parseHits(engine, html) : [];
        const mentions = hits.some((h) =>
            squash(h.title + h.snippet + h.url).includes(squash(name))
        );

        if (challenged || response.status === 429) {
            if (counted) {
                blocked.push(engine.label);
            }
            row(engine.label, 'blocked', `HTTP ${response.status}, challenged`);
        } else if (!response.ok) {
            if (counted) {
                blocked.push(engine.label);
            }
            row(engine.label, 'refused', `HTTP ${response.status}`);
        } else if (hits.length === 0) {
            /*
             * Three different things produce "0 blocks matched", and they call
             * for opposite responses: a page that demands JavaScript can never
             * be scraped from anywhere, a stripped page means this address is
             * in trouble, and a full page means our selector has rotted.
             */
            const shape =
                `${Math.round(html.length / 1024)}KB, ${countTag(html, 'h3')} h3, ` +
                `${countTag(html, 'a')} links`;
            if (/\/httpservice\/retry\/enablejs/i.test(html)) {
                row(
                    engine.label,
                    'needs js',
                    `results are script-rendered; no scraper can read it`
                );
                console.log(
                    `${' '.repeat(14)}not an address problem — use the browser tier (${shape})`
                );
            } else if (countTag(html, 'a') < 20) {
                row(engine.label, 'stripped', `this address is being served a shell (${shape})`);
            } else {
                row(
                    engine.label,
                    'no data',
                    `0 blocks match "${engine.block}" — selector rot? (${shape})`
                );
            }
        } else if (!mentions) {
            row(engine.label, 'decoy', `${hits.length} results, none mention the name`);
        } else {
            if (counted) {
                usable.push(engine.label);
            }
            const note = counted ? '' : ' — but not in use';
            row(
                engine.label,
                'usable',
                `${hits.length} results in ${Date.now() - started}ms${note}`
            );
        }
    } catch (error) {
        if (counted) {
            blocked.push(engine.label);
        }
        row(engine.label, 'error', (error as Error).message);
    }
}

/*
 * Every engine is probed, in use or not.
 *
 * The scraped tier ships off, and the question it leaves open — would it work
 * from here? — is exactly what this command exists to answer. An engine that is
 * not in use is probed anyway and reported as such, so a "usable" verdict is
 * an invitation to switch it on rather than a claim that it is on.
 */
const inUse = new Set(scrapedEngines().map((engine) => engine.label));
console.log(`tier 1 — plain HTTP${inUse.size === 0 ? ' (off; probed for diagnosis only)' : ''}`);
for (const engine of ALL_ENGINES) {
    await probeEngine(engine, inUse.has(engine.label));
}
if (inUse.size < ALL_ENGINES.length) {
    const off = ALL_ENGINES.filter((e) => !inUse.has(e.label)).map((e) => e.label.toLowerCase());
    console.log(`              INOA_SCRAPE_ENGINES=${off.join(',')} would enable`);
    console.log('              the ones above, but only a "usable" verdict earns it');
}

console.log('\ntier 2 — search APIs');
const configured = API_PROVIDERS.filter((provider) => provider.key());
if (configured.length === 0) {
    row('(none)', '—', 'no API key set; the browser fallback is the only tier 2');
    // Named, not counted. 'No API key set' tells somebody the state they are
    // already looking at; the five words they could export is the part they
    // came here for.
    console.log(`${' '.repeat(14)}set any one of ${SEARCH_KEYS.join(', ')}`);
}
for (const provider of configured) {
    const key = provider.key();
    if (!key) {
        continue;
    }
    const started = Date.now();
    try {
        const hits = await provider.search(query, key);
        if (hits && hits.length > 0) {
            usable.push(provider.label);
            row(provider.label, 'usable', `${hits.length} hits in ${Date.now() - started}ms`);
        } else {
            blocked.push(provider.label);
            row(provider.label, 'no data', 'answered, but with nothing usable');
        }
    } catch (error) {
        blocked.push(provider.label);
        row(provider.label, 'error', (error as Error).message);
    }
}

console.log('\ntier 2 — browser fallback');
const outcome = await browserSearch(name);

/*
 * Two diagnoses arrive as the same 'unknown', and only one of them is about
 * this network. `npm install` does not download Chromium, so the commonest
 * reason this tier says nothing is that nobody has installed it — reporting
 * that as "refusing this network" sends you hunting for another address to
 * fix a one-line install.
 */
const neverStarted = /executable doesn't exist|playwright install|browsertype\.launch/i.test(
    outcome.detail ?? ''
);

if (outcome.status !== 'unknown') {
    usable.push('browser');
    row('Google', 'usable', outcome.detail ?? outcome.status);
} else if (neverStarted) {
    row('Google', 'missing', 'Chromium is not installed');
    console.log(`${' '.repeat(14)}run \`npx playwright install chromium\` to use this tier`);
} else {
    blocked.push('browser');
    row('Google', 'blocked', outcome.detail ?? 'no answer');
}
await closeBrowser();

console.log('\nsummary');
if (usable.length === 0) {
    console.log('  Nothing here can answer a web check. Every name would come back');
    console.log('  unverified. Set a search API key, or move to another network.');
} else {
    console.log(`  Web checks would resolve through: ${usable.join(', ')}.`);
}
if (blocked.length > 0) {
    console.log(`  Refusing this network: ${blocked.join(', ')}.`);
}
if (neverStarted) {
    console.log('  The browser tier was not measured at all: Chromium is not installed.');
}
if (!usable.includes('browser') && configured.length === 0) {
    console.log('  With no API key and the browser blocked, a run would pace itself at');
    console.log('  a minute a name to learn nothing. Set one of these before running:');
    console.log(`  ${SEARCH_KEYS.join(', ')}.`);
}
