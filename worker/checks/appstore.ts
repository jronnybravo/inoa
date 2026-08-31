/**
 * Apple App Store, via the official iTunes Search API.
 *
 * Free and unauthenticated, but fuzzy — searching 'Warmgrove' returns
 * 'WarmLife' — so the verdict comes from comparing titles, never from the
 * result count. It is also the most eliminating check in practice (it rejected
 * roughly half of a 500-name batch) and the most rate-limited, at around 20
 * calls a minute, which is why it sits behind the cheap .com gate.
 */

import { isBrandCollision, type CheckOutcome } from './shared.ts';

interface ItunesResponse {
    results?: { trackName?: string; trackViewUrl?: string }[];
}

export async function checkAppStore(name: string): Promise<CheckOutcome> {
    const url =
        `https://itunes.apple.com/search?term=${encodeURIComponent(name)}` +
        `&entity=software&limit=25&country=us`;
    try {
        const response = await fetch(url, { signal: AbortSignal.timeout(12000) });
        // 403 here means rate limited, not "no such app".
        if (!response.ok) {
            return { status: 'unknown', detail: `iTunes returned ${response.status}` };
        }
        const data = (await response.json()) as ItunesResponse;
        const hits = (data.results ?? []).filter((r) => isBrandCollision(name, r.trackName ?? ''));
        if (hits.length === 0) return { status: 'clear' };
        return {
            status: 'taken',
            detail: hits
                .slice(0, 4)
                .map((h) => h.trackName)
                .join(' | ')
        };
    } catch (error) {
        return { status: 'unknown', detail: (error as Error).message };
    }
}
