/**
 * The web check, drained on its own slow clock.
 *
 * Every other check has a limit you can pace against: Apple tolerates roughly
 * twenty calls a minute and says so with a 403. Search engines do not work that
 * way. Google gives no warning, then serves its /sorry/ interstitial — and the
 * penalty is long lived rather than a short rolling window. Measured here: it
 * tripped after roughly 25 queries and was still blocking half an hour later,
 * in both headless and headed real Chrome.
 *
 * That has two consequences, and the second is the important one.
 *
 * Pacing. Running the web check inline would fire it as fast as the funnel
 * produces survivors. Spacing queries a minute apart is far less likely to trip
 * the limit in the first place.
 *
 * Backoff. This is what running inline could never do. Once blocked, an inline
 * check keeps calling and marks every remaining name 'unverified' in quick
 * succession — the run finishes fast and tells you nothing, and the names look
 * checked. A queue can notice the block and simply stop for a while, then carry
 * on where it left off. The run takes longer and the answers are real.
 *
 * Only names that survived the earlier gates reach here, which is what makes a
 * minute apiece affordable: the funnel has usually already removed most of them.
 *
 * With BRAVE_API_KEY set none of this applies — an API has an ordinary quota
 * and is paced in seconds, not minutes.
 */

import { candidateStatuses } from '../src/lib/checks.ts';
import { Candidate } from '../src/lib/server/entities/candidate.ts';
import { jitter, sleep, type CheckOutcome } from './checks/shared.ts';
import { checkWeb, hasSearchApi } from './checks/web.ts';
import { computePassed, type Requirements } from './pipeline.ts';
import type { CheckStatus, CheckStatuses } from '../src/lib/types.ts';

/** One a minute when we are driving a browser; seconds when Brave answers. */
const BROWSER_INTERVAL_MS = Number(process.env.INOA_WEB_INTERVAL_MS ?? 60_000);
const API_INTERVAL_MS = 1_500;

/** How long to stand down after Google signals it has had enough. */
const BACKOFF_MS = Number(process.env.INOA_WEB_BACKOFF_MS ?? 30 * 60_000);

/** Consecutive challenges before we stop trying at all for this run. */
const MAX_BACKOFFS = 3;

const usingApi = hasSearchApi;

const CHALLENGED = /challenged the request/i;

export interface QueueProgress {
    (done: number, total: number, note?: string): Promise<void> | void;
}

/**
 * Work through every candidate still awaiting a web verdict.
 *
 * Returns the number actually resolved. Candidates left 'pending' because we
 * gave up are reported as 'unknown' rather than silently passing.
 */
export async function drainWebQueue(
    candidates: typeof Candidate,
    runId: string,
    required: Requirements,
    onProgress?: QueueProgress,
    /*
     * The check itself, passed in for the same reason the entity class is:
     * what this function actually contains is the pacing, the backoff and the
     * decision to give up, and none of that can be exercised against a real
     * search. Production never passes it.
     */
    check: (name: string) => Promise<CheckOutcome> = checkWeb,
    /*
     * A stop request, if one can arrive. This queue is the longest thing a
     * run does - a minute a name in the browser tier - so it is the phase
     * somebody is most likely to want out of.
     */
    stop?: AbortSignal
): Promise<{ resolved: number; abandoned: number }> {
    const pending = await candidates.find({
        where: { runId, google: 'pending' as CheckStatus },
        order: { position: 'ASC' }
    });

    const interval = usingApi() ? API_INTERVAL_MS : BROWSER_INTERVAL_MS;
    let resolved = 0;
    let backoffs = 0;

    // Indexed rather than for-of, because a backoff has to retry the SAME name.
    // The pause exists to let the block clear; advancing past the name would
    // spend the queue during the very window we are waiting out.
    let index = 0;
    while (index < pending.length) {
        if (stop?.aborted) {
            break;
        }
        const candidate = pending[index];
        if (!candidate) {
            break;
        }
        const outcome = await check(candidate.name);

        /*
         * Backing off is a browser-tier remedy, so it is gated on being in that
         * tier. With any provider configured the queue never drives a browser,
         * and a challenge arriving here would be somebody else's failure
         * wearing Google's name — worth neither a pause nor an abandoned run.
         */
        if (!usingApi() && outcome.status === 'unknown' && CHALLENGED.test(outcome.detail ?? '')) {
            backoffs++;
            if (backoffs > MAX_BACKOFFS) {
                // Stop rather than march through the rest producing junk verdicts.
                await onProgress?.(resolved, pending.length, 'search blocked; stopping web checks');
                break;
            }
            await onProgress?.(
                resolved,
                pending.length,
                `search blocked; pausing ${Math.round(BACKOFF_MS / 60_000)}m (attempt ${backoffs})`
            );
            await sleep(BACKOFF_MS);
            continue;
        }

        // Everything already on record, with the verdict this queue just made.
        const statuses: CheckStatuses = {
            ...candidateStatuses(candidate),
            google: outcome.status
        };

        await candidates.update(candidate.id, {
            google: outcome.status,
            detail: { ...candidate.detail, ...(outcome.detail ? { google: outcome.detail } : {}) },
            passed: computePassed(statuses, required),
            checkedAt: new Date()
        });

        resolved++;
        // A name that answered means the engine is talking to us again.
        backoffs = 0;
        await onProgress?.(resolved, pending.length);
        index++;
        if (index < pending.length) {
            await sleep(jitter(interval));
        }
    }

    /*
     * A stop leaves the rest alone.
     *
     * 'Search was blocked; not verified' is a claim about the engine, and it
     * would be false here - nothing was blocked, somebody asked us to stop.
     * Those names stay 'pending', which is what they are: not yet checked.
     */
    if (stop?.aborted) {
        return { resolved, abandoned: 0 };
    }

    // Anything still pending was abandoned; say so rather than leaving it looking
    // like the check simply has not got there yet.
    const leftover = await candidates.find({
        where: { runId, google: 'pending' as CheckStatus }
    });
    for (const candidate of leftover) {
        await candidates.update(candidate.id, {
            google: 'unknown',
            detail: { ...candidate.detail, google: 'Search was blocked; not verified' },
            passed: computePassed({ ...candidateStatuses(candidate), google: 'unknown' }, required)
        });
    }

    return { resolved, abandoned: leftover.length };
}
