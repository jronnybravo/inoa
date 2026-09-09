/**
 * Vendor the list of top-level domains you can actually buy, most used first.
 *
 * Fetched at build time rather than at run time: these lists change a few
 * times a year, and a form that cannot offer '.com' because a service is
 * briefly unreachable is worse than one that is a month out of date.
 *
 * Three sources, because no single one answers the question:
 *
 *   IANA      the authoritative set of TLDs that exist at all
 *   Porkbun   which of them a registrar will actually sell you today, and for
 *             how much — a public price list, no key
 *   Tranco    how many of the top million sites use each one, which is the
 *             only honest way to order hundreds of them
 *
 * The registrar is the part that earns its place. An earlier version filtered
 * on ICANN's registry agreements instead, dropping brand TLDs (.bmw, .google)
 * and keeping everything else — which left 1,059 entries, hundreds of them
 * things nobody can register: .aero and .museum want credentials, .bv and .sj
 * were never issued, .kp and .cu are unobtainable, and residency-restricted
 * ccTLDs sat near the top of the list because they are popular rather than
 * available. A price from a registrar is proof: somebody will sell it to you.
 *
 * The cost is coverage. This registrar does not carry .fr, .jp, .br or .it,
 * which are certainly buyable elsewhere, so they are absent. One catalogue of
 * things you can definitely buy beats a longer list that is part fiction.
 *
 *   node scripts/generate-tlds.mjs
 */

import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { toUnicode } from 'node:punycode';

const IANA = 'https://data.iana.org/TLD/tlds-alpha-by-domain.txt';
const PRICES = 'https://api.porkbun.com/api/json/v3/pricing/get';
const TRANCO = 'https://tranco-list.eu/top-1m.csv.zip';

console.log('fetching IANA root zone…');
const iana = await fetch(IANA).then((r) => r.text());
const [header, ...rows] = iana.trim().split('\n');
const version = header.match(/Version (\d+)/)?.[1] ?? 'unknown';
const all = rows.map((line) => line.trim().toLowerCase()).filter(Boolean);

console.log('fetching registrar price list…');
const priced = await fetch(PRICES, { method: 'POST' }).then((r) => r.json());
if (priced.status !== 'SUCCESS') {
    throw new Error(`price list returned ${priced.status}`);
}

console.log('fetching Tranco top 1M…');
const work = mkdtempSync(join(tmpdir(), 'tlds-'));
const zip = join(work, 'top-1m.csv.zip');
writeFileSync(zip, Buffer.from(await (await fetch(TRANCO)).arrayBuffer()));
execFileSync('unzip', ['-o', '-q', zip, '-d', work]);

const popularity = new Map();
for (const line of readFileSync(join(work, 'top-1m.csv'), 'utf8').split('\n')) {
    const host = line.split(',')[1]?.trim();
    if (!host) {
        continue;
    }
    const tld = host.slice(host.lastIndexOf('.') + 1).toLowerCase();
    popularity.set(tld, (popularity.get(tld) ?? 0) + 1);
}

/*
 * Intersected, not unioned. The price list carries keys that are not TLDs at
 * all, and IANA carries TLDs nobody sells; only the overlap is both real and
 * for sale.
 */
/**
 * Prices arrive as strings, and the expensive ones carry a thousands
 * separator: '2,060.25'. Number() reads that as NaN, which JSON writes as
 * null — so the ten dearest TLDs came through the first time as unpriced
 * rather than as costly.
 */
function priceOf(tld) {
    const raw = priced.pricing[tld]?.registration;
    // Not sold at all, so there is nothing to parse. Guarded explicitly
    // because Number('') is 0, which is finite — every TLD the registrar has
    // never heard of would otherwise come through as free.
    if (raw === undefined || raw === null) {
        return undefined;
    }
    const usd = Number(String(raw).replace(/,/g, ''));
    return Number.isFinite(usd) && usd > 0 ? usd : undefined;
}

const buyable = all.filter((tld) => priceOf(tld) !== undefined);

/*
 * Most used first, and alphabetical among the many that never appear in the
 * top million — an arbitrary order between two TLDs nobody uses is still
 * worse than one somebody can predict.
 */
buyable.sort((a, b) => (popularity.get(b) ?? 0) - (popularity.get(a) ?? 0) || a.localeCompare(b));

const entries = buyable.map((tld) => {
    const usd = priceOf(tld);
    // An internationalised TLD is stored in the punycode a URL actually uses,
    // and labelled with the script somebody would type to search for it.
    const label = tld.startsWith('xn--') ? toUnicode(tld) : undefined;
    return label ? { tld, usd, label } : { tld, usd };
});

const body = entries.map((e) => `    ${JSON.stringify(e)}`).join(',\n');
const ranked = buyable.filter((tld) => popularity.has(tld)).length;
const today = new Date().toISOString().slice(0, 10);

writeFileSync(
    new URL('../src/lib/tlds.ts', import.meta.url),
    `/**
 * Every top-level domain you can actually register, most used first.
 *
 * Generated — do not edit by hand. Run \\\`node scripts/generate-tlds.mjs\\\` to
 * refresh it, and read that script for where each part comes from and what it
 * deliberately leaves out.
 *
 * IANA root zone version ${version}: ${all.length} TLDs exist, ${entries.length} of them are
 * carried by the registrar this list is drawn from. ${ranked} appear somewhere in
 * the Tranco top million and are ordered by how often; the rest never appear
 * and follow alphabetically.
 *
 * Prices are that registrar's first-year registration in USD, read on
 * ${today}. They are indicative — they move, and they differ between
 * registrars — but they are the right order of magnitude, which is the part
 * that matters when choosing between a .com and a .ai.
 */

export interface TldEntry {
    /** As it appears in a hostname. Punycode for an internationalised one. */
    tld: string;
    /** Indicative first-year registration, USD. */
    usd: number;
    /** The Unicode form, for the internationalised ones: 'xn--fiqs8s' is 中国. */
    label?: string;
}

export const ALL_TLDS: readonly TldEntry[] = [
${body}
];

const KNOWN = new Set(ALL_TLDS.map((entry) => entry.tld));

/** Is this a top-level domain somebody could actually buy? */
export function isTld(value: string): boolean {
    return KNOWN.has(value);
}
`
);

console.log(
    `wrote src/lib/tlds.ts — ${entries.length} buyable of ${all.length} (IANA ${version}), ` +
        `${ranked} ranked by usage`
);
