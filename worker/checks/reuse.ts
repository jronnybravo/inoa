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

import { Candidate } from '../../src/lib/server/entities/candidate.ts';
import type { CheckOutcome } from './shared.ts';
import type { CheckKind, CheckStatus } from '../../src/lib/types.ts';

/** How long a verdict is worth borrowing. Set BRANDY_REUSE_DAYS=0 to disable. */
const REUSE_DAYS = Number(process.env.BRANDY_REUSE_DAYS ?? 14);

const DAY = 24 * 60 * 60 * 1000;

function describeAge(checkedAt: Date): string {
    const days = Math.floor((Date.now() - checkedAt.getTime()) / DAY);
    if (days < 1) {
        return 'checked earlier today';
    }
    return `checked ${days} day${days === 1 ? '' : 's'} ago`;
}

/**
 * The most recent usable verdict for this name and check, if there is one.
 *
 * Returns null when reuse is switched off, when nothing recent enough exists,
 * or when the only records are inconclusive.
 */
export async function priorVerdict(
    name: string,
    kind: CheckKind,
    excludeRunId?: string
): Promise<CheckOutcome | null> {
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
        if (row.checkedAt.getTime() < cutoff) {
            // Ordered newest first, so everything after this is older still.
            break;
        }

        const status: CheckStatus = row[kind];
        if (status !== 'clear' && status !== 'taken') {
            continue;
        }

        const found = row.detail?.[kind];
        return {
            status,
            detail: found
                ? `${found} — reused, ${describeAge(row.checkedAt)}`
                : `reused from an earlier run, ${describeAge(row.checkedAt)}`
        };
    }

    return null;
}
