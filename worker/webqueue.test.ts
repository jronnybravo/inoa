/**
 * The slow queue: pacing, backing off, and knowing when to stop.
 *
 * What this file tests is not whether a name is taken — that is the check's
 * job — but the behaviour around it that only exists because search engines
 * punish volume without warning. A queue that keeps calling a blocked engine
 * marks every remaining name 'unverified' in seconds: the run finishes fast,
 * tells you nothing, and the names LOOK checked. So the interesting cases are
 * all failure cases, and none of them can be provoked against a real engine.
 *
 * The intervals are set to nothing before the module is imported, because it
 * reads them once at load. A minute a name is the right pace against Google
 * and the wrong pace for a test.
 *
 *   node --test --experimental-strip-types worker/webqueue.test.ts
 */

import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, it } from 'node:test';
import type { CheckOutcome } from './checks/shared.ts';
import type { Requirements } from './pipeline.ts';
import type { Candidate } from '../src/lib/server/entities/candidate.ts';
import type { CheckKind, CheckStatus } from '../src/lib/types.ts';

process.env.INOA_WEB_INTERVAL_MS = '0';
process.env.INOA_WEB_BACKOFF_MS = '1';
const { drainWebQueue } = await import('./webqueue.ts');

/** Consecutive challenges the queue tolerates before abandoning the run. */
const MAX_BACKOFFS = 3;

const REQUIRED: Requirements = { com: true, appStore: true, playStore: true, google: true };

interface Row {
    id: string;
    name: string;
    position: number;
    runId: string;
    com: CheckStatus;
    appStore: CheckStatus;
    playStore: CheckStatus;
    google: CheckStatus;
    detail: Partial<Record<CheckKind, string>>;
    passed: boolean | null;
    checkedAt?: Date;
}

/**
 * The two entity methods the queue actually uses, over an array.
 *
 * `update` mutates in place, which is what makes the second query at the end
 * of a drain meaningful: a row the queue resolved is no longer pending, so
 * whatever is still pending is genuinely what it never reached.
 */
function store(names: string[]) {
    const rows: Row[] = names.map((name, index) => ({
        id: `id-${index}`,
        name,
        position: index,
        runId: 'run-1',
        com: 'clear',
        appStore: 'clear',
        playStore: 'clear',
        google: 'pending',
        detail: { com: 'the .com is free' },
        passed: null
    }));

    const candidates = {
        find: ({ where }: { where: { runId: string; google: CheckStatus } }) =>
            Promise.resolve(
                rows
                    .filter((row) => row.runId === where.runId && row.google === where.google)
                    .sort((a, b) => a.position - b.position)
            ),
        update: (id: string, patch: Partial<Row>) => {
            const row = rows.find((candidate) => candidate.id === id);
            if (row) {
                Object.assign(row, patch);
            }
            return Promise.resolve({});
        }
    } as unknown as typeof Candidate;

    return { rows, candidates };
}

/** The row at this position, asserted present so a test reads as a statement. */
function at(rows: Row[], index: number): Row {
    const found = rows[index];
    assert.ok(found, `expected a row at position ${index}`);
    return found;
}

const clear = (detail = 'No competing brand found'): CheckOutcome => ({
    status: 'clear',
    detail
});

/** What the browser tier reports when Google decides we look automated. */
const challenge = (): CheckOutcome => ({
    status: 'unknown',
    detail: 'Google challenged the request; not verified'
});

/** A checker driven from a list, so a name can answer differently each time. */
function answering(...outcomes: CheckOutcome[]) {
    const asked: string[] = [];
    const check = (name: string): Promise<CheckOutcome> => {
        asked.push(name);
        return Promise.resolve(outcomes[asked.length - 1] ?? outcomes.at(-1) ?? clear());
    };
    return { check, asked };
}

const KEYS = [
    'TAVILY_API_KEY',
    'FIRECRAWL_API_KEY',
    'SERPER_API_KEY',
    'EXA_API_KEY',
    'BRAVE_API_KEY'
];
const saved = new Map(KEYS.map((key) => [key, process.env[key]]));

beforeEach(() => {
    // No provider: the queue is in the browser tier, where backoff applies.
    for (const key of KEYS) {
        Reflect.deleteProperty(process.env, key);
    }
});

afterEach(() => {
    for (const [key, value] of saved) {
        if (value === undefined) {
            Reflect.deleteProperty(process.env, key);
        } else {
            process.env[key] = value;
        }
    }
});

describe('draining a queue that is answering', () => {
    it('checks every pending name in position order and records the verdict', async () => {
        const { rows, candidates } = store(['Alpha', 'Beta', 'Gamma']);
        const { check, asked } = answering(clear());

        const result = await drainWebQueue(candidates, 'run-1', REQUIRED, undefined, check);

        assert.deepEqual(asked, ['Alpha', 'Beta', 'Gamma']);
        assert.deepEqual(result, { resolved: 3, abandoned: 0 });
        assert.deepEqual(
            rows.map((row) => row.google),
            ['clear', 'clear', 'clear']
        );
    });

    it('passes a name whose every required check now says clear', async () => {
        const { rows, candidates } = store(['Alpha']);
        await drainWebQueue(candidates, 'run-1', REQUIRED, undefined, answering(clear()).check);

        assert.equal(at(rows, 0).passed, true);
        assert.ok(at(rows, 0).checkedAt instanceof Date);
    });

    it('adds the web detail without disturbing what other checks wrote', async () => {
        const { rows, candidates } = store(['Alpha']);
        const { check } = answering(clear('No competing brand found (Tavily)'));

        await drainWebQueue(candidates, 'run-1', REQUIRED, undefined, check);

        assert.deepEqual(at(rows, 0).detail, {
            com: 'the .com is free',
            google: 'No competing brand found (Tavily)'
        });
    });

    it('writes no web detail at all when the check offered none', async () => {
        const { rows, candidates } = store(['Alpha']);
        const { check } = answering({ status: 'clear' });

        await drainWebQueue(candidates, 'run-1', REQUIRED, undefined, check);

        assert.deepEqual(at(rows, 0).detail, { com: 'the .com is free' });
    });

    /*
     * An ordinary 'unknown' — a provider hiccup, a timeout — is recorded and
     * the queue moves on. It is not a pass, and it is not a reason to stop.
     */
    it('records an unknown that is not a challenge, and keeps going', async () => {
        const { rows, candidates } = store(['Alpha', 'Beta']);
        const { check, asked } = answering(
            { status: 'unknown', detail: 'provider timed out' },
            clear()
        );

        const result = await drainWebQueue(candidates, 'run-1', REQUIRED, undefined, check);

        assert.deepEqual(asked, ['Alpha', 'Beta']);
        assert.equal(at(rows, 0).google, 'unknown');
        assert.equal(at(rows, 0).passed, false, 'an unknown cannot pass a required check');
        assert.equal(at(rows, 1).google, 'clear');
        // `resolved` counts names the queue got through, an unknown among them.
        assert.equal(result.resolved, 2);
    });

    it('does nothing, and asks nothing, when no name is waiting', async () => {
        const { candidates } = store([]);
        const { check, asked } = answering(clear());

        const result = await drainWebQueue(candidates, 'run-1', REQUIRED, undefined, check);

        assert.deepEqual(asked, []);
        assert.deepEqual(result, { resolved: 0, abandoned: 0 });
    });
});

describe('backing off when the engine objects', () => {
    /*
     * The pause exists to let a block clear, so it has to retry the SAME name.
     * Advancing past it would spend the queue during the very window it is
     * waiting out — and the name it skipped would be abandoned unverified.
     */
    it('retries the same name rather than moving past it', async () => {
        const { rows, candidates } = store(['Alpha', 'Beta']);
        const { check, asked } = answering(challenge(), clear(), clear());
        const notes: string[] = [];

        const result = await drainWebQueue(
            candidates,
            'run-1',
            REQUIRED,
            (_done, _total, note) => {
                if (note) {
                    notes.push(note);
                }
            },
            check
        );

        assert.deepEqual(asked, ['Alpha', 'Alpha', 'Beta']);
        assert.match(notes[0] ?? '', /search blocked; pausing/);
        assert.equal(at(rows, 0).google, 'clear');
        assert.deepEqual(result, { resolved: 2, abandoned: 0 });
    });

    it('gives up out loud once the engine has refused too many times', async () => {
        const { candidates } = store(['Alpha', 'Beta', 'Gamma']);
        const { check, asked } = answering(challenge());
        const notes: string[] = [];

        const result = await drainWebQueue(
            candidates,
            'run-1',
            REQUIRED,
            (_done, _total, note) => {
                if (note) {
                    notes.push(note);
                }
            },
            check
        );

        // One try, then one per tolerated backoff, then it stops.
        assert.equal(asked.length, MAX_BACKOFFS + 1);
        assert.match(notes.at(-1) ?? '', /stopping web checks/);
        assert.equal(result.resolved, 0);
        assert.equal(result.abandoned, 3);
    });

    /*
     * Abandoned is not the same as unchecked. A name the queue never reached
     * must not sit at 'pending', which reads as "still coming" and would let a
     * name reach the results email having never been looked at.
     */
    it('marks everything it never reached as unverified, not pending', async () => {
        const { rows, candidates } = store(['Alpha', 'Beta']);
        await drainWebQueue(candidates, 'run-1', REQUIRED, undefined, answering(challenge()).check);

        for (const row of rows) {
            assert.equal(row.google, 'unknown');
            assert.equal(row.detail.google, 'Search was blocked; not verified');
            assert.equal(row.passed, false);
        }
    });

    it('forgives the earlier challenges once a name answers again', async () => {
        const { candidates } = store(['Alpha', 'Beta']);
        // Two challenges on Alpha, then three on Beta: without a reset the
        // fourth consecutive challenge would abandon the run.
        const { check, asked } = answering(
            challenge(),
            challenge(),
            clear(),
            challenge(),
            challenge(),
            challenge(),
            clear()
        );

        const result = await drainWebQueue(candidates, 'run-1', REQUIRED, undefined, check);

        assert.equal(asked.length, 7);
        assert.deepEqual(result, { resolved: 2, abandoned: 0 });
    });
});

/**
 * The regression that cost thirty minutes a time.
 *
 * A single Firecrawl timeout used to fall through to a Google that refuses this
 * network, come back 'challenged', and be read here as Google rate-limiting the
 * whole run: half an hour of sleep, three times over, then every remaining name
 * abandoned. With a provider configured the queue never drives a browser, so a
 * challenge arriving here is somebody else's failure wearing Google's name.
 */
describe('with a search provider configured', () => {
    beforeEach(() => {
        process.env.TAVILY_API_KEY = 'tvly-test';
    });

    /*
     * One name is enough to tell the two behaviours apart, and costs nothing:
     * in the browser tier this same name would have been retried four times
     * and then abandoned. It is a single name rather than several because the
     * API pace is a fixed second and a half between names, which a test should
     * not sit through to prove something a single name already shows.
     */
    it('never pauses or abandons the run over a challenge', async () => {
        const { rows, candidates } = store(['Alpha']);
        const { check, asked } = answering(challenge());
        const notes: string[] = [];

        const result = await drainWebQueue(
            candidates,
            'run-1',
            REQUIRED,
            (_done, _total, note) => {
                if (note) {
                    notes.push(note);
                }
            },
            check
        );

        assert.deepEqual(asked, ['Alpha'], 'asked once, not retried');
        assert.deepEqual(notes, [], 'no pause, no stopping');
        assert.deepEqual(result, { resolved: 1, abandoned: 0 });
        assert.equal(at(rows, 0).google, 'unknown');
    });
});
