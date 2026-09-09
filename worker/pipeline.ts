/**
 * The checking funnel.
 *
 * Checks run cheapest-first — the domains, then App Store, Play Store, then
 * web — because the expensive ones are the rate-limited ones. Apple tolerates
 * roughly 20 calls a minute and the web tier costs a browser or an API credit,
 * while a domain costs a DNS lookup and nobody's quota, so every name a domain
 * gate drops is a name they never have to see.
 *
 * Which domains is the run's own business. One run asks about the .com, another
 * about eight TLDs; the funnel does not care how many, only that they come
 * first and that a required one can end a name.
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

import {
    platformOf,
    statusOf,
    tldOf,
    type CheckKind,
    type CheckStatuses
} from '../src/lib/types.ts';
import { checkAppStore } from './checks/appstore.ts';
import { checkDomain } from './checks/domain.ts';
import { checkHandle } from './checks/handle.ts';
import { appleLimit, playLimit, webLimit, RateLimit } from './checks/limiter.ts';
import { checkPlayStore } from './checks/playstore.ts';
import { type CheckOutcome } from './checks/shared.ts';
import { checkWeb, hasSearchApi } from './checks/web.ts';

const STORE_RUNNERS: Record<string, (name: string) => Promise<CheckOutcome>> = {
    appStore: checkAppStore,
    playStore: checkPlayStore,
    google: checkWeb
};

/** What actually answers a check. Every TLD and every platform shares a runner. */
export function runnerFor(kind: CheckKind): (name: string) => Promise<CheckOutcome> {
    const tld = tldOf(kind);
    if (tld) {
        return (name: string) => checkDomain(name, tld);
    }
    const at = platformOf(kind);
    if (at) {
        return (name: string) => checkHandle(name, at);
    }
    return STORE_RUNNERS[kind] ?? (() => Promise.resolve({ status: 'unknown' as const }));
}

/**
 * Which shared limiter each check queues against.
 *
 * Domain checks have none: each is DNS and one request against a different
 * host, with nobody's quota to exhaust. That is also what makes asking for
 * eight TLDs reasonable — it costs time, not somebody's allowance.
 */
const LIMITS: Record<string, RateLimit> = {
    appStore: appleLimit,
    playStore: playLimit,
    google: webLimit
};

/**
 * Handle checks queue, unlike domain checks.
 *
 * A domain check reaches a different host every time. A handle check reaches
 * the same one for every name in the run, and GitHub and X both throttle an
 * unauthenticated caller — a thousand requests arriving at once is the shape
 * of traffic they throttle for. One limiter per platform, so a slow GitHub
 * does not hold up X.
 */
const handleLimits = new Map<string, RateLimit>();

function limitFor(kind: CheckKind): RateLimit | undefined {
    const at = platformOf(kind);
    if (!at) {
        return LIMITS[kind];
    }
    let limit = handleLimits.get(at);
    if (!limit) {
        limit = new RateLimit(Number(process.env.INOA_HANDLE_INTERVAL_MS ?? 1200));
        handleLimits.set(at, limit);
    }
    return limit;
}

/**
 * The order to actually run checks in, for these requirements.
 *
 * Required first, then the rest, each group keeping the run's own order —
 * which is domains before stores, because domains cost no quota. With Play
 * Store alone required that is playStore, then the TLDs, then appStore and
 * google.
 */
export function checkOrder(kinds: CheckKind[], required: Requirements): CheckKind[] {
    return [
        ...kinds.filter((kind) => required.includes(kind)),
        ...kinds.filter((kind) => !required.includes(kind))
    ];
}

/**
 * The checks that run in the main funnel, out of the ones this run makes.
 *
 * The web check joins them whenever a search API is configured, because then
 * it costs about a second. Without a key it needs a browser at roughly a name
 * a minute, and it is deferred to the slow queue instead — see webqueue.ts.
 *
 * That deferral outranks the priority order: a required web check still runs
 * last when it has to drive a browser, because a minute a name is not a cost
 * that any ordering can make worthwhile.
 */
export function fastChecks(kinds: CheckKind[]): CheckKind[] {
    return hasSearchApi() ? kinds : kinds.filter((k) => k !== 'google');
}

/**
 * A verdict this name already has from an earlier run, if any.
 *
 * Passed in rather than looked up here, so the funnel stays a pure sequence of
 * checks and can be exercised without a database.
 */
export type PriorVerdict = (name: string, kind: CheckKind) => Promise<CheckOutcome | null>;

/**
 * The checks that can drop a name.
 *
 * A list rather than a record of booleans: the keys are no longer known ahead
 * of time, and a record whose shape depends on a person's choice is a record
 * the type system cannot check anything about.
 */
export type Requirements = readonly CheckKind[];

export interface CandidateResult {
    /**
     * A state for every check this run makes, including ones this pass did not.
     *
     * Populated for each kind rather than left sparse, so a caller never has to
     * decide what a missing key means — and where one is missing anyway,
     * statusOf() answers 'pending' rather than each caller guessing.
     */
    statuses: CheckStatuses;
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
export function computePassed(statuses: CheckStatuses, required: Requirements): boolean | null {
    if (required.some((kind) => statusOf(statuses, kind) === 'pending')) {
        return null;
    }
    return required.every((kind) => statuses[kind] === 'clear');
}

export async function checkCandidate(
    name: string,
    required: Requirements,
    kinds: CheckKind[],
    prior?: PriorVerdict,
    all: CheckKind[] = kinds
): Promise<CandidateResult> {
    const statuses: CheckStatuses = {};
    for (const kind of all) {
        statuses[kind] = 'pending';
    }
    const detail: Partial<Record<CheckKind, string>> = {};
    let droppedBy: CheckKind | null = null;

    for (const kind of checkOrder(all, required)) {
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
            await limitFor(kind)?.take();
            outcome = await runnerFor(kind)(name);
        }
        statuses[kind] = outcome.status;
        if (outcome.detail) {
            detail[kind] = outcome.detail;
        }

        if (required.includes(kind) && outcome.status === 'taken') {
            droppedBy = kind;
        }
    }

    return { statuses, detail, passed: computePassed(statuses, required), droppedBy };
}
