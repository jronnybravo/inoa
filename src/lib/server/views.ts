/**
 * Rows as the client sees them.
 *
 * Two endpoints answer with a run and its candidates — the page's own load and
 * the poll it runs afterwards — and they used to build that shape twice. That
 * was survivable while a candidate was four fixed columns; it stopped being so
 * once reading one meant knowing which schema it was written under.
 */

import { candidateStatuses, runChecks } from '../checks.ts';
import type { StrategyId, CandidateView, RunView } from '../types.ts';
import type { Candidate } from './entities/candidate.ts';
import type { Run } from './entities/run.ts';

export function candidateView(c: Candidate): CandidateView {
    return {
        id: c.id,
        name: c.name,
        rationale: c.rationale,
        strategy: c.strategy as StrategyId | null,
        statuses: candidateStatuses(c),
        detail: c.detail,
        passed: c.passed,
        droppedBy: c.droppedBy
    };
}

/**
 * The run, with the address obscured.
 *
 * Masked rather than dropped: somebody arriving from the results email should
 * be able to tell it went where they meant it to, and the full address on a
 * page reachable by anyone holding the link is more than that needs. Null
 * where the deployment has no mail configured and never asked for one.
 */
export function runView(run: Run): RunView {
    return {
        id: run.id,
        brief: run.brief,
        strategies: run.strategies,
        languages: run.languages ?? [],
        checks: runChecks(run),
        webLinks: run.webLinks,
        email: run.email ? run.email.replace(/(.).*(@.*)/, '$1•••$2') : null,
        status: run.status,
        targetCount: run.targetCount,
        generatedCount: run.generatedCount,
        checkedCount: run.checkedCount,
        error: run.error
    };
}
