/**
 * Which source generates, and in what order.
 *
 * The selection is worth pinning because it decides what a run costs. The CLI
 * spends a subscription; the other two meter tokens against a card. Getting
 * the order wrong does not fail, it bills — which is exactly the kind of bug
 * that survives a manual test and shows up on a statement.
 *
 * Nothing here calls a model. Every case is about which source would be asked.
 *
 *   node --test --experimental-strip-types worker/generators.test.ts
 */

import assert from 'node:assert/strict';
import { afterEach, describe, it } from 'node:test';
import { ALL_GENERATORS, generators, hasGenerator } from './generators.ts';

const KEYS = ['ANTHROPIC_API_KEY', 'OPENAI_API_KEY', 'INOA_GENERATOR', 'PATH'];
const saved = new Map(KEYS.map((key) => [key, process.env[key]]));

/**
 * A PATH with no `claude` on it, so the CLI reads as unavailable.
 *
 * The check is a filesystem lookup rather than a spawn, so emptying PATH is
 * enough to simulate a machine without the CLI installed.
 */
function withoutCli(): void {
    process.env.PATH = '/nonexistent-for-this-test';
}

function only(configured: Record<string, string> = {}): void {
    for (const key of ['ANTHROPIC_API_KEY', 'OPENAI_API_KEY', 'INOA_GENERATOR']) {
        Reflect.deleteProperty(process.env, key);
    }
    for (const [key, value] of Object.entries(configured)) {
        process.env[key] = value;
    }
}

const labels = (): string[] => generators().map((g) => g.label);

afterEach(() => {
    for (const [key, value] of saved) {
        if (value === undefined) {
            Reflect.deleteProperty(process.env, key);
        } else {
            process.env[key] = value;
        }
    }
});

describe('what counts as configured', () => {
    it('offers nothing at all on a machine with no CLI and no keys', () => {
        only();
        withoutCli();
        assert.deepEqual(labels(), []);
        assert.equal(hasGenerator(), false);
    });

    it('offers the CLI on its own, with no key anywhere', () => {
        only();
        // The CLI is on PATH in this project's own environment.
        assert.deepEqual(labels(), ['claude-cli']);
        assert.equal(hasGenerator(), true);
    });

    for (const [key, label] of [
        ['ANTHROPIC_API_KEY', 'anthropic'],
        ['OPENAI_API_KEY', 'openai']
    ] as const) {
        it(`counts ${key} as a source, so a machine with no subscription can run`, () => {
            only({ [key]: 'test-key' });
            withoutCli();
            assert.deepEqual(labels(), [label]);
        });
    }

    it('treats an empty key as no key, so a blank line in .env is not a source', () => {
        only({ OPENAI_API_KEY: '' });
        withoutCli();
        assert.deepEqual(labels(), []);
    });

    it('reads keys at call time, so configuration is not frozen at import', () => {
        only();
        withoutCli();
        assert.equal(hasGenerator(), false);
        process.env.OPENAI_API_KEY = 'sk-test';
        assert.equal(hasGenerator(), true);
    });
});

describe('the order they are tried in', () => {
    /*
     * The CLI first, always, unless told otherwise. It is the only source that
     * cannot produce a bill, so anything that quietly reordered this would be
     * spending money that did not need spending.
     */
    it('prefers the CLI over both paid APIs', () => {
        only({ ANTHROPIC_API_KEY: 'a', OPENAI_API_KEY: 'b' });
        assert.deepEqual(labels(), ['claude-cli', 'anthropic', 'openai']);
    });

    it('falls to the APIs in a fixed order when the CLI is missing', () => {
        only({ OPENAI_API_KEY: 'b', ANTHROPIC_API_KEY: 'a' });
        withoutCli();
        assert.deepEqual(labels(), ['anthropic', 'openai']);
    });
});

describe('INOA_GENERATOR', () => {
    it('overrides the order outright', () => {
        only({ INOA_GENERATOR: 'openai,claude-cli', OPENAI_API_KEY: 'b' });
        assert.deepEqual(labels(), ['openai', 'claude-cli']);
    });

    it('narrows to one source, so a subscription can be left alone', () => {
        only({ INOA_GENERATOR: 'anthropic', ANTHROPIC_API_KEY: 'a' });
        assert.deepEqual(labels(), ['anthropic']);
    });

    it('is case and whitespace insensitive, since it is typed into a .env', () => {
        only({ INOA_GENERATOR: '  OPENAI , claude-cli ', OPENAI_API_KEY: 'b' });
        assert.deepEqual(labels(), ['openai', 'claude-cli']);
    });

    /*
     * A typo should cost you that source, not the run. Naming a source with
     * no key still drops it: asking for something unusable is not a reason to
     * pretend it is available.
     */
    it('ignores a name it does not know', () => {
        only({ INOA_GENERATOR: 'gemini,claude-cli' });
        assert.deepEqual(labels(), ['claude-cli']);
    });

    it('still drops a named source that has no key behind it', () => {
        only({ INOA_GENERATOR: 'openai' });
        withoutCli();
        assert.deepEqual(labels(), []);
    });

    it('falls back to the default order when set to nothing', () => {
        only({ INOA_GENERATOR: '   ', ANTHROPIC_API_KEY: 'a' });
        assert.deepEqual(labels(), ['claude-cli', 'anthropic']);
    });
});

describe('the source list itself', () => {
    it('names every source exactly once', () => {
        const names = ALL_GENERATORS.map((g) => g.label);
        assert.deepEqual([...new Set(names)], names);
    });

    it('describes each source completely enough to use', () => {
        for (const generator of ALL_GENERATORS) {
            assert.ok(generator.label, 'a source needs a name to be selected by');
            assert.equal(typeof generator.available, 'function');
            assert.equal(typeof generator.complete, 'function');
        }
    });
});
