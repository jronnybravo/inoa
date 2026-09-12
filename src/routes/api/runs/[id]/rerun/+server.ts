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

/**
 * The most a single 'find more' may add.
 *
 * The same ceiling the compose form puts on a run, for the same reason: a
 * number typed into a box should not be able to queue a week of somebody's
 * rate limits by accident.
 */
const MOST_MORE = 2000;

export const POST: RequestHandler = async ({ params, request }) => {
    const { mode, more } = (await request.json().catch(() => ({}))) as {
        mode?: string;
        more?: unknown;
    };
    if (mode !== 'fresh' && mode !== 'continue') {
        error(400, "mode must be 'fresh' or 'continue'");
    }
    /*
     * How many more, if the caller said.
     *
     * Zero is meaningful and is why this is not a falsy check: resuming a run
     * that was stopped asks for nothing new, only for the rest of what it was
     * already asked for.
     */
    if (more !== undefined && (!Number.isInteger(more) || (more as number) < 0)) {
        error(400, 'more must be a whole number of names, or left out');
    }
    if (typeof more === 'number' && more > MOST_MORE) {
        error(400, `Ask for at most ${MOST_MORE} more at a time.`);
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
         * The same run, carried on.
         *
         * How many more is the caller's to say, because only they know whether
         * they want another fifty or another five. Left out it is the original
         * target again, which is what this did before there was a box to type
         * in and remains the sensible reading of 'find more'.
         *
         * Zero is the other half of this endpoint's job: a run that was stopped
         * has a target it never reached, and picking it up again asks for
         * nothing new at all.
         *
         * The worker tops up to whatever the target says and keeps what it
         * holds, so this is the entire change.
         */
        const added = typeof more === 'number' ? more : run.targetCount;
        const target = run.targetCount + added;
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
                added === 0
                    ? `Picking this up again — the target is still ${target}. ` +
                      'Everything already found is kept.'
                    : `Asked for ${added} more names — the target is now ${target}. ` +
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
