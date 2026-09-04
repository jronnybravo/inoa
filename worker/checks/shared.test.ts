/**
 * The comparison every 'taken' verdict rests on.
 *
 * The App Store, Play Store and web checks all gather titles and then hand
 * them here, and each of them turns an empty match list straight into 'clear'.
 * So this function alone decides both answers: too eager and it invents
 * collisions, too shy and it issues a positive claim of absence over a listing
 * that is sitting right there. Nothing about it is checked by a network call,
 * which is what makes it worth pinning exactly.
 *
 * The thresholds came from name-checker, tuned against real store results.
 * These tests record what they currently do, and — for the short names, where
 * a squashed comparison cannot tell a brand from a fragment — what they refuse
 * to do and why.
 *
 *   node --test --experimental-strip-types worker/checks/*.test.ts
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { isBrandCollision, jitter, similarity, squash, words } from './shared.ts';

describe('squash', () => {
    it('reduces a name to the letters and digits that identify it', () => {
        assert.equal(squash('  Warm-Grove™ 42 '), 'warmgrove42');
    });

    it('makes case and punctuation invisible, so they cannot hide a collision', () => {
        assert.equal(squash('NOTION!'), squash('notion'));
        assert.equal(squash('Key.Stone'), squash('keystone'));
    });

    it('leaves nothing behind for a string with no letters or digits', () => {
        assert.equal(squash('—/—'), '');
    });
});

describe('similarity', () => {
    /*
     * A known distance, checked against the textbook pair: kitten → sitting is
     * three edits over seven characters. It is here because everything below
     * is a threshold on this number, and a threshold means nothing if the
     * measurement underneath it has drifted.
     */
    it('is one minus the edit distance over the longer string', () => {
        assert.equal(similarity('kitten', 'sitting').toFixed(4), '0.5714');
        assert.equal(similarity('abc', 'abd').toFixed(4), '0.6667');
    });

    it('is 1 for identical strings and for two empty ones', () => {
        assert.equal(similarity('lumora', 'lumora'), 1);
        assert.equal(similarity('', ''), 1);
    });

    it('is 0 when nothing is shared', () => {
        assert.equal(similarity('abc', 'xyz'), 0);
    });
});

describe('isBrandCollision — what counts as the same brand', () => {
    it('matches an exact name through case and punctuation', () => {
        assert.equal(isBrandCollision('Notion', 'Notion'), true);
        assert.equal(isBrandCollision('notion', 'NOTION!'), true);
        assert.equal(isBrandCollision('Key Stone', 'keystone'), true);
    });

    // Someone shipped our brand with something bolted on either end.
    for (const listing of ['Keystone Pro', 'Pro Keystone', 'KeystoneHQ', 'Keystone: Field Notes']) {
        it(`matches "${listing}", which is our name with decoration`, () => {
            assert.equal(isBrandCollision('Keystone', listing), true);
        });
    }

    /*
     * The other direction: our name is an existing brand plus a letter. This
     * is the typo-squat case, and it is a collision even though the listing is
     * shorter than the candidate.
     */
    it('matches when our name is an existing brand with a letter added', () => {
        assert.equal(isBrandCollision('Spotifyy', 'Spotify'), true);
    });

    /*
     * Without the containment floor, 'BoardTarget' collided with apps called
     * literally 'Board' and 'Target' — a common word inside a compound is not
     * somebody else's brand. The floor is a ratio, so it scales with the name.
     */
    for (const listing of ['Board', 'Target']) {
        it(`does not match "${listing}" merely for sitting inside BoardTarget`, () => {
            assert.equal(isBrandCollision('BoardTarget', listing), false);
        });
    }

    it('matches a near-miss spelling of a long name', () => {
        // One edit in ten characters, which clears the 0.88 similarity bar.
        assert.equal(isBrandCollision('Brightloom', 'Brightlooq'), true);
    });

    it('does not match a merely similar-sounding name', () => {
        assert.equal(isBrandCollision('Lumora', 'Aurora'), false);
        assert.equal(isBrandCollision('Notion', 'Nothing'), false);
    });

    it('never matches an empty title, which is a parse failure, not a brand', () => {
        assert.equal(isBrandCollision('Keystone', ''), false);
        assert.equal(isBrandCollision('', 'Keystone'), false);
        // A title of pure punctuation squashes to nothing and must not match.
        assert.equal(isBrandCollision('Keystone', '——'), false);
    });
});

/**
 * Short names, and the boundary that makes them safe.
 *
 * The rules below the word test work on the squashed string, where a short
 * name cannot be told from a fragment of a longer word: 'vida' sits inside
 * 'avida' exactly as it sits inside 'vidahealth', and 'loom' inside
 * 'heirloom' exactly as inside 'loomvideo'. Lowering those rules to four
 * characters would match all four. So a short name is matched on a word
 * boundary instead, which admits the two brands and refuses the two
 * fragments.
 *
 * The direction of the risk is deliberate. A missed collision ships a name
 * that is already taken; a spurious one drops a single candidate out of
 * hundreds. Only the first of those is expensive.
 */
describe('isBrandCollision — short names match on a word boundary', () => {
    for (const [name, listing] of [
        ['Vida', 'Vida Health'],
        ['Vida', 'VidaHealth'],
        ['Vida', 'VIDA HEALTH'],
        ['Vida', 'Vida — Fitness & Coaching'],
        ['Vida', 'Pro Vida'],
        ['Acme', 'Acme Inc'],
        ['Loom', 'Loom | Video Messaging']
    ] as const) {
        it(`matches "${listing}", where ${name} is one of the words`, () => {
            assert.equal(isBrandCollision(name, listing), true);
        });
    }

    /*
     * The fragments. Each of these contains our name as a letter-string and
     * none of them is trading under it — which is precisely what a squashed
     * prefix or suffix test at four characters would get wrong.
     */
    for (const [name, listing] of [
        ['Vida', 'Avida'],
        ['Loom', 'Heirloom'],
        ['Lumo', 'Volumo'],
        ['Zeta', 'Zetamax'],
        ['Slack', 'Slackers']
    ] as const) {
        it(`does not match "${listing}", which merely contains ${name}`, () => {
            assert.equal(isBrandCollision(name, listing), false);
        });
    }

    it('does not match a listing shorter than the name itself', () => {
        assert.equal(isBrandCollision('Vida', 'Vid'), false);
    });

    /*
     * Under four characters a word match means nothing: 'go' and 'one' are
     * words in titles that hold no collision at all. Those names are left with
     * an exact match, which is all that can be trusted.
     */
    it('does not trust a word match below four characters', () => {
        assert.equal(isBrandCollision('Go', 'Go Running Club'), false);
        assert.equal(isBrandCollision('Go', 'GO'), true, 'an exact match still counts');
    });

    /*
     * The same rule closes a gap for long names. A squashed prefix or suffix
     * test only sees a brand at the ends of a title, so 'The Keystone App'
     * used to pass as unrelated.
     */
    it('also catches a long name sitting in the middle of a title', () => {
        assert.equal(isBrandCollision('Keystone', 'The Keystone App'), true);
        assert.equal(isBrandCollision('Lumora', 'Introducing Lumora, finally'), true);
    });
});

describe('words', () => {
    it('splits on punctuation, spacing and camelCase alike', () => {
        assert.deepEqual(words('Vida Health'), ['vida', 'health']);
        assert.deepEqual(words('VidaHealth'), ['vida', 'health']);
        assert.deepEqual(words('Loom | Video-Messaging'), ['loom', 'video', 'messaging']);
    });

    it('keeps digits, which are part of a name rather than a separator', () => {
        assert.deepEqual(words('Studio 54'), ['studio', '54']);
    });

    it('has nothing to say about a title with no letters or digits', () => {
        assert.deepEqual(words('— / —'), []);
    });
});

describe('jitter', () => {
    /*
     * Pacing is what keeps this project inside other people's rate limits, so
     * the property that matters is the range: never shorter than the interval
     * asked for, never more than 60% over it.
     */
    it('never returns less than the interval, and never more than 1.6x', () => {
        for (const base of [0, 1, 400, 60_000]) {
            for (let i = 0; i < 200; i++) {
                const value = jitter(base);
                assert.ok(value >= base, `${value} < ${base}`);
                assert.ok(value <= base * 1.6, `${value} > ${base * 1.6}`);
            }
        }
    });

    it('leaves a zero interval at zero, so "no pacing" means none', () => {
        assert.equal(jitter(0), 0);
    });
});
