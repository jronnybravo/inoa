/**
 * The checking funnel.
 *
 * Checks run cheapest-first — .com, App Store, Play Store, then web — because
 * the expensive ones are the rate-limited ones. Apple tolerates roughly 20
 * calls a minute and the web tier costs a browser or an API credit, so every
 * name the .com gate drops is a name they never have to see.
 *
 * A REQUIRED check that comes back 'taken' drops the name immediately and the
 * remaining checks are marked skipped. An unrequired check never drops a name;
 * it is recorded and the funnel continues, so the results table is complete for
 * everything that survives.
 *
 * 'unknown' never drops a name and never counts as a pass. We did not find a
 * collision, but we did not establish there isn't one, and quietly promoting
 * that to 'clear' is exactly the bug that let 500 names through unchecked.
 *
 * The web check does not run here. It is drained separately and far more
 * slowly — see worker/webqueue.ts for why.
 */

import { CHECK_ORDER, type CheckKind, type CheckStatus } from '../src/lib/types.ts';
import { checkAppStore } from './checks/appstore.ts';
import { checkCom } from './checks/domain.ts';
import { appleLimit, playLimit, webLimit } from './checks/limiter.ts';
import { checkPlayStore } from './checks/playstore.ts';
import { type CheckOutcome } from './checks/shared.ts';
import { checkWeb, hasSearchApi } from './checks/web.ts';
import type { RateLimit } from './checks/limiter.ts';

const RUNNERS: Record<CheckKind, (name: string) => Promise<CheckOutcome>> = {
    com: checkCom,
    appStore: checkAppStore,
    playStore: checkPlayStore,
    google: checkWeb
};

/**
 * Which shared limiter each check queues against.
 *
 * The .com check has none: it is DNS and one request against a different host
 * every time, with nobody's quota to exhaust.
 */
const LIMITS: Partial<Record<CheckKind, RateLimit>> = {
    appStore: appleLimit,
    playStore: playLimit,
    google: webLimit
};

/**
 * The checks that run in the main funnel.
 *
 * The web check joins them whenever a search API is configured, because then
 * it costs about a second. Without a key it needs a browser at roughly a name
 * a minute, and it is deferred to the slow queue instead — see webqueue.ts.
 *
 * That deferral outranks the priority order: a required web check still runs
 * last when it has to drive a browser, because a minute a name is not a cost
 * that any ordering can make worthwhile.
 */
/**
 * The order to actually run checks in, for these requirements.
 *
 * Required first, then the rest, each group in cost order. With Play Store
 * alone required that is playStore, com, appStore, google; with the two stores
 * required it is appStore, playStore, com, google.
 */
export function checkOrder(required: Requirements): CheckKind[] {
    return [
        ...CHECK_ORDER.filter((kind) => required[kind]),
        ...CHECK_ORDER.filter((kind) => !required[kind])
    ];
}

export function fastChecks(): CheckKind[] {
    return hasSearchApi() ? CHECK_ORDER : CHECK_ORDER.filter((k) => k !== 'google');
}

/**
 * A verdict this name already has from an earlier run, if any.
 *
 * Passed in rather than looked up here, so the funnel stays a pure sequence of
 * checks and can be exercised without a database.
 */
export type PriorVerdict = (name: string, kind: CheckKind) => Promise<CheckOutcome | null>;

export interface Requirements {
    com: boolean;
    appStore: boolean;
    playStore: boolean;
    google: boolean;
}

export interface CandidateResult {
    /**
     * Every check has a state, including the ones this pass did not run.
     *
     * A partial record forced each caller to assert the keys back into
     * existence, which is a lie the type system cannot check. 'pending' is the
     * honest value for a check nobody made.
     */
    statuses: Record<CheckKind, CheckStatus>;
    detail: Partial<Record<CheckKind, string>>;
    /** null while a required check has not answered yet. */
    passed: boolean | null;
    droppedBy: CheckKind | null;
}

/**
 * Did every required check positively clear this name?
 *
 * A check still pending is not a pass, so this returns null while any required
 * check has yet to answer — which is what keeps a name out of the results
 * email until the slow web queue has actually reached it.
 */
export function computePassed(
    statuses: Partial<Record<CheckKind, CheckStatus>>,
    required: Requirements
): boolean | null {
    const relevant = CHECK_ORDER.filter((kind) => required[kind]);
    if (relevant.some((kind) => (statuses[kind] ?? 'pending') === 'pending')) {
        return null;
    }
    return relevant.every((kind) => statuses[kind] === 'clear');
}

export async function checkCandidate(
    name: string,
    required: Requirements,
    kinds: CheckKind[] = CHECK_ORDER,
    prior?: PriorVerdict
): Promise<CandidateResult> {
    const statuses: Record<CheckKind, CheckStatus> = {
        com: 'pending',
        appStore: 'pending',
        playStore: 'pending',
        google: 'pending'
    };
    const detail: Partial<Record<CheckKind, string>> = {};
    let droppedBy: CheckKind | null = null;

    for (const kind of checkOrder(required)) {
        // Checks this pass is not responsible for keep whatever state they hold.
        if (!kinds.includes(kind)) {
            continue;
        }

        if (droppedBy) {
            statuses[kind] = 'skipped';
            continue;
        }

        /*
         * A verdict already on record costs nothing and takes no slot on the
         * limiter, which is the point: the rate limits exist to pace calls we
         * actually make.
         */
        const borrowed = await prior?.(name, kind);
        let outcome: CheckOutcome;

        if (borrowed) {
            outcome = borrowed;
        } else {
            // Wait for a slot on the shared schedule, not a private timer —
            // otherwise concurrent names all call the same service at once.
            await LIMITS[kind]?.take();
            outcome = await RUNNERS[kind](name);
        }
        statuses[kind] = outcome.status;
        if (outcome.detail) {
            detail[kind] = outcome.detail;
        }

        if (required[kind] && outcome.status === 'taken') {
            droppedBy = kind;
        }
    }

    return { statuses, detail, passed: computePassed(statuses, required), droppedBy };
}
