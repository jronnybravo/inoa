import { json, error } from '@sveltejs/kit';
import { db } from '$lib/server/db';
import { Candidate } from '$lib/server/entities/candidate';
import { Run } from '$lib/server/entities/run';
import { CHECK_ORDER, type CheckKind, type CheckStatus } from '$lib/types';
import { checkCandidate, checkOrder, computePassed } from '../../../../../../worker/pipeline.ts';
import type { RequestHandler } from './$types';

/**
 * Re-run the checks for one name, on demand.
 *
 * Unlike a run, this is small enough to do inline: four requests at most, and
 * usually fewer. It exists because a verdict is a reading of somebody else's
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
    const required = {
        com: run.requireCom,
        appStore: run.requireAppStore,
        playStore: run.requirePlayStore,
        google: run.requireGoogle
    };

    // A run with no requirements would otherwise check nothing at all.
    // Same priority as a run: required checks first, cost order within.
    const settingsKinds = checkOrder(required).filter((k) => required[k]);
    const kinds: CheckKind[] = body.kind
        ? [body.kind]
        : settingsKinds.length > 0
          ? settingsKinds
          : CHECK_ORDER;

    const result = await checkCandidate(candidate.name, required, kinds);

    /*
     * Only the checks that ran are overwritten; the rest keep their verdicts.
     * A check this pass did not make comes back as 'pending', which is not a
     * verdict and must not replace one.
     */
    const kept = (ran: CheckStatus, existing: CheckStatus) => (ran === 'pending' ? existing : ran);

    const merged = {
        com: kept(result.statuses.com, candidate.com),
        appStore: kept(result.statuses.appStore, candidate.appStore),
        playStore: kept(result.statuses.playStore, candidate.playStore),
        google: kept(result.statuses.google, candidate.google)
    };

    await Candidate.update(candidate.id, {
        ...merged,
        detail: { ...candidate.detail, ...result.detail },
        passed: computePassed(merged, required),
        droppedBy: result.droppedBy ?? candidate.droppedBy,
        checkedAt: new Date()
    });

    return json({
        id: candidate.id,
        ...merged,
        detail: { ...candidate.detail, ...result.detail },
        passed: computePassed(merged, required),
        ran: kinds
    });
};
