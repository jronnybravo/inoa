import type { CheckStatus } from '../../src/lib/types.ts';

export interface CheckOutcome {
    status: CheckStatus;
    detail?: string;
}

export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Jittered, so a run does not hit any endpoint on a fixed rhythm. */
export const jitter = (base: number) => base + Math.floor(Math.random() * base * 0.6);

export function squash(value: string): string {
    return value.toLowerCase().replace(/[^a-z0-9]/g, '');
}

/**
 * The words a title is built from, camelCase counted as a break.
 *
 * squash() deliberately destroys these boundaries so that punctuation and
 * spacing cannot hide a match, and for a long name that is the right trade:
 * eight distinctive characters landing anywhere in a title mean something. A
 * short one is different. 'Vida' is the brand in 'Vida Health' and a fragment
 * in 'Avida', 'Loom' is the brand in 'Loom Video' and three letters of
 * 'Heirloom' — squashed, those pairs are indistinguishable, and only the
 * boundary tells them apart.
 */
export function words(value: string): string[] {
    return value
        .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
        .toLowerCase()
        .split(/[^a-z0-9]+/)
        .filter(Boolean);
}

/**
 * The shortest name a word match is trusted for.
 *
 * Below four characters a letter-string is too ordinary to carry a brand:
 * 'go', 'one' and 'ad' appear as words in titles that hold no collision at
 * all. Names that short fall back to needing an exact match.
 */
const WORD_MATCH_MIN = 4;

/**
 * Does a listing or result title collide with this name?
 *
 * Ported from name-checker, whose thresholds were tuned against real results.
 * The containment floor exists because without it 'BoardTarget' collided with
 * apps literally named 'Board' and 'Target'.
 */
export function isBrandCollision(candidate: string, existing: string): boolean {
    const a = squash(candidate);
    const b = squash(existing);
    if (!a || !b) {
        return false;
    }
    if (a === b) {
        return true;
    }

    /*
     * Our name is one of the words the listing is made of: 'Vida Health',
     * 'Pro Vida', 'The Keystone App'. This is what lets a four-letter name be
     * matched at all — the rules below work on the squashed string, where a
     * short name is indistinguishable from a fragment of a longer word, so
     * they stay gated at six. It also closes a gap for long names, which the
     * squashed prefix and suffix tests miss whenever the brand sits in the
     * middle of a title.
     */
    if (a.length >= WORD_MATCH_MIN && words(existing).includes(a)) {
        return true;
    }

    if (a.length >= 6) {
        // Someone shipped our brand with something bolted on: 'Keystone Pro'.
        if (b.startsWith(a) || b.endsWith(a)) {
            return true;
        }
        // Our name is an existing brand plus decoration: 'Spotifyy'.
        const containment = b.length / a.length;
        if (containment >= 0.6 && (a.startsWith(b) || a.endsWith(b))) {
            return true;
        }
    }

    if (a.length >= 5 && b.length >= 5 && similarity(a, b) >= 0.88) {
        return true;
    }
    return false;
}

export function similarity(a: string, b: string): number {
    const max = Math.max(a.length, b.length);
    if (max === 0) {
        return 1;
    }
    return 1 - levenshtein(a, b) / max;
}

/**
 * Two rows of the edit-distance matrix, reused.
 *
 * Typed arrays rather than plain ones: every read here is in range by
 * construction, and a Float64Array says so to the type checker without a
 * non-null assertion on each of the four lookups in the inner loop.
 */
function levenshtein(a: string, b: string): number {
    if (a === b) {
        return 0;
    }
    let prev = new Float64Array(b.length + 1);
    let curr = new Float64Array(b.length + 1);
    for (let j = 0; j <= b.length; j++) {
        prev[j] = j;
    }

    for (let i = 1; i <= a.length; i++) {
        curr[0] = i;
        // The three neighbours are carried forward rather than re-read: the
        // cell to the left is what was just written, and the diagonal is the
        // cell above from the previous step.
        let left = i;
        let diagonal = prev[0] ?? 0;
        for (let j = 1; j <= b.length; j++) {
            const above = prev[j] ?? 0;
            const value = Math.min(left + 1, above + 1, diagonal + (a[i - 1] === b[j - 1] ? 0 : 1));
            curr[j] = value;
            left = value;
            diagonal = above;
        }
        [prev, curr] = [curr, prev];
    }
    return prev[b.length] ?? 0;
}
