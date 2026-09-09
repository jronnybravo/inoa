/**
 * Adding names to a run that already has some.
 *
 * 'Find more' is the same run asked for as many again, which means generation
 * has to do two things it never had to before: produce only the shortfall, and
 * treat a name found an hour ago exactly as firmly as one found a second ago.
 *
 * Getting the second one wrong is invisible in the small — a duplicate looks
 * like an ordinary name — and expensive in the large, because every repeat is
 * a model call and a round of checks spent re-answering a question this run
 * already answered.
 *
 * Nothing here reaches the network or a model. INOA_AI is off for the whole
 * file so the deterministic composer answers, and the thesaurus is stubbed to
 * silence — which is also the case where a repeat is most likely, because the
 * same brief then composes from the same bundled word lists every time.
 *
 *   node --test --experimental-strip-types worker/topup.test.ts
 */

import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { generateNames } from './generate.ts';

const BRIEF = 'A marketplace connecting local farms to restaurant kitchens in coastal towns.';

/** Ask for `want` names, avoiding `held`. */
const compose = (want: number, held: string[] = []) =>
    generateNames(BRIEF, ['compound', 'invented'], want, [], undefined, undefined, held);

const names = (batch: { name: string }[]) => batch.map((n) => n.name);

let savedAi: string | undefined;
const realFetch = globalThis.fetch;

before(() => {
    savedAi = process.env.INOA_AI;
    process.env.INOA_AI = 'off';
    // The thesaurus is an improvement on the bundled lists, not a dependency of
    // them. Answering nothing is what a machine with no network gets, and it is
    // the only way this file composes the same names twice.
    globalThis.fetch = () => Promise.resolve(new Response('[]', { status: 200 }));
});

after(() => {
    globalThis.fetch = realFetch;
    if (savedAi === undefined) {
        Reflect.deleteProperty(process.env, 'INOA_AI');
    } else {
        process.env.INOA_AI = savedAi;
    }
});

describe('generating more for a run that already has names', () => {
    it('asks for the shortfall, not the new target', async () => {
        const more = await compose(12, ['Alpha', 'Beta']);
        assert.ok(more.length > 0, 'produced nothing at all');
        assert.ok(more.length <= 12, `asked for 12, got ${more.length}`);
    });

    /*
     * The failure this exists to catch would not look like one. Composing is
     * deterministic, so a second pass over the same brief returns much of the
     * first pass again — at full price, and indistinguishable from new names
     * until somebody notices the table has two of everything.
     */
    it('covers the same ground twice when nothing is held back', async () => {
        const first = await compose(16);
        const second = await compose(16);
        const shared = names(second).filter((n) => names(first).includes(n));
        assert.ok(
            shared.length > 0,
            'the composer no longer repeats itself, so the next test proves nothing'
        );
    });

    it('never returns a name the run already holds', async () => {
        const first = await compose(16);
        assert.ok(first.length > 0, 'the first pass produced nothing to top up');

        const held = names(first);
        const more = await compose(16, held);

        const lower = new Set(held.map((n) => n.toLowerCase()));
        const repeats = names(more).filter((n) => lower.has(n.toLowerCase()));
        assert.deepEqual(repeats, [], `repeated ${repeats.length} name(s) the run already had`);
    });

    /* An empty list is the ordinary case, and must behave as it always did. */
    it('is unchanged for a run starting from nothing', async () => {
        assert.deepEqual(names(await compose(10, [])), names(await compose(10)));
    });
});
