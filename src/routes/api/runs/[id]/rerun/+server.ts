import { json, error } from '@sveltejs/kit';
import { db } from '$lib/server/db';
import { RunEvent } from '$lib/server/entities/event';
import { Run } from '$lib/server/entities/run';
import { TERMINAL_STATUSES } from '$lib/types';
import type { RequestHandler } from './$types';

/**
 * Run these settings again — either from nothing, or from where this got to.
 *
 * Two answers to one question, because 'again' means both things. A brief that
 * produced nothing usable wants a clean sheet; one that produced four good
 * names wants a fifth, and starting over would throw those four away along
 * with every check already paid for.
 *
 * The third answer — change something first — is not here. That is the compose
 * form with `?from=`, because editing settings is what the form is.
 */

/** The settings a rerun carries over. Everything else is a fact about the attempt. */
const SETTINGS = [
    'brief',
    'strategies',
    'languages',
    'tlds',
    'requiredTlds',
    'handles',
    'requiredHandles',
    'stores',
    'requiredStores',
    'webLinks',
    'targetCount',
    'requireCom',
    'requireAppStore',
    'requirePlayStore',
    'requireGoogle',
    'email',
    'emailVerified'
] as const;

export const POST: RequestHandler = async ({ params, request }) => {
    const { mode } = (await request.json().catch(() => ({}))) as { mode?: string };
    if (mode !== 'fresh' && mode !== 'continue') {
        error(400, "mode must be 'fresh' or 'continue'");
    }

    await db();
    const run = await Run.findOneBy({ id: params.id });
    if (!run) {
        error(404, 'No such run');
    }
    if (!TERMINAL_STATUSES.includes(run.status)) {
        // Nothing to rerun while it is still going. Two workers on one run
        // would both claim it and write over each other.
        error(409, 'This run has not finished yet');
    }

    if (mode === 'continue') {
        /*
         * The same run, asked for as many again.
         *
         * The increment is the original target rather than a number picked
         * here, because 'the same settings again' is the whole request — and
         * a run that asked for fifty is a person who thinks in fifties.
         *
         * The worker tops up to whatever the target says and keeps what it
         * holds, so this is the entire change.
         */
        const target = run.targetCount * 2;
        await Run.update(run.id, {
            targetCount: target,
            status: 'queued',
            finishedAt: null,
            error: null,
            claimedAt: null
        });
        await RunEvent.insert({
            runId: run.id,
            level: 'info',
            message:
                `Asked for more names — the target is now ${target}. ` +
                'Everything already found is kept, and the new names will avoid it.'
        });
        return json({ id: run.id, mode, targetCount: target });
    }

    const copy = Object.fromEntries(SETTINGS.map((key) => [key, run[key]])) as Partial<Run>;
    const fresh = await Run.create({
        ...copy,
        /*
         * Verified addresses stay verified.
         *
         * The address on this run proved itself to send these results, and
         * asking for a code again to send the next ones is a chore that
         * protects nothing — the same reasoning /api/runs already applies to
         * an address that has consumed a code before.
         */
        status:
            run.emailVerified || !run.email
                ? ('queued' as const)
                : ('awaiting_verification' as const)
    }).save();

    return json({ id: fresh.id, mode });
};
