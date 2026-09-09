/**
 * What a run checks, read off the row.
 *
 * A run used to check four fixed things, so the answer was four booleans and
 * four columns. It now checks whichever TLDs somebody picked out of a thousand,
 * plus the two stores and the web — so the answer is a list, and it has to be
 * derived rather than read.
 *
 * Rows written before that carry a single .com verdict in its own column and a
 * requireCom boolean. Both shapes are normalised here, in one place, so that
 * nothing downstream has to know two schemas: a run from August and a run from
 * today both arrive as a list of kinds and a list of statuses.
 */

import {
    STORE_ORDER,
    tldKind,
    type CheckKind,
    type CheckStatus,
    type CheckStatuses,
    type RunChecks
} from './types.ts';

/** The columns of a run this depends on, so callers can pass anything shaped so. */
export interface RunChecksRow {
    tlds: string[] | null;
    requiredTlds: string[] | null;
    requireCom: boolean;
    requireAppStore: boolean;
    requirePlayStore: boolean;
    requireGoogle: boolean;
}

/** The columns of a candidate this depends on. */
export interface CandidateChecksRow {
    domains: Record<string, CheckStatus> | null;
    com: CheckStatus;
    appStore: CheckStatus;
    playStore: CheckStatus;
    google: CheckStatus;
}

/**
 * Every check this run makes, in the order it makes them.
 *
 * Domains lead the funnel because they are the only checks with no shared
 * limiter behind them: each one is a DNS lookup and a request to a different
 * host, so a hundred of them cost nobody's quota. Everything a domain drops is
 * a name Apple never has to be asked about.
 */
export function runChecks(run: RunChecksRow): RunChecks {
    const tlds = run.tlds ?? ['com'];
    const requiredTlds = run.requiredTlds ?? (run.requireCom ? ['com'] : []);

    const kinds: CheckKind[] = [...tlds.map(tldKind), ...STORE_ORDER];
    const required: CheckKind[] = [
        // Intersected rather than trusted: a required TLD that is no longer
        // among the checked ones could never clear, so every name would fail.
        ...tlds.filter((tld) => requiredTlds.includes(tld)).map(tldKind),
        ...STORE_ORDER.filter((kind) => STORE_REQUIRED[kind](run))
    ];

    return { kinds, required };
}

const STORE_REQUIRED: Record<(typeof STORE_ORDER)[number], (run: RunChecksRow) => boolean> = {
    appStore: (run) => run.requireAppStore,
    playStore: (run) => run.requirePlayStore,
    google: (run) => run.requireGoogle
};

/** Every verdict held against this candidate, keyed the way the funnel keys them. */
export function candidateStatuses(row: CandidateChecksRow): CheckStatuses {
    const statuses: CheckStatuses = {
        appStore: row.appStore,
        playStore: row.playStore,
        google: row.google
    };

    if (row.domains) {
        for (const [tld, status] of Object.entries(row.domains)) {
            statuses[tldKind(tld)] = status;
        }
    } else {
        // A row from before `domains`: its one verdict was the .com.
        statuses[tldKind('com')] = row.com;
    }

    return statuses;
}

/**
 * The same statuses as something a candidate row can be updated with.
 *
 * The store columns stay columns — there are three of them and there always
 * will be — while the domains collapse into one JSON value, because their
 * number is a person's choice rather than a property of the schema.
 */
export function statusColumns(statuses: CheckStatuses): {
    domains: Record<string, CheckStatus>;
    appStore: CheckStatus;
    playStore: CheckStatus;
    google: CheckStatus;
} {
    const domains: Record<string, CheckStatus> = {};
    for (const [kind, status] of Object.entries(statuses)) {
        if (kind.startsWith('tld:') && status) {
            domains[kind.slice(4)] = status;
        }
    }
    return {
        domains,
        appStore: statuses.appStore ?? 'pending',
        playStore: statuses.playStore ?? 'pending',
        google: statuses.google ?? 'pending'
    };
}
