import { json, error } from '@sveltejs/kit';
import { candidateStatuses, runChecks, statusColumns } from '$lib/checks';
import { db } from '$lib/server/db';
import { Candidate } from '$lib/server/entities/candidate';
import { Run } from '$lib/server/entities/run';
import { statusOf, type CheckKind, type CheckStatuses } from '$lib/types';
import { checkCandidate, checkOrder, computePassed } from '../../../../../../worker/pipeline.ts';
import type { RequestHandler } from './$types';

/**
 * Re-run the checks for one name, on demand.
 *
 * Unlike a run, this is small enough to do inline: one request per check the
 * run makes, and usually fewer. It exists because a verdict is a reading of somebody else's
 * search results at one moment — listings appear, domains lapse, a rate limit
 * turns a real answer into 'unverified' — and the person looking at the row is
 * the one who knows it is worth asking again.
 *
 * With no body it runs whatever the run requires. Pass a kind to run one.
 */
export const POST: RequestHandler = async ({ params, request }) => {
    await db();
    const candidate = await Candidate.findOneBy({ id: params.id });
    if (!candidate) {
        error(404, 'No such candidate');
    }

    const run = await Run.findOneBy({ id: candidate.runId });
    if (!run) {
        error(404, 'No such run');
    }

    const body = (await request.json().catch(() => ({}))) as { kind?: CheckKind };
    const { kinds: all, required } = runChecks(run);

    /*
     * A named kind is honoured even if this run never asked for it — the row
     * on screen has a column for it, and 'recheck this cell' should mean this
     * cell. A run with no requirements at all would otherwise check nothing,
     * so it falls back to everything it looks at.
     */
    const kinds: CheckKind[] = body.kind
        ? [body.kind]
        : required.length > 0
          ? checkOrder(all, required).filter((k) => required.includes(k))
          : all;

    const result = await checkCandidate(candidate.name, required, kinds, undefined, all);

    /*
     * Only the checks that ran are overwritten; the rest keep their verdicts.
     * A check this pass did not make comes back as 'pending', which is not a
     * verdict and must not replace one.
     */
    const existing = candidateStatuses(candidate);
    const merged: CheckStatuses = { ...existing };
    for (const kind of kinds) {
        const ran = statusOf(result.statuses, kind);
        if (ran !== 'pending') {
            merged[kind] = ran;
        }
    }

    const detail = { ...candidate.detail, ...result.detail };
    const passed = computePassed(merged, required);

    await Candidate.update(candidate.id, {
        ...statusColumns(merged),
        detail,
        passed,
        droppedBy: result.droppedBy ?? candidate.droppedBy,
        checkedAt: new Date()
    });

    return json({ id: candidate.id, statuses: merged, detail, passed, ran: kinds });
};
