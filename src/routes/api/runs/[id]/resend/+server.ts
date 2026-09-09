import { json, error } from '@sveltejs/kit';
import { db } from '$lib/server/db';
import { Run } from '$lib/server/entities/run';
import { Verification } from '$lib/server/entities/verification';
import { CODE_MINUTES, issueCode } from '$lib/server/verification';
import type { RequestHandler } from './$types';

/**
 * Send another verification code for a run that is still waiting on one.
 *
 * Without this a run could be lost for good. A code lasts twenty minutes and
 * tolerates six wrong guesses; past either, /api/verify refuses, and the run
 * sits in 'awaiting_verification' — a status no worker will ever claim, and
 * one nothing else could move it out of. The only way on was to compose the
 * whole thing again, leaving the first row orphaned in the history list.
 *
 * A fresh code supersedes the old one by being newer: verification reads the
 * most recent record for the run, so nothing has to be deleted, and the
 * attempt counter starts over because this is a different code.
 */

/**
 * How long between codes.
 *
 * The address is the run's own and was already mailed once when the run was
 * composed, so this is not a route to somebody else's inbox — but a button
 * that sends mail on every click is still a button worth slowing down.
 */
const COOLDOWN_SECONDS = 60;

export const POST: RequestHandler = async ({ params }) => {
    await db();

    const run = await Run.findOneBy({ id: params.id });
    if (!run) {
        error(404, 'No such run');
    }
    if (run.status !== 'awaiting_verification') {
        // Already running, already finished, already verified: all of them mean
        // there is nothing to prove, which is good news rather than an error.
        error(409, 'This run is not waiting for a code');
    }
    if (!run.email) {
        // Unreachable through the form, which only asks for an address when it
        // can send to one — but a run with no address can never be verified,
        // and saying so beats mailing the empty string.
        error(409, 'This run has no address to send a code to');
    }

    const last = await Verification.findOne({
        where: { runId: run.id },
        order: { createdAt: 'DESC' }
    });
    if (last) {
        const since = (Date.now() - last.createdAt.getTime()) / 1000;
        if (since < COOLDOWN_SECONDS) {
            error(429, `Give it ${Math.ceil(COOLDOWN_SECONDS - since)} more seconds`);
        }
    }

    const { sent, reason } = await issueCode(run.id, run.email);
    // A send that failed is reported rather than thrown: the code exists either
    // way, and somebody who can read the server log can still use it.
    return json({ sent, problem: reason, minutes: CODE_MINUTES });
};
