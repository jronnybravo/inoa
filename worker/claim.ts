/**
 * Which runs a worker may take.
 *
 * Its own module so it can be tested: worker/index.ts calls main() at the top
 * level, so importing it to reach this would start a worker.
 */

import { LessThan } from 'typeorm';

/**
 * The where-clause, as a list of alternatives.
 *
 * `queued` is the whole gate. It used to be paired with `emailVerified: true`,
 * which meant no deployment without a Resend key ever ran anything: a run with
 * no address is created queued and unverified — there is no address to verify —
 * so every run on the default configuration sat in the queue while the worker
 * polled past it.
 *
 * Verification is what moves a run INTO this status, never something to test
 * again once it is here. /api/verify sets queued after a code is accepted, and
 * the mail-less branch of /api/runs sets queued because there is nothing to
 * prove. Reading the status is reading that answer; reading emailVerified as
 * well asked a question the status had already settled, and got it wrong.
 */
export function claimable(cutoff: Date): Record<string, unknown>[] {
    return [
        { status: 'queued' },
        // Or a worker took it and stopped renewing the lease.
        { status: 'generating', claimedAt: LessThan(cutoff) },
        { status: 'checking', claimedAt: LessThan(cutoff) }
    ];
}
