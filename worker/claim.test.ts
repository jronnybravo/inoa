/**
 * Which runs a worker is willing to take.
 *
 * This existed as three lines inside the poll loop and was wrong for the whole
 * of the default configuration: every clause required emailVerified, and a run
 * with no address is created queued and unverified — there is no address to
 * verify. So on any deployment without a Resend key the worker polled past
 * every run it was supposed to do, forever, and the app looked like it simply
 * did nothing.
 *
 *   node --test --experimental-strip-types worker/claim.test.ts
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { claimable } from './claim.ts';

const CUTOFF = new Date('2026-01-01T00:00:00Z');

describe('the runs a worker may take', () => {
    const clauses = claimable(CUTOFF);

    /*
     * The failure, stated directly. Verification is what moves a run INTO
     * 'queued'; asking about it again here is asking a question the status has
     * already answered, and getting a different answer.
     */
    it('never asks whether an address was verified', () => {
        for (const clause of clauses) {
            assert.ok(
                !('emailVerified' in clause),
                `a clause still filters on emailVerified: ${JSON.stringify(Object.keys(clause))}`
            );
        }
    });

    it('takes anything queued', () => {
        assert.ok(
            clauses.some((c) => c.status === 'queued' && Object.keys(c).length === 1),
            'nothing matches a plain queued run'
        );
    });

    /* A worker that died mid-run leaves the row in one of these two. */
    for (const status of ['generating', 'checking']) {
        it(`takes back a ${status} run whose lease has lapsed`, () => {
            const clause = clauses.find((c) => c.status === status);
            assert.ok(clause, `nothing reclaims a ${status} run`);
            assert.ok(clause.claimedAt, `${status} is reclaimed without checking the lease`);
        });
    }

    /* Everything else is either finished or waiting on a person. */
    it('leaves the terminal and waiting states alone', () => {
        const taken = clauses.map((c) => c.status);
        for (const status of ['done', 'failed', 'stopped', 'awaiting_verification']) {
            assert.ok(!taken.includes(status), `a worker would claim a ${status} run`);
        }
    });
});
