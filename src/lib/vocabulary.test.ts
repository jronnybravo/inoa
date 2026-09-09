/**
 * The words the app and the worker share.
 *
 * Every check in this project is addressed by a string, and three families of
 * them live in one namespace: 'appStore', 'tld:com', 'at:github'. The prefixes
 * are load-bearing — '.app' and '.google' are real domains, 'google' is
 * already the web check — so the encoding is worth pinning rather than
 * trusting.
 *
 *   node --test --experimental-strip-types src/lib/vocabulary.test.ts
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { STATUS_TONE, STATUS_WORD } from './status.ts';
import {
    checkLabel,
    checkSearch,
    handleKind,
    isTldKind,
    platformOf,
    statusOf,
    STORE_ORDER,
    STRATEGIES,
    TERMINAL_STATUSES,
    tldKind,
    tldOf,
    type RunStatus
} from './types.ts';

const ALL_STATUSES: RunStatus[] = [
    'awaiting_verification',
    'queued',
    'generating',
    'checking',
    'done',
    'failed',
    'stopped'
];

describe('the three families of check', () => {
    /*
     * The collision the prefixes exist to prevent. '.google' and '.app' are
     * both registrable domains, and 'google' and 'appStore' are both checks;
     * without a namespace a run asking about the .google domain would address
     * the web check instead.
     */
    it('keeps a domain, a handle and a store apart even when they share a word', () => {
        assert.notEqual(tldKind('google'), 'google');
        assert.notEqual(handleKind('github'), tldKind('github'));
        assert.equal(tldOf(tldKind('app')), 'app');
        assert.equal(tldOf('appStore'), null);
        assert.equal(platformOf(handleKind('x')), 'x');
        assert.equal(platformOf(tldKind('x')), null);
    });

    it('recognises a domain check by its shape', () => {
        assert.equal(isTldKind(tldKind('io')), true);
        assert.equal(isTldKind('google'), false);
        assert.equal(isTldKind(handleKind('github')), false);
    });

    it('round-trips every kind through its own accessor', () => {
        for (const tld of ['com', 'io', 'xn--fiqs8s']) {
            assert.equal(tldOf(tldKind(tld)), tld);
        }
        for (const id of ['github', 'x', 'bluesky']) {
            assert.equal(platformOf(handleKind(id)), id);
        }
    });
});

describe('what a check is called', () => {
    it('labels a domain with its dot and a handle with its at', () => {
        assert.equal(checkLabel(tldKind('com')), '.com');
        assert.equal(checkLabel(handleKind('github')), '@GitHub');
        assert.equal(checkLabel(handleKind('x')), '@X');
    });

    it('labels the stores for what they establish, not for who answers', () => {
        assert.equal(checkLabel('appStore'), 'App Store');
        assert.equal(checkLabel('playStore'), 'Play Store');
        // 'google' is historical: the check asks a search API first and only
        // reaches a browser against Google when nothing else can answer.
        assert.equal(checkLabel('google'), 'Web');
    });

    it('falls back to the platform id for one it has no name for', () => {
        assert.equal(checkLabel(handleKind('myspace')), '@myspace');
    });

    it('gives every store a label', () => {
        for (const kind of STORE_ORDER) {
            assert.ok(checkLabel(kind).length > 0);
        }
    });
});

describe('where to look for yourself', () => {
    it('points a domain check at the domain itself', () => {
        assert.equal(checkSearch(tldKind('io'), 'Brivos'), 'https://brivos.io');
    });

    it('points a handle check at the profile', () => {
        assert.equal(checkSearch(handleKind('github'), 'Brivos'), 'https://github.com/brivos');
        assert.equal(
            checkSearch(handleKind('youtube'), 'Brivos'),
            'https://www.youtube.com/@brivos'
        );
    });

    it('squashes the name the same way every check does', () => {
        assert.equal(checkSearch(tldKind('com'), 'Farm Well!'), 'https://farmwell.com');
        assert.equal(checkSearch(handleKind('x'), 'Farm Well!'), 'https://x.com/farmwell');
    });

    it('sends the web check somewhere a person can actually read', () => {
        const url = checkSearch('google', 'Brivos');
        assert.match(url, /^https:\/\/www\.google\.com\/search\?q=/);
        assert.ok(url.includes('Brivos') || url.includes(encodeURIComponent('"Brivos"')));
    });

    it('gives every store somewhere to go', () => {
        for (const kind of STORE_ORDER) {
            assert.match(checkSearch(kind, 'Brivos'), /^https:\/\//);
        }
    });
});

describe('statusOf', () => {
    /*
     * One place decides what an absent key means. The map used to be total, so
     * no caller had to; it cannot be total now that the keys depend on the
     * run, and this is the guarantee that replaced it.
     */
    it('answers pending for a check nobody has made', () => {
        assert.equal(statusOf({}, tldKind('com')), 'pending');
        assert.equal(statusOf(null, 'appStore'), 'pending');
    });

    it('answers what is recorded when something is', () => {
        assert.equal(statusOf({ [tldKind('com')]: 'taken' }, tldKind('com')), 'taken');
        assert.equal(statusOf({ appStore: 'clear' }, 'appStore'), 'clear');
    });
});

describe('run status', () => {
    it('has a word and a colour for every status, so none renders as an enum', () => {
        for (const status of ALL_STATUSES) {
            assert.ok(STATUS_WORD[status], `${status} has no word`);
            assert.ok(STATUS_TONE[status], `${status} has no colour`);
            assert.ok(
                !STATUS_WORD[status].includes('_'),
                `${status} shows its raw enum to somebody`
            );
        }
    });

    /* A stopped run kept what it found, so it is not failed; the checks it was
     * asked for never finished, so it is not done either. */
    it('treats stopped as terminal but distinct from done and failed', () => {
        assert.ok(TERMINAL_STATUSES.includes('stopped'));
        assert.notEqual(STATUS_WORD.stopped, STATUS_WORD.done);
        assert.notEqual(STATUS_TONE.stopped, STATUS_TONE.failed);
    });

    it('leaves the statuses a worker can still pick up out of the terminal list', () => {
        for (const live of ['queued', 'generating', 'checking'] satisfies RunStatus[]) {
            assert.ok(!TERMINAL_STATUSES.includes(live), `${live} should still be claimable`);
        }
    });
});

describe('the naming strategies', () => {
    it('names every approach exactly once', () => {
        const ids = STRATEGIES.map((s) => s.id);
        assert.equal(new Set(ids).size, ids.length);
    });

    it('gives every approach a label and an example, since the card shows both', () => {
        for (const s of STRATEGIES) {
            assert.ok(s.label.length > 0, `${s.id} has no label`);
            assert.ok(s.hint.length > 0, `${s.id} has no examples`);
        }
    });
});
