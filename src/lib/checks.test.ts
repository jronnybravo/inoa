/**
 * Reading a run's checks off the row, whichever schema wrote it.
 *
 * Two shapes reach this code. A run from before the domains were a choice has
 * a requireCom boolean and a single .com verdict in its own column; a run from
 * today has two lists and a JSON object. Everything downstream — the funnel,
 * the table, the results email — is built on the assumption that it never has
 * to tell them apart, and this is the file that has to earn that.
 *
 *   node --test --experimental-strip-types src/lib/checks.test.ts
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { candidateStatuses, runChecks, statusColumns } from './checks.ts';
import { checkLabel, checkSearch, statusOf, tldKind, tldOf } from './types.ts';
import type { CandidateChecksRow, RunChecksRow } from './checks.ts';

const legacyRun = (over: Partial<RunChecksRow> = {}): RunChecksRow => ({
    tlds: null,
    requiredTlds: null,
    requireCom: true,
    requireAppStore: true,
    requirePlayStore: false,
    requireGoogle: false,
    ...over
});

const modernRun = (tlds: string[], requiredTlds: string[]): RunChecksRow =>
    legacyRun({ tlds, requiredTlds, requireCom: false });

const legacyRow = (over: Partial<CandidateChecksRow> = {}): CandidateChecksRow => ({
    domains: null,
    com: 'taken',
    appStore: 'clear',
    playStore: 'clear',
    google: 'unknown',
    ...over
});

describe('the namespace on a domain check', () => {
    /*
     * The reason TLD kinds are prefixed at all. '.google' and '.app' are both
     * real domains anybody can buy, and 'google' and 'appStore' are already
     * checks — so a bare TLD as a key would have made a run asking about the
     * .google domain silently address the web check instead.
     */
    it('keeps a TLD apart from a check that shares its name', () => {
        assert.notEqual(tldKind('google'), 'google');
        assert.equal(tldOf(tldKind('google')), 'google');
        assert.equal(tldOf('google'), null);
        assert.equal(checkLabel(tldKind('google')), '.google');
        assert.equal(checkLabel('google'), 'Web');
    });

    it('points each domain check at its own hostname', () => {
        assert.equal(checkSearch(tldKind('io'), 'Brivos'), 'https://brivos.io');
        assert.equal(checkSearch(tldKind('com'), 'Bri-vos 2'), 'https://brivos2.com');
    });
});

describe('runChecks — a run written before the domains were a choice', () => {
    it('reads requireCom as a run that checks the .com and nothing else', () => {
        const { kinds, required } = runChecks(legacyRun());
        assert.deepEqual(kinds, [tldKind('com'), 'appStore', 'playStore', 'google']);
        assert.deepEqual(required, [tldKind('com'), 'appStore']);
    });

    it('still checks the .com when it was not required, because the column exists', () => {
        const { kinds, required } = runChecks(legacyRun({ requireCom: false }));
        assert.ok(kinds.includes(tldKind('com')));
        assert.deepEqual(required, ['appStore']);
    });
});

describe('runChecks — a run that chose its domains', () => {
    it('puts every chosen domain in the funnel ahead of the stores', () => {
        const { kinds } = runChecks(modernRun(['com', 'io', 'ai'], ['com']));
        assert.deepEqual(kinds, [
            tldKind('com'),
            tldKind('io'),
            tldKind('ai'),
            'appStore',
            'playStore',
            'google'
        ]);
    });

    /*
     * Domains lead because they are the only checks with no shared limiter
     * behind them. Anything they drop is a name Apple is never asked about,
     * which is where a run's time is actually saved.
     */
    it('requires only what was asked for, and reports the rest', () => {
        const { required } = runChecks(modernRun(['com', 'io', 'ai'], ['com', 'ai']));
        assert.deepEqual(required, [tldKind('com'), tldKind('ai'), 'appStore']);
    });

    /*
     * A requirement on a domain nobody looks at can never come back clear, so
     * every name in the run would fail for a reason no column could show. The
     * API rejects it; this makes sure a row that got one anyway cannot.
     */
    it('drops a requirement on a domain that is not being checked', () => {
        const { required } = runChecks(modernRun(['com'], ['com', 'io']));
        assert.deepEqual(required, [tldKind('com'), 'appStore']);
    });

    it('accepts a run that checks no domain at all', () => {
        const { kinds, required } = runChecks(modernRun([], []));
        assert.deepEqual(kinds, ['appStore', 'playStore', 'google']);
        assert.deepEqual(required, ['appStore']);
    });
});

describe('candidateStatuses', () => {
    it('reads an old row through its .com column', () => {
        const statuses = candidateStatuses(legacyRow());
        assert.equal(statuses[tldKind('com')], 'taken');
        assert.equal(statuses.google, 'unknown');
    });

    it('reads a new row through its domains, one key per TLD', () => {
        const statuses = candidateStatuses(
            legacyRow({ domains: { com: 'clear', io: 'taken' }, com: 'pending' })
        );
        assert.equal(statuses[tldKind('com')], 'clear');
        assert.equal(statuses[tldKind('io')], 'taken');
    });

    /*
     * The old column is not consulted once `domains` exists. It is left in the
     * schema to read rows nobody will write again, and a run that deliberately
     * declines to check the .com must not inherit a stale verdict from it.
     */
    it('ignores the legacy column once a row has domains of its own', () => {
        const statuses = candidateStatuses(legacyRow({ domains: { io: 'clear' }, com: 'taken' }));
        assert.equal(statusOf(statuses, tldKind('com')), 'pending');
    });

    it('answers pending for a check the row has no verdict for', () => {
        assert.equal(statusOf(candidateStatuses(legacyRow()), tldKind('xyz')), 'pending');
    });
});

describe('statusColumns', () => {
    it('splits the domains into JSON and leaves the stores as columns', () => {
        const columns = statusColumns({
            [tldKind('com')]: 'clear',
            [tldKind('io')]: 'taken',
            appStore: 'clear',
            playStore: 'skipped',
            google: 'unknown'
        });
        assert.deepEqual(columns.domains, { com: 'clear', io: 'taken' });
        assert.equal(columns.appStore, 'clear');
        assert.equal(columns.google, 'unknown');
    });

    it('writes pending for a store nothing has answered for', () => {
        const columns = statusColumns({ [tldKind('com')]: 'clear' });
        assert.deepEqual(columns.domains, { com: 'clear' });
        assert.equal(columns.playStore, 'pending');
    });

    /** What comes out is what goes back in, or a verdict is lost on every write. */
    it('round-trips through a candidate row', () => {
        const before = {
            [tldKind('com')]: 'clear' as const,
            [tldKind('io')]: 'unknown' as const,
            appStore: 'taken' as const,
            playStore: 'pending' as const,
            google: 'clear' as const
        };
        const row = { ...statusColumns(before), com: 'pending' as const };
        assert.deepEqual(candidateStatuses(row), before);
    });
});
