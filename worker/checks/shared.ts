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

function levenshtein(a: string, b: string): number {
    if (a === b) {
        return 0;
    }
    let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
    for (let i = 1; i <= a.length; i++) {
        const curr = [i];
        for (let j = 1; j <= b.length; j++) {
            curr[j] = Math.min(
                curr[j - 1]! + 1,
                prev[j]! + 1,
                prev[j - 1]! + (a[i - 1] === b[j - 1] ? 0 : 1)
            );
        }
        prev = curr;
    }
    return prev[b.length]!;
}
