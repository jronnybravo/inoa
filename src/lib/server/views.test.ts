/**
 * What a row looks like by the time the browser sees it.
 *
 * Two endpoints answer with a run and its candidates, and both go through
 * here. The interesting part is what is deliberately left out: the address is
 * masked, and a run written under an older schema has to arrive looking like
 * one written today.
 *
 *   node --test --experimental-strip-types src/lib/server/views.test.ts
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { handleKind, tldKind } from '../types.ts';
import { candidateView, runView } from './views.ts';
import type { Candidate } from './entities/candidate.ts';
import type { Run } from './entities/run.ts';

const run = (over: Partial<Run> = {}): Run =>
    ({
        id: 'run-1',
        brief: 'A marketplace connecting local farms to restaurant kitchens.',
        strategies: ['compound'],
        languages: null,
        tlds: ['com'],
        requiredTlds: ['com'],
        handles: ['github'],
        requiredHandles: [],
        stores: ['appStore'],
        requiredStores: ['appStore'],
        webLinks: false,
        requireCom: false,
        requireAppStore: false,
        requirePlayStore: false,
        requireGoogle: false,
        email: 'someone@example.com',
        emailVerified: true,
        status: 'done',
        targetCount: 1000,
        generatedCount: 1000,
        checkedCount: 1000,
        error: null,
        claimedAt: null,
        notifiedAt: null,
        createdAt: new Date('2026-01-01T00:00:00Z'),
        finishedAt: null,
        ...over
    }) as Run;

const candidate = (over: Partial<Candidate> = {}): Candidate =>
    ({
        id: 'c-1',
        runId: 'run-1',
        name: 'Brivos',
        rationale: 'invented',
        strategy: 'invented',
        position: 0,
        domains: { com: 'clear' },
        handles: { github: 'taken' },
        com: 'pending',
        appStore: 'clear',
        playStore: 'pending',
        google: 'pending',
        detail: null,
        passed: null,
        droppedBy: null,
        checkedAt: null,
        ...over
    }) as Candidate;

describe('runView', () => {
    /*
     * Masked rather than dropped. Somebody arriving from the results email
     * should be able to tell it went where they meant it to, and the full
     * address on a page reachable by anyone holding the link is more than that
     * needs.
     */
    it('masks the address but leaves it recognisable', () => {
        const view = runView(run({ email: 'jronny@example.com' }));
        assert.equal(view.email, 'j•••@example.com');
        assert.ok(!view.email.includes('ronny'), 'the local part must not survive');
    });

    it('leaves no address at all when the run never had one', () => {
        assert.equal(runView(run({ email: null })).email, null);
    });

    it('never leaks the fields the browser has no business with', () => {
        const view = runView(run()) as unknown as Record<string, unknown>;
        for (const secret of ['emailVerified', 'claimedAt', 'notifiedAt']) {
            assert.equal(view[secret], undefined, `${secret} reached the client`);
        }
    });

    it('resolves the checks rather than making the client do it', () => {
        const view = runView(run());
        assert.deepEqual(view.checks.kinds, [tldKind('com'), handleKind('github'), 'appStore']);
        assert.deepEqual(view.checks.required, [tldKind('com'), 'appStore']);
    });

    it('reads a run written before any of this as one written today', () => {
        const old = run({
            tlds: null,
            requiredTlds: null,
            handles: null,
            requiredHandles: null,
            stores: null,
            requiredStores: null,
            requireCom: true,
            requireAppStore: true
        });
        const view = runView(old);
        assert.deepEqual(view.checks.kinds, [tldKind('com'), 'appStore', 'playStore', 'google']);
        assert.deepEqual(view.checks.required, [tldKind('com'), 'appStore']);
    });

    it('reports an empty language selection as any, not as none', () => {
        assert.deepEqual(runView(run({ languages: null })).languages, []);
        assert.deepEqual(runView(run({ languages: ['nordic'] })).languages, ['nordic']);
    });

    it('carries the link column flag, which is not a check', () => {
        assert.equal(runView(run({ webLinks: true })).webLinks, true);
        assert.ok(!runView(run({ webLinks: true })).checks.kinds.includes('google'));
    });
});

describe('candidateView', () => {
    it('keys every verdict the way the funnel keys them', () => {
        const view = candidateView(candidate());
        assert.equal(view.statuses[tldKind('com')], 'clear');
        assert.equal(view.statuses[handleKind('github')], 'taken');
        assert.equal(view.statuses.appStore, 'clear');
    });

    it('reads a row from before the domains were a choice', () => {
        const view = candidateView(candidate({ domains: null, handles: null, com: 'taken' }));
        assert.equal(view.statuses[tldKind('com')], 'taken');
    });

    it('keeps passed as null while a required check is still out', () => {
        assert.equal(candidateView(candidate({ passed: null })).passed, null);
        assert.equal(candidateView(candidate({ passed: false })).passed, false);
    });

    it('carries the reason a name was dropped, so a rejection can be explained', () => {
        const view = candidateView(
            candidate({ droppedBy: tldKind('com'), detail: { [tldKind('com')]: 'taken by X' } })
        );
        assert.equal(view.droppedBy, tldKind('com'));
        assert.equal(view.detail?.[tldKind('com')], 'taken by X');
    });

    it('does not send the client fields it never renders', () => {
        const view = candidateView(candidate()) as unknown as Record<string, unknown>;
        for (const internal of ['runId', 'position', 'checkedAt', 'com']) {
            assert.equal(view[internal], undefined, `${internal} reached the client`);
        }
    });
});
