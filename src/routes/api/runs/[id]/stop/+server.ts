import { json, error } from '@sveltejs/kit';
import { db } from '$lib/server/db';
import { RunEvent } from '$lib/server/entities/event';
import { Run } from '$lib/server/entities/run';
import { TERMINAL_STATUSES } from '$lib/types';
import type { RequestHandler } from './$types';

/**
 * Ask a run to stop.
 *
 * The app cannot reach the worker - they are on different machines, which is
 * the whole shape of this project - so stopping is a fact written to the row
 * rather than a message sent to a process. The worker reads it on its next
 * heartbeat and lets go of this run.
 *
 * This stops one run and nothing else. The worker itself stays up and goes
 * back to polling, so anything queued behind this run starts as normal; the
 * only way to stop the process is Ctrl-C in the terminal running it.
 *
 * That indirection is also what makes this work when no worker is running at
 * all. A run whose worker died sits in 'generating' with an expired lease,
 * and the next worker to start would otherwise claim it and begin again;
 * marking it stopped takes it out of the pool for good.
 *
 * Names already found are kept. They cost real calls against real rate limits
 * and they are the reason anybody would open a stopped run.
 */
export const POST: RequestHandler = async ({ params }) => {
    await db();

    const run = await Run.findOneBy({ id: params.id });
    if (!run) {
        error(404, 'No such run');
    }

    // Stopping something already finished is a no-op worth naming, not a
    // failure - two clicks on a slow connection should not read as an error.
    if (TERMINAL_STATUSES.includes(run.status)) {
        return json({ status: run.status, alreadyFinished: true });
    }

    await Run.update(run.id, { status: 'stopped', finishedAt: new Date() });
    await RunEvent.insert({
        runId: run.id,
        level: 'warn',
        message:
            'Stop requested. The worker finishes the name in hand, keeps everything ' +
            'found so far, and moves on to the next run.'
    });

    return json({ status: 'stopped', alreadyFinished: false });
};
