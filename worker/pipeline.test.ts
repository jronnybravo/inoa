/**
 * The funnel: what runs, in what order, and what survives it.
 *
 * Two rules carry the whole design and neither is visible from a single check.
 * A REQUIRED check coming back 'taken' drops the name and the rest are marked
 * skipped, which is where the run's savings come from. And 'unknown' never
 * drops a name and never counts as a pass — promoting it to 'clear' is the bug
 * that let 500 names through unchecked in the tool this replaces.
 *
 * None of this touches the network. checkCandidate reaches for a real checker
 * only when no prior verdict is on record, so a script that answers for every
 * kind exercises the sequence without making a single call — which is what the
 * injected lookup is there for.
 *
 *   node --test --experimental-strip-types worker/pipeline.test.ts
 */

import assert from 'node:assert/strict';
import { afterEach, describe, it } from 'node:test';
import { CHECK_ORDER, type CheckKind, type CheckStatus } from '../src/lib/types.ts';
import {
    checkCandidate,
    checkOrder,
    computePassed,
    fastChecks,
    type PriorVerdict,
    type Requirements
} from './pipeline.ts';

const ALL: Requirements = { com: true, appStore: true, playStore: true, google: true };
const NONE: Requirements = { com: false, appStore: false, playStore: false, google: false };

const requiring = (...kinds: CheckKind[]): Requirements => ({
    ...NONE,
    ...Object.fromEntries(kinds.map((kind) => [kind, true]))
});

/**
 * Every check answered from a script, and a record of which were asked.
 *
 * An unlisted kind answers 'unknown' rather than falling through to the real
 * checker: a test that quietly made an HTTP request would be both slow and a
 * liar about what it proves.
 */
function scripted(script: Partial<Record<CheckKind, CheckStatus>>) {
    const asked: CheckKind[] = [];
    const prior: PriorVerdict = (name, kind) => {
        asked.push(kind);
        const status = script[kind] ?? 'unknown';
        return Promise.resolve({ status, detail: `${kind}: ${status}` });
    };
    return { prior, asked };
}

describe('computePassed', () => {
    it('passes only when every required check positively cleared', () => {
        assert.equal(computePassed({ com: 'clear', appStore: 'clear' }, requiring('com')), true);
        assert.equal(
            computePassed(
                { com: 'clear', appStore: 'clear', playStore: 'clear', google: 'clear' },
                ALL
            ),
            true
        );
    });

    it('ignores checks nobody required, however they came out', () => {
        const statuses = { com: 'clear', appStore: 'taken', playStore: 'unknown' } as const;
        assert.equal(computePassed(statuses, requiring('com')), true);
    });

    /*
     * The distinction the whole project turns on: 'unknown' is a failure to
     * find out, so it cannot pass. It is not null either — null means the
     * answer is still coming, and this one has arrived.
     */
    it('does not pass an unknown, which is not a finding of absence', () => {
        assert.equal(computePassed({ com: 'unknown' }, requiring('com')), false);
    });

    it('does not pass a required check that was skipped or taken', () => {
        assert.equal(computePassed({ com: 'skipped' }, requiring('com')), false);
        assert.equal(computePassed({ com: 'taken' }, requiring('com')), false);
    });

    /*
     * null, not false, while a required check is still out. This is what keeps
     * a name out of the results email until the slow web queue reaches it — a
     * premature false would read as a decided verdict.
     */
    it('withholds a verdict while a required check is pending', () => {
        assert.equal(
            computePassed({ com: 'clear', google: 'pending' }, requiring('com', 'google')),
            null
        );
    });

    it('treats a missing key as pending rather than as absent evidence', () => {
        assert.equal(computePassed({ com: 'clear' }, requiring('com', 'google')), null);
    });

    it('passes a name with no requirements at all, having nothing to fail', () => {
        assert.equal(computePassed({}, NONE), true);
    });
});

describe('checkOrder', () => {
    it('runs required checks first, each group in cost order', () => {
        assert.deepEqual(checkOrder(requiring('playStore')), [
            'playStore',
            'com',
            'appStore',
            'google'
        ]);
        assert.deepEqual(checkOrder(requiring('appStore', 'playStore')), [
            'appStore',
            'playStore',
            'com',
            'google'
        ]);
    });

    it('falls back to plain cost order when everything or nothing is required', () => {
        assert.deepEqual(checkOrder(ALL), CHECK_ORDER);
        assert.deepEqual(checkOrder(NONE), CHECK_ORDER);
    });

    it('names every check exactly once, whatever the requirements', () => {
        for (const required of [ALL, NONE, requiring('google'), requiring('com', 'google')]) {
            const order = checkOrder(required);
            assert.deepEqual([...order].sort(), [...CHECK_ORDER].sort());
        }
    });
});

describe('fastChecks', () => {
    const KEYS = [
        'TAVILY_API_KEY',
        'FIRECRAWL_API_KEY',
        'SERPER_API_KEY',
        'EXA_API_KEY',
        'BRAVE_API_KEY'
    ];
    const saved = new Map(KEYS.map((key) => [key, process.env[key]]));

    afterEach(() => {
        for (const [key, value] of saved) {
            if (value === undefined) {
                Reflect.deleteProperty(process.env, key);
            } else {
                process.env[key] = value;
            }
        }
    });

    const clear = (): void => {
        for (const key of KEYS) {
            Reflect.deleteProperty(process.env, key);
        }
    };

    /*
     * Where the web check runs is a cost decision, not a preference. With a key
     * it is about a second and joins the funnel; without one it needs a browser
     * at roughly a name a minute and is deferred to the queue, which is the
     * only tier that can notice a block and stand down.
     */
    it('leaves the web check out of the funnel when no provider is configured', () => {
        clear();
        assert.deepEqual(fastChecks(), ['com', 'appStore', 'playStore']);
    });

    it('runs every check inline once a provider can answer in seconds', () => {
        clear();
        process.env.TAVILY_API_KEY = 'tvly-test';
        assert.deepEqual(fastChecks(), CHECK_ORDER);
    });
});

describe('checkCandidate — a required collision stops the funnel', () => {
    it('drops the name and marks everything after it skipped', async () => {
        const { prior } = scripted({ com: 'taken' });
        const result = await checkCandidate('Keystone', ALL, CHECK_ORDER, prior);

        assert.equal(result.droppedBy, 'com');
        assert.equal(result.statuses.com, 'taken');
        assert.deepEqual(
            [result.statuses.appStore, result.statuses.playStore, result.statuses.google],
            ['skipped', 'skipped', 'skipped']
        );
        assert.equal(result.passed, false);
    });

    /*
     * The savings, stated as a fact rather than a hope: the checks after a drop
     * are not consulted at all. Apple tolerates about twenty calls a minute, so
     * a name that never reaches it is the cheapest kind of name.
     */
    it('never even asks the checks it skipped', async () => {
        const { prior, asked } = scripted({ com: 'taken' });
        await checkCandidate('Keystone', ALL, CHECK_ORDER, prior);
        assert.deepEqual(asked, ['com']);
    });

    it('keeps the detail of the check that did the dropping', async () => {
        const { prior } = scripted({ com: 'taken' });
        const result = await checkCandidate('Keystone', ALL, CHECK_ORDER, prior);
        assert.equal(result.detail.com, 'com: taken');
    });
});

describe('checkCandidate — a check nobody required', () => {
    it('records a collision without dropping the name', async () => {
        const { prior, asked } = scripted({ com: 'taken', appStore: 'clear' });
        const result = await checkCandidate('Keystone', requiring('appStore'), CHECK_ORDER, prior);

        assert.equal(result.droppedBy, null);
        assert.equal(result.statuses.com, 'taken');
        assert.equal(result.passed, true);
        // The funnel ran to the end, so the table is complete for a survivor.
        assert.deepEqual([...asked].sort(), [...CHECK_ORDER].sort());
    });
});

describe('checkCandidate — unknown is not a pass and not a drop', () => {
    it('carries on through the remaining checks', async () => {
        const { prior, asked } = scripted({
            com: 'clear',
            appStore: 'unknown',
            playStore: 'clear',
            google: 'clear'
        });
        const result = await checkCandidate('Keystone', ALL, CHECK_ORDER, prior);

        assert.equal(result.droppedBy, null);
        assert.equal(result.statuses.playStore, 'clear', 'the funnel kept going');
        assert.equal(asked.length, 4);
        assert.equal(result.passed, false, 'an unknown cannot pass a required check');
    });
});

describe('checkCandidate — the checks this pass owns', () => {
    it('leaves a check outside its remit pending rather than guessing', async () => {
        const { prior, asked } = scripted({ com: 'clear', appStore: 'clear', playStore: 'clear' });
        const result = await checkCandidate(
            'Keystone',
            ALL,
            ['com', 'appStore', 'playStore'],
            prior
        );

        assert.equal(result.statuses.google, 'pending');
        assert.ok(!asked.includes('google'));
        // Pending, so the verdict is still out rather than settled as a failure.
        assert.equal(result.passed, null);
    });

    /*
     * A deferred check stays pending even behind a drop. The web queue reads
     * 'pending' to find its work, and index.ts decides separately whether a
     * dropped name should read 'skipped' — this pass must not decide it here.
     */
    it('does not mark a deferred check skipped when an earlier gate drops', async () => {
        const { prior } = scripted({ com: 'taken' });
        const result = await checkCandidate('Keystone', ALL, ['com', 'appStore'], prior);

        assert.equal(result.statuses.appStore, 'skipped');
        assert.equal(result.statuses.google, 'pending');
    });

    it('asks the required check first, whatever order the kinds arrive in', async () => {
        const { prior, asked } = scripted({ playStore: 'clear' });
        await checkCandidate('Keystone', requiring('playStore'), CHECK_ORDER, prior);
        assert.equal(asked[0], 'playStore');
    });
});
