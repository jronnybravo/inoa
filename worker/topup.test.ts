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
import { exclusions, generateNames, promptFor } from './generate.ts';

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

/**
 * Which names a request is told not to repeat.
 *
 * The list is a thrift, not a correctness measure — `absorb` is what actually
 * guarantees no duplicate is kept. But a request that is not told about a name
 * will happily propose it, and every one it proposes is a name paid for and
 * thrown away on arrival, so what gets left out matters.
 */
describe('the exclusion list a request carries', () => {
    const many = (n: number, prefix = 'Name'): string[] =>
        Array.from({ length: n }, (_, i) => `${prefix}${i.toString().padStart(4, '0')}`);

    it('sends the lot when the lot fits', () => {
        const all = many(50);
        const listed = exclusions(all);
        assert.equal(listed.complete, true);
        assert.deepEqual(listed.names, all);
    });

    it('says so when it cannot', () => {
        const listed = exclusions(many(4000));
        assert.equal(listed.complete, false);
        assert.ok(listed.names.length < 4000);
    });

    it('spends the budget it is given and no more', () => {
        const listed = exclusions(many(4000), 1_000);
        const width = listed.names.join(', ').length;
        assert.ok(width <= 1_000, `used ${width} characters of a 1,000 budget`);
        assert.ok(width > 800, `used only ${width} of 1,000 — the budget is going to waste`);
    });

    /*
     * The bug this replaced. `slice(-400)` kept the newest, and on a run being
     * topped up the run's own names are seeded into the set first — so the
     * names the model had never been told about were the first to be dropped.
     */
    it('keeps a share of the oldest names, not only the newest', () => {
        const held = many(3000, 'Held');
        const listed = exclusions(held, 2_000);

        const first = held.slice(0, 500);
        const last = held.slice(-500);
        const kept = new Set(listed.names);

        assert.ok(
            first.some((n) => kept.has(n)),
            'nothing from the start of the list survived, which is what slice(-400) did'
        );
        assert.ok(
            last.some((n) => kept.has(n)),
            'nothing from the end of the list survived'
        );
    });

    it('holds no opinion about an empty list', () => {
        assert.deepEqual(exclusions([]), { names: [], complete: true });
    });
});

describe('what the request says about the names it must not repeat', () => {
    const many = (n: number): string[] =>
        Array.from({ length: n }, (_, i) => `Name${i.toString().padStart(4, '0')}`);

    it('names them plainly when it can name them all', () => {
        const prompt = promptFor(BRIEF, 'compound', 20, ['Brivos', 'Lumora']);
        assert.match(prompt, /Do not repeat any of these already-generated names: Brivos, Lumora/);
    });

    /*
     * A partial list offered as a complete one is a small lie with a cost: it
     * invites the model to treat everything unlisted as fair game, which is
     * the opposite of what a truncated list means.
     */
    it('admits when the list is a sample, and of how many', () => {
        const prompt = promptFor(BRIEF, 'compound', 20, many(4000));
        assert.match(prompt, /these \d+ of the 4000 already-generated names/);
    });

    it('says nothing at all when there is nothing to avoid', () => {
        assert.doesNotMatch(promptFor(BRIEF, 'compound', 20, []), /Do not repeat/);
    });
});
