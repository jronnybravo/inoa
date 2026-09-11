/**
 * Verdicts borrowed from earlier runs.
 *
 * The same name comes up again — briefs overlap, and a thousand-name run over
 * the same subject reaches for the same material. Every one of those repeats
 * used to be re-checked from scratch, which spends an Apple call, a Play
 * scrape and a search credit to re-learn something already recorded.
 *
 * Borrowing is bounded by age, because a verdict is a fact about a moment: a
 * domain lapses, an app ships, a company folds. Anything older than the window
 * is checked again rather than trusted.
 *
 * Only 'clear' and 'taken' are reusable. 'unknown' means the check could not
 * answer, and reusing that would preserve a failure rather than retry it.
 */

import { candidateStatuses } from '../../src/lib/checks.ts';
import { Candidate } from '../../src/lib/server/entities/candidate.ts';
import { statusOf } from '../../src/lib/types.ts';
import type { CheckOutcome } from './shared.ts';
import type { CheckKind, CheckStatus } from '../../src/lib/types.ts';

/** How long a verdict is worth borrowing. Set INOA_REUSE_DAYS=0 to disable. */
const REUSE_DAYS = Number(process.env.INOA_REUSE_DAYS ?? 14);

const DAY = 24 * 60 * 60 * 1000;

/**
 * Which generation of the checking rules a stored verdict came from.
 *
 * Bump this whenever a change alters what a check CONCLUDES, rather than how
 * it gets there. A verdict is only as good as the code that reached it, and
 * this is the only thing standing between a fixed checker and a database full
 * of answers it would no longer give.
 *
 * 2 — .ph and every other registry that answers for names it does not have.
 *     Their catch-all host speaks TLS badly, so every free name in those TLDs
 *     was recorded 'taken'; ENOTFOUND also stopped being read as 'unregistered'
 *     on its own. Every domain verdict written before this is suspect.
 */
export const CHECKER_VERSION = 2;

/**
 * The reuse note this module adds, so it can be taken off again.
 *
 * Without stripping it the decoration compounds: a verdict borrowed from a
 * borrowed verdict came out reading '… — reused, checked earlier today —
 * reused, checked earlier today', which is both untidy and a fair description
 * of the bug underneath it.
 */
const REUSE_NOTE = / — reused, (?:checked earlier today|checked \d+ days? ago)$/;

function describeAge(checkedAt: Date): string {
    const days = Math.floor((Date.now() - checkedAt.getTime()) / DAY);
    if (days < 1) {
        return 'checked earlier today';
    }
    return `checked ${days} day${days === 1 ? '' : 's'} ago`;
}

/** A borrowed verdict, and when the sighting behind it actually happened. */
export interface BorrowedVerdict extends CheckOutcome {
    /** ISO, and carried forward so the next borrower ages it from here. */
    observedAt: string;
}

/**
 * The most recent usable verdict for this name and check, if there is one.
 *
 * Returns null when reuse is switched off, when nothing recent enough exists,
 * when the only records are inconclusive, or when they were reached by rules
 * this build no longer agrees with.
 */
export async function priorVerdict(
    name: string,
    kind: CheckKind,
    excludeRunId?: string
): Promise<BorrowedVerdict | null> {
    if (REUSE_DAYS <= 0) {
        return null;
    }

    const rows = await Candidate.find({
        where: { name },
        order: { checkedAt: 'DESC' },
        take: 8
    });

    const cutoff = Date.now() - REUSE_DAYS * DAY;
    for (const row of rows) {
        if (row.runId === excludeRunId || !row.checkedAt) {
            continue;
        }

        /*
         * Rules we no longer agree with, however recently they ran.
         *
         * Null is every row written before this column existed, which is
         * exactly the population the first bump is aimed at.
         */
        if (row.checkerVersion !== CHECKER_VERSION) {
            continue;
        }

        /*
         * The age of the SIGHTING, not of the row.
         *
         * Reuse writes a fresh checkedAt, so a borrowed verdict looks newly
         * checked and the next run borrows it again — the fourteen days below
         * were reset by the act of reusing, and a wrong answer recorded once
         * was served for ever. observedAt is carried forward untouched, so the
         * window finally measures what it claims to.
         */
        const seen = row.observedAt?.[kind];
        const when = seen ? new Date(seen) : row.checkedAt;
        if (when.getTime() < cutoff) {
            continue;
        }

        const status: CheckStatus = statusOf(candidateStatuses(row), kind);
        if (status !== 'clear' && status !== 'taken') {
            continue;
        }

        // Stripped, not appended to, or the note stacks up one copy per hop.
        const found = row.detail?.[kind]?.replace(REUSE_NOTE, '');
        return {
            status,
            observedAt: when.toISOString(),
            detail: found
                ? `${found} — reused, ${describeAge(when)}`
                : `reused from an earlier run, ${describeAge(when)}`
        };
    }

    return null;
}
