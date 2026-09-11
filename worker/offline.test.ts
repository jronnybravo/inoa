/**
 * Composing names without a model.
 *
 * The rules here are the whole product on a machine with no key, so they are
 * worth pinning: what counts as sayable, what counts as a blend, and that the
 * same brief twice produces the same names — which is the only property that
 * makes a bad name reproducible enough to fix.
 *
 * Nothing here reaches the network. The thesaurus is an improvement on the
 * bundled words, not a dependency of them, and every case below is written
 * against a palette handed in directly.
 *
 *   node --test --experimental-strip-types worker/offline.test.ts
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { STRATEGIES } from '../src/lib/types.ts';
import { blend, composeBatch, keywords, seedFor, type Palette } from './offline.ts';
import { ENDING, FOREIGN, NOT_A_NAME, pronounceable } from './words.ts';

/** No thesaurus, so the bundled lists carry it — the offline-offline case. */
const BARE: Palette = { related: [] };
const FARM: Palette = { related: ['orchard', 'harvest', 'pasture', 'cellar', 'grain'] };

/**
 * Every approach, derived rather than listed.
 *
 * Written out by hand this silently stopped covering 'respell' the moment it
 * was added — a test that enumerates what it tests will always lag the thing
 * it is testing.
 */
const APPROACHES = STRATEGIES.map((s) => s.id);

describe('keywords', () => {
    it('keeps what the brief is about', () => {
        const found = keywords('A marketplace connecting local farms to restaurant kitchens.');
        assert.ok(found.includes('farm'), 'plurals are reduced so farms and farm are one word');
        assert.ok(found.includes('restaurant'));
        assert.ok(found.includes('kitchen'));
    });

    /*
     * The words every brief has are the words every competitor already used.
     * A name built from 'platform' is not a name.
     */
    it('drops the words that describe every business equally', () => {
        const found = keywords('An online platform and digital service for teams and customers.');
        assert.deepEqual(found, []);
    });

    it('says each word once, however often the brief does', () => {
        const found = keywords('Coffee for coffee people who love coffee.');
        assert.deepEqual(found.filter((w) => w === 'coffee').length, 1);
    });
});

describe('blend', () => {
    it('joins on letters the two words already share', () => {
        assert.equal(blend('swift', 'thicket'), 'swifthicket');
        assert.equal(blend('grain', 'insight'), 'grainsight');
    });

    /* nova + orbit is a clean seam without a shared letter; nov + brit is not. */
    it('joins on a vowel seam when there is no overlap', () => {
        assert.equal(blend('nova', 'orbit'), 'novarbit');
    });

    it('refuses a join that would just be two words stuck together', () => {
        assert.equal(blend('iron', 'basalt'), null);
    });
});

describe('pronounceable', () => {
    it('accepts what a reader can say on sight', () => {
        for (const word of ['krian', 'lumora', 'deltaplain', 'brae']) {
            assert.ok(pronounceable(word), `${word} should be sayable`);
        }
    });

    /*
     * Both halves matter, and only one was there at first: the consonant rule
     * shipped, the vowel rule did not, and the assembler produced 'Quioeo' in
     * its first run.
     */
    it('rejects three vowels in a row', () => {
        assert.equal(pronounceable('quioeo'), false);
        assert.equal(pronounceable('reirziao'), false);
    });

    it('rejects a consonant run English does not use', () => {
        assert.equal(pronounceable('bktrn'), false);
        assert.ok(pronounceable('strand'), 'str is a cluster English does use');
    });

    it('rejects anything too short or too long to be a name', () => {
        assert.equal(pronounceable('ab'), false);
        assert.equal(pronounceable('residenthicketry'), false);
    });
});

describe('composeBatch', () => {
    it('fills a batch for every approach', () => {
        for (const strategy of APPROACHES) {
            const made = composeBatch(FARM, strategy, 12, [], seedFor('brief', 1));
            assert.equal(made.length, 12, `${strategy} should fill its batch`);
            assert.ok(
                made.every((n) => n.strategy === strategy),
                'each name records the approach that made it'
            );
        }
    });

    /*
     * The reason the PRNG is seeded rather than Math.random. A generator that
     * cannot be replayed cannot be debugged: 'it produced a bad name once' is
     * not a report anybody can act on.
     */
    it('produces the same names from the same seed', () => {
        const once = composeBatch(FARM, 'compound', 20, [], seedFor('a brief', 3));
        const twice = composeBatch(FARM, 'compound', 20, [], seedFor('a brief', 3));
        assert.deepEqual(once, twice);
    });

    it('produces different names as the seed advances with each batch', () => {
        const first = composeBatch(FARM, 'compound', 20, [], seedFor('a brief', 1));
        const second = composeBatch(FARM, 'compound', 20, [], seedFor('a brief', 2));
        assert.notDeepEqual(first, second);
    });

    it('never repeats a name it was told to avoid', () => {
        const first = composeBatch(FARM, 'compound', 20, [], seedFor('brief', 1));
        const avoid = first.map((n) => n.name);
        const second = composeBatch(FARM, 'compound', 20, avoid, seedFor('brief', 1));
        const clash = second.filter((n) => avoid.includes(n.name));
        assert.deepEqual(clash, []);
    });

    it('never repeats itself inside one batch', () => {
        const made = composeBatch(FARM, 'invented', 40, [], seedFor('brief', 9));
        assert.equal(new Set(made.map((n) => n.name)).size, made.length);
    });

    it('gives every name a rationale, since nothing else can explain one', () => {
        for (const strategy of APPROACHES) {
            const made = composeBatch(FARM, strategy, 6, [], seedFor('brief', 4));
            assert.ok(
                made.every((n) => n.rationale.length > 0),
                `${strategy} names should say how they were made`
            );
        }
    });

    it('only ever returns names a reader could say', () => {
        for (const strategy of APPROACHES) {
            const made = composeBatch(FARM, strategy, 30, [], seedFor('brief', 5));
            for (const n of made) {
                /*
                 * A respelling is judged on its source. Nobody stumbles over
                 * 'Flickr', though 'ckr' is a consonant run no rule would pass
                 * on its own - the word it came from is what makes it
                 * readable.
                 */
                assert.ok(
                    pronounceable(n.sayableAs ?? n.name),
                    `${n.name} (${strategy}) is not sayable`
                );
            }
        }
    });

    it('respells a word a reader already knows, and says which', () => {
        const made = composeBatch(FARM, 'respell', 20, [], seedFor('brief', 11));
        assert.ok(made.length > 0);
        for (const n of made) {
            const source = n.sayableAs;
            assert.ok(source, `${n.name} should record the word it came from`);
            assert.notEqual(n.name.toLowerCase(), source, 'a respelling has to differ');
            assert.ok(n.rationale.includes(source), 'the rationale names the source');
        }
    });

    it('never returns a word that is already something else', () => {
        const made = composeBatch(BARE, 'short', 60, [], seedFor('brief', 6));
        for (const n of made) {
            assert.ok(!NOT_A_NAME.has(n.name.toLowerCase()), `${n.name} is a fragment, not a name`);
        }
    });

    /*
     * A finite word list runs out, and saying so is the honest answer. The
     * caller reads a short batch as an exhausted brief and stops; an
     * unbounded loop would spin instead.
     */
    it('returns what it has rather than spinning when the words run out', () => {
        const made = composeBatch(BARE, 'foreign', 5000, [], seedFor('brief', 7));
        assert.ok(made.length > 0, 'it should find some');
        assert.ok(made.length < 5000, 'and admit when it cannot find that many');
    });

    it('works with no thesaurus at all, which is the case it exists for', () => {
        const made = composeBatch(BARE, 'compound', 15, [], seedFor('brief', 8));
        assert.equal(made.length, 15);
    });
});

/**
 * Which language a name is allowed to be in.
 *
 * 'Other languages' produced Awafield, Kaihouse and Cahayasmith — a foreign
 * root with an English word welded on, under the approach whose entire promise
 * is a name in another language. The model-written batches had the same fault
 * and returned HusayBoard from a run narrowed to Austronesian. The blend is a
 * fair name and now has an approach of its own; what it must not be is the
 * answer to a question nobody asked.
 */
describe('a name in another language is in that language', () => {
    const AUSTRONESIAN = ['Tagalog', 'Cebuano', 'Indonesian', 'Malay', 'Hawaiian', 'Māori'];
    const roots = (from: string[]) =>
        FOREIGN.filter((r) => from.includes(r.from)).map((r) => r.word.toLowerCase());

    it('builds a foreign name out of foreign words and nothing else', () => {
        const words = roots(AUSTRONESIAN);
        assert.ok(words.length > 0, 'the bundled list has Austronesian roots');

        const names = composeBatch(FARM, 'foreign', 40, [], 7, AUSTRONESIAN);
        assert.ok(names.length > 0, 'the approach produced something to check');

        for (const { name } of names) {
            const lower = name.toLowerCase();
            const english = ENDING.find((tail) => lower.endsWith(tail));
            assert.equal(english, undefined, `${name} ends in the English word "${english}"`);
            /*
             * Whatever is left after removing one root has to be another root
             * from the same list — which is what stops a second English word
             * getting in by some other door.
             */
            const first = words.find((w) => lower.startsWith(w));
            assert.ok(first, `${name} does not begin with a root from the chosen languages`);
            const rest = lower.slice(first.length);
            assert.ok(rest === '' || words.includes(rest), `${name} ends in "${rest}", not a root`);
        }
    });

    /*
     * And the blend, which is the same shape asked for on purpose: the
     * borrowed word carries the promise and the English one names the
     * category. Tokopedia, Gojek, PayMaya — never the other way round.
     */
    it('puts the borrowed word first and the English category second', () => {
        const words = roots(AUSTRONESIAN);
        const names = composeBatch(FARM, 'bilingual', 40, [], 7, AUSTRONESIAN);
        assert.ok(names.length > 0, 'the approach produced something to check');

        for (const { name } of names) {
            const lower = name.toLowerCase();
            const root = words.find((w) => lower.startsWith(w));
            assert.ok(root, `${name} does not open with a word from the chosen languages`);
            assert.ok(
                ENDING.includes(lower.slice(root.length)),
                `${name} does not close with an English category word`
            );
        }
    });

    it('asks for nothing at all where the languages have no words', () => {
        assert.deepEqual(composeBatch(FARM, 'bilingual', 10, [], 7, ['Klingon']), []);
        assert.deepEqual(composeBatch(FARM, 'foreign', 10, [], 7, ['Klingon']), []);
    });
});
