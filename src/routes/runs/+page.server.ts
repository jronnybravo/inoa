import { runChecks } from '$lib/checks';
import { db } from '$lib/server/db';
import { Candidate } from '$lib/server/entities/candidate';
import { Run } from '$lib/server/entities/run';
import { OWN_SOURCE } from '$lib/types';
import type { PageServerLoad } from './$types';

/** Enough to scroll, few enough that the page stays one query. */
const LIMIT = 200;

/**
 * Every run this database knows, newest first.
 *
 * A run's id was the only handle on it: an hour of work reachable through one
 * link in one email, and gone the moment that link was. This is the list that
 * link was standing in for.
 *
 * Everything is visible to everyone, which is the same rule the run pages
 * already follow — anybody holding a link can open one. There is no account to
 * scope a list to, and pretending otherwise would be a privacy claim this
 * project cannot keep.
 */
export const load: PageServerLoad = async () => {
    try {
        const source = await db();

        const runs = await Run.find({ order: { createdAt: 'DESC' }, take: LIMIT });
        if (runs.length === 0) {
            return { runs: [] };
        }

        /*
         * One grouped query rather than one per run.
         *
         * A hundred runs is a hundred round trips done the obvious way, and
         * this page exists to be opened often.
         */
        const tallies = await source
            .getRepository(Candidate)
            .createQueryBuilder('c')
            .select('c.runId', 'runId')
            .addSelect('COUNT(*)', 'total')
            .addSelect('COUNT(CASE WHEN c.passed THEN 1 END)', 'passed')
            /*
             * Counted apart, because targetCount does not govern them.
             *
             * That field asks how many names to GENERATE, and a card that
             * counted the ones somebody typed in themselves against it read
             * '54 of 50 names' — a run that had done exactly what it was asked
             * looking like it had overshot.
             */
            .addSelect(`COUNT(CASE WHEN c.source = :own THEN 1 END)`, 'brought')
            .setParameter('own', OWN_SOURCE)
            .where('c.runId IN (:...ids)', { ids: runs.map((r) => r.id) })
            .groupBy('c.runId')
            .getRawMany<{ runId: string; total: string; passed: string; brought: string }>();

        const byRun = new Map(tallies.map((t) => [t.runId, t]));

        return {
            runs: runs.map((run) => {
                const tally = byRun.get(run.id);
                const { required } = runChecks(run);
                return {
                    id: run.id,
                    brief: run.brief,
                    status: run.status,
                    strategies: run.strategies,
                    requiredCount: required.length,
                    targetCount: run.targetCount,
                    generatedCount: run.generatedCount,
                    names: Number(tally?.total ?? 0) - Number(tally?.brought ?? 0),
                    brought: Number(tally?.brought ?? 0),
                    passed: Number(tally?.passed ?? 0),
                    createdAt: run.createdAt.toISOString(),
                    finishedAt: run.finishedAt ? run.finishedAt.toISOString() : null
                };
            })
        };
    } catch {
        // A missing DATABASE_URL should show an empty list, not a 500 — the
        // same choice the compose page makes for the same reason.
        return { runs: [] };
    }
};
