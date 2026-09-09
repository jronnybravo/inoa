/**
 * Vendor the list of buyable top-level domains, most used first.
 *
 * Fetched at build time rather than at run time: these lists change a few
 * times a year, and a form that cannot offer '.com' because IANA is briefly
 * unreachable is worse than one that is a month out of date.
 *
 * Three sources, because no single one answers the question:
 *
 *   IANA   the authoritative set of TLDs that actually exist
 *   ICANN  which of them anybody can register in — a registry agreement with
 *          Specification 13 is a brand running its own name (.bmw, .google),
 *          closed to the public however real the TLD is
 *   Tranco how many of the top million sites use each one, which is the only
 *          honest way to order 900 of them: '.com' first because it is first,
 *          not because somebody guessed it should be
 *
 *   node scripts/generate-tlds.mjs
 */

import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { toUnicode } from 'node:punycode';

const IANA = 'https://data.iana.org/TLD/tlds-alpha-by-domain.txt';
const ICANN = 'https://www.icann.org/resources/registries/gtlds/v2/gtlds.json';
const TRANCO = 'https://tranco-list.eu/top-1m.csv.zip';

/**
 * Reserved by IANA rather than sold by anyone.
 *
 * These are not brand TLDs and carry no ICANN registry agreement, so nothing
 * in the data above marks them — but no amount of money gets you a .gov.
 */
const NOT_FOR_SALE = new Set(['arpa', 'gov', 'mil', 'edu', 'int']);

async function text(url) {
    const response = await fetch(url);
    if (!response.ok) {
        throw new Error(`${url} returned ${response.status}`);
    }
    return response.text();
}

console.log('fetching IANA root zone…');
const iana = await text(IANA);
const [header, ...rows] = iana.trim().split('\n');
const version = header.match(/Version (\d+)/)?.[1] ?? 'unknown';
const all = rows.map((line) => line.trim().toLowerCase()).filter(Boolean);

console.log('fetching ICANN registry agreements…');
const icann = JSON.parse(await text(ICANN));
const closed = new Set(
    (icann.gTLDs ?? icann)
        .filter((g) => g.specification13 || g.contractTerminated || g.removalDate)
        .map((g) => String(g.gTLD).toLowerCase())
);

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

const buyable = all.filter((tld) => !closed.has(tld) && !NOT_FOR_SALE.has(tld));

/*
 * Most used first, and alphabetical among the many that never appear in the
 * top million at all — an arbitrary order between two TLDs nobody uses is
 * still worse than one somebody can predict.
 */
buyable.sort((a, b) => (popularity.get(b) ?? 0) - (popularity.get(a) ?? 0) || a.localeCompare(b));

const entries = buyable.map((tld) => (tld.startsWith('xn--') ? [tld, toUnicode(tld)] : [tld]));
const body = entries.map((entry) => `    ${JSON.stringify(entry)}`).join(',\n');
const ranked = buyable.filter((tld) => popularity.has(tld)).length;

writeFileSync(
    new URL('../src/lib/tlds.ts', import.meta.url),
    `/**
 * Every top-level domain anybody can register, most used first.
 *
 * Generated — do not edit by hand. Run \\\`node scripts/generate-tlds.mjs\\\` to
 * refresh it, and read that script for where each part comes from.
 *
 * IANA root zone version ${version}: ${all.length} TLDs exist, ${all.length - entries.length} of them
 * are brand registries, dead contracts or reserved, leaving ${entries.length} to choose
 * from. ${ranked} appear somewhere in the Tranco top million and are ordered by how
 * often; the remainder never appear and follow alphabetically.
 *
 * Each entry is the TLD as it appears in a hostname, optionally followed by
 * the Unicode form of an internationalised one: 'xn--fiqs8s' is what the
 * request is made against, '中国' is what somebody would search for.
 */

/** [tld, unicodeLabel?] */
export type TldEntry = readonly [string] | readonly [string, string];

export const ALL_TLDS: readonly TldEntry[] = [
${body}
];

const KNOWN = new Set(ALL_TLDS.map(([tld]) => tld));

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
