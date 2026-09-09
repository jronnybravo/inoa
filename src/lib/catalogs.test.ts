/**
 * The three lists the form is built from.
 *
 * Domains, platforms and languages are generated or hand-written data, and
 * data is where a silent failure hides: a duplicate id shadows an entry, an
 * unsorted list makes 'most used first' a lie, and a language whose name is
 * spelled one way here and another way in the word list narrows the offline
 * generator down to nothing without anybody noticing.
 *
 * That last one is the reason this file exists.
 *
 *   node --test --experimental-strip-types src/lib/catalogs.test.ts
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { FOREIGN } from '../../worker/words.ts';
import { asHandle, DEFAULT_PLATFORMS, isPlatform, platform, PLATFORMS } from './handles.ts';
import { isLanguage, language, LANGUAGE_GROUPS, LANGUAGES, languagesCovered } from './languages.ts';
import { ALL_TLDS, isTld } from './tlds.ts';

const ids = (list: readonly { id: string }[]): string[] => list.map((x) => x.id);

const isSorted = (values: number[]): boolean =>
    values.every((v, i) => i === 0 || (values[i - 1] as number) >= v);

describe('the domain list', () => {
    it('names every TLD exactly once', () => {
        const names = ALL_TLDS.map((t) => t.tld);
        assert.equal(new Set(names).size, names.length);
    });

    it('is ordered most used first', () => {
        // Popularity is not stored, but the generator sorts by it, so the
        // well-known ones must lead. .com beating .net beating a long tail is
        // the property the ordering exists to give.
        const order = ALL_TLDS.map((t) => t.tld);
        assert.equal(order[0], 'com');
        assert.ok(order.indexOf('net') < order.indexOf('xyz'));
        assert.ok(order.indexOf('io') < order.indexOf('lol'));
    });

    it('prices every entry, because the price is what proves it is buyable', () => {
        for (const entry of ALL_TLDS) {
            assert.ok(entry.usd > 0, `.${entry.tld} has no price`);
            assert.ok(Number.isFinite(entry.usd), `.${entry.tld} has a price that is not a number`);
        }
    });

    it('holds no TLD that cannot be registered', () => {
        // Spot checks from the three categories the generator filters out:
        // credentials-only, never-issued, and reserved.
        for (const excluded of ['aero', 'museum', 'coop', 'bv', 'sj', 'gov', 'mil', 'arpa']) {
            assert.equal(isTld(excluded), false, `.${excluded} should not be offered`);
        }
    });

    it('recognises what it holds and nothing else', () => {
        assert.equal(isTld('com'), true);
        assert.equal(isTld('COM'), false, 'ids are lowercase, and the caller normalises');
        assert.equal(isTld('notatld'), false);
    });

    it('labels an internationalised domain with the script somebody would type', () => {
        const idn = ALL_TLDS.filter((t) => t.tld.startsWith('xn--'));
        assert.ok(idn.length > 0, 'the list should carry some');
        for (const entry of idn) {
            assert.ok(entry.label, `${entry.tld} has no readable form`);
        }
    });
});

describe('the platform list', () => {
    it('names every platform exactly once', () => {
        assert.equal(new Set(ids(PLATFORMS)).size, PLATFORMS.length);
    });

    it('is ordered most used first', () => {
        assert.ok(isSorted(PLATFORMS.map((p) => p.users)));
        assert.equal(PLATFORMS[0]?.id, 'facebook');
    });

    it('gives every platform somewhere to look for yourself', () => {
        for (const p of PLATFORMS) {
            const url = p.url('brivos');
            assert.match(url, /^https:\/\//, `${p.label} has no profile URL`);
            assert.ok(url.includes('brivos'), `${p.label} does not put the handle in its URL`);
        }
    });

    /* Defaults derived from the sorted list, not written in an order of their
     * own - which is what they were, reading Instagram, Facebook, TikTok. */
    it('defaults to real platforms, in the list order', () => {
        assert.ok(DEFAULT_PLATFORMS.length > 0);
        for (const id of DEFAULT_PLATFORMS) {
            assert.ok(isPlatform(id), `${id} is a default but not a platform`);
        }
        const positions = DEFAULT_PLATFORMS.map((id) => ids(PLATFORMS).indexOf(id));
        assert.deepEqual(
            [...positions].sort((a, b) => a - b),
            positions
        );
    });

    it('squashes a name the way a handle is actually written', () => {
        assert.equal(asHandle('Farm Well'), 'farmwell');
        assert.equal(asHandle('Bri-vos 2'), 'brivos2');
        assert.equal(asHandle('  Kizuna  '), 'kizuna');
    });

    it('looks up by id, and says nothing for one it does not have', () => {
        assert.equal(platform('github')?.label, 'GitHub');
        assert.equal(platform('myspace'), undefined);
    });
});

describe('the language list', () => {
    it('names every choice exactly once', () => {
        assert.equal(new Set(ids(LANGUAGES)).size, LANGUAGES.length);
    });

    it('is ordered most spoken first', () => {
        assert.ok(isSorted(LANGUAGES.map((l) => l.speakers)));
    });

    it('gives every choice something to cover', () => {
        for (const l of LANGUAGES) {
            assert.ok(l.covers.length > 0, `${l.label} covers nothing`);
        }
    });

    it('has every family cover more than one language, or it is not a family', () => {
        for (const l of LANGUAGES.filter((x) => x.group)) {
            assert.ok(l.covers.length > 1, `${l.label} is marked a family but covers one language`);
        }
    });

    it('expands a selection to the languages it stands for', () => {
        assert.deepEqual(languagesCovered(['japanese']), ['Japanese']);
        const nordic = languagesCovered(['nordic']);
        assert.ok(nordic.includes('Old Norse') && nordic.includes('Swedish'));
    });

    it('merges overlapping selections rather than repeating them', () => {
        const both = languagesCovered(['latin', 'classical']);
        assert.equal(both.filter((n) => n === 'Latin').length, 1);
    });

    /* Empty means any, and callers read an empty list as 'no constraint'. It
     * must not come back as 'no languages', which would generate nothing. */
    it('expands nothing to nothing, which callers read as any', () => {
        assert.deepEqual(languagesCovered([]), []);
        assert.deepEqual(languagesCovered(['nonsense']), []);
    });

    it('recognises what it holds and nothing else', () => {
        assert.equal(isLanguage('nordic'), true);
        assert.equal(isLanguage('klingon'), false);
        assert.equal(language('nordic')?.group, true);
    });
});

/*
 * The form offers families and nothing else, which is only honest if the
 * families reach everywhere the old list did.
 *
 * Turkish was the counter-example that made this file necessary: a single
 * language in no family at all. Offered on its own that was invisible; the
 * moment the families became the whole list it was a language, and a set of
 * word-list roots, that nothing could ask for.
 */
describe('the families cover everything the list can name', () => {
    const covered = new Set(LANGUAGE_GROUPS.flatMap((g) => g.covers));

    it('offers families only', () => {
        for (const l of LANGUAGE_GROUPS) {
            assert.equal(l.group, true, `${l.label} is offered but is not a family`);
        }
    });

    it('leaves no single language outside a family', () => {
        for (const l of LANGUAGES.filter((x) => !x.group)) {
            const orphans = l.covers.filter((name) => !covered.has(name));
            assert.deepEqual(orphans, [], `${l.label} is in no family, so nothing can select it`);
        }
    });

    /*
     * Said against the word list directly rather than through the entries, so
     * a root stays reachable even if the single language it belongs to is one
     * day removed from the catalogue entirely.
     */
    it('leaves no word-list root a family cannot reach', () => {
        for (const from of new Set(FOREIGN.map((r) => r.from))) {
            assert.ok(covered.has(from), `${from} roots exist but no family covers ${from}`);
        }
    });

    it('still resolves an id from before the families were the whole list', () => {
        assert.deepEqual(languagesCovered(['japanese']), ['Japanese']);
        assert.equal(isLanguage('turkish'), true);
    });
});

describe('the languages and the word list agree', () => {
    const known = new Set(FOREIGN.map((r) => r.from));

    /*
     * The failure this whole file was written for.
     *
     * The offline generator filters its roots by these exact strings. Spell a
     * language one way here and another way in words.ts and the filter matches
     * nothing - the batch comes back empty and the only symptom is a short
     * run, with no error anywhere.
     */
    it('has a root for every single language the word list claims to cover', () => {
        for (const name of known) {
            const reachable = LANGUAGES.some((l) => l.covers.includes(name));
            assert.ok(reachable, `words.ts has ${name} roots that no selection can reach`);
        }
    });

    it('leaves every family able to find at least one root', () => {
        for (const l of LANGUAGES.filter((x) => x.group)) {
            const hit = l.covers.some((name) => known.has(name));
            assert.ok(hit, `${l.label} covers nothing the word list has a root for`);
        }
    });

    it('glosses every root, since a name you cannot translate you cannot explain', () => {
        for (const root of FOREIGN) {
            assert.ok(root.gloss.length > 0, `${root.word} has no meaning recorded`);
            assert.ok(root.from.length > 0, `${root.word} has no language recorded`);
        }
    });
});
