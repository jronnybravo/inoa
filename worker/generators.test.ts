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
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, it } from 'node:test';
import { ALL_GENERATORS, aiAllowed, generators, hasGenerator, rotation } from './generators.ts';

const KEYS = ['ANTHROPIC_API_KEY', 'OPENAI_API_KEY', 'INOA_GENERATOR', 'INOA_AI', 'PATH'];
const saved = new Map(KEYS.map((key) => [key, process.env[key]]));

/**
 * A PATH holding exactly the CLIs a case is about.
 *
 * These tests used to read the real PATH and assume it had `claude` on it and
 * nothing else. That held until a machine with `codex` installed ran them, and
 * five cases failed for a reason that had nothing to do with the code —
 * which is the worst kind of failing test, because the honest answer is that
 * the suite was wrong rather than the change.
 *
 * The check is a filesystem lookup rather than a spawn, so an empty file with
 * the right name in a directory of our own is enough to be that CLI.
 */
function withCli(...names: string[]): void {
    const dir = mkdtempSync(join(tmpdir(), 'inoa-cli-'));
    for (const name of names) {
        writeFileSync(join(dir, name), '');
    }
    process.env.PATH = dir;
}

/** A machine with no CLI installed at all. */
const withoutCli = (): void => {
    withCli();
};

function only(configured: Record<string, string> = {}): void {
    for (const key of ['ANTHROPIC_API_KEY', 'OPENAI_API_KEY', 'INOA_GENERATOR', 'INOA_AI']) {
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
        withCli('claude');
        assert.deepEqual(labels(), ['claude-cli']);
        assert.equal(hasGenerator(), true);
    });

    it('offers both CLIs when both are installed, so a run can rotate', () => {
        only();
        withCli('claude', 'codex');
        assert.deepEqual(labels(), ['claude-cli', 'codex-cli']);
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
     * A subscription beats a key, measured rather than assumed: a batch of
     * fifty names takes about 108 seconds through the CLI, of which the
     * process spawn is 5.5. Five per cent, against a cost difference of
     * everything versus nothing.
     */
    it('prefers the CLI over both paid APIs', () => {
        only({ ANTHROPIC_API_KEY: 'a', OPENAI_API_KEY: 'b' });
        withCli('claude');
        assert.deepEqual(labels(), ['claude-cli', 'anthropic', 'openai']);
    });

    it('falls to the APIs in a fixed order when no CLI is installed', () => {
        only({ OPENAI_API_KEY: 'b', ANTHROPIC_API_KEY: 'a' });
        withoutCli();
        assert.deepEqual(labels(), ['anthropic', 'openai']);
    });

    it('rotates the CLIs and keeps the keys underneath as failover', () => {
        only({ ANTHROPIC_API_KEY: 'a' });
        withCli('claude', 'codex');
        assert.deepEqual(labels(), ['claude-cli', 'codex-cli', 'anthropic']);
        assert.deepEqual(
            rotation().map((g) => g.label),
            ['claude-cli', 'codex-cli']
        );
    });
});

describe('which sources share the batches', () => {
    /*
     * Rotation is for spreading load between equals, and a subscription and a
     * metered key are not equals. Everything below the leading tier stays
     * reachable as failover, which is the entire reason to set a key on a
     * machine that already has a subscription.
     */
    it('shares batches within the leading tier only', () => {
        only({ ANTHROPIC_API_KEY: 'a', OPENAI_API_KEY: 'b' });
        withCli('claude');
        assert.deepEqual(
            rotation().map((g) => g.label),
            ['claude-cli']
        );
    });

    it('keeps the paid sources reachable underneath it', () => {
        only({ ANTHROPIC_API_KEY: 'a', OPENAI_API_KEY: 'b' });
        withCli('claude');
        const spare = generators().filter((g) => !rotation().includes(g));
        assert.deepEqual(
            spare.map((g) => g.label),
            ['anthropic', 'openai'],
            'a usage limit on the subscription has somewhere to go'
        );
    });

    it('rotates between the keys when they are the leading tier', () => {
        only({ ANTHROPIC_API_KEY: 'a', OPENAI_API_KEY: 'b' });
        withoutCli();
        assert.deepEqual(
            rotation().map((g) => g.label),
            ['anthropic', 'openai']
        );
    });

    it('has nothing to share when nothing is configured', () => {
        only();
        withoutCli();
        assert.deepEqual(rotation(), []);
    });
});

describe('INOA_AI', () => {
    /*
     * The switch that sends a run down the deterministic path on a machine
     * with everything configured — for a run that must not cost anything, or
     * must not leave the building.
     */
    for (const value of ['off', 'no', 'false', '0', 'OFF', '  off  ']) {
        it(`treats ${JSON.stringify(value)} as no AI at all`, () => {
            only({ ANTHROPIC_API_KEY: 'a' });
            process.env.INOA_AI = value;
            assert.equal(aiAllowed(), false);
            assert.deepEqual(labels(), []);
        });
    }

    it('leaves the sources alone when set to anything else', () => {
        only({ ANTHROPIC_API_KEY: 'a' });
        withCli('claude');
        process.env.INOA_AI = 'on';
        assert.equal(aiAllowed(), true);
        assert.deepEqual(labels(), ['claude-cli', 'anthropic']);
    });

    it('is on by default, because most runs want a model', () => {
        only({ ANTHROPIC_API_KEY: 'a' });
        assert.equal(aiAllowed(), true);
    });
});

describe('INOA_GENERATOR', () => {
    it('overrides the order outright', () => {
        only({ INOA_GENERATOR: 'openai,claude-cli', OPENAI_API_KEY: 'b' });
        withCli('claude');
        assert.deepEqual(labels(), ['openai', 'claude-cli']);
    });

    it('narrows to one source, so a subscription can be left alone', () => {
        only({ INOA_GENERATOR: 'anthropic', ANTHROPIC_API_KEY: 'a' });
        assert.deepEqual(labels(), ['anthropic']);
    });

    it('is case and whitespace insensitive, since it is typed into a .env', () => {
        only({ INOA_GENERATOR: '  OPENAI , claude-cli ', OPENAI_API_KEY: 'b' });
        withCli('claude');
        assert.deepEqual(labels(), ['openai', 'claude-cli']);
    });

    /*
     * A typo should cost you that source, not the run. Naming a source with
     * no key still drops it: asking for something unusable is not a reason to
     * pretend it is available.
     */
    it('ignores a name it does not know', () => {
        only({ INOA_GENERATOR: 'gemini,claude-cli' });
        withCli('claude');
        assert.deepEqual(labels(), ['claude-cli']);
    });

    it('still drops a named source that has no key behind it', () => {
        only({ INOA_GENERATOR: 'openai' });
        withoutCli();
        assert.deepEqual(labels(), []);
    });

    it('falls back to the default order when set to nothing', () => {
        only({ INOA_GENERATOR: '   ', ANTHROPIC_API_KEY: 'a' });
        withCli('claude');
        assert.deepEqual(labels(), ['claude-cli', 'anthropic']);
    });

    /*
     * Naming a key and a CLI together is a deliberate request to rotate
     * between them — the one way to ask a healthy subscription to share the
     * work with something metered, which the defaults will never do.
     */
    it('rotates across tiers when told to, which the defaults never do', () => {
        only({ INOA_GENERATOR: 'anthropic,claude-cli', ANTHROPIC_API_KEY: 'a' });
        withCli('claude');
        const sources = generators();
        assert.deepEqual(
            sources.map((g) => g.label),
            ['anthropic', 'claude-cli']
        );
        assert.deepEqual(
            rotation(sources).map((g) => g.label),
            ['anthropic'],
            'the list is honoured in order, and its head still leads'
        );
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
            assert.ok(generator.tier, 'a source needs a tier to be preferred by');
            assert.equal(typeof generator.available, 'function');
            assert.equal(typeof generator.complete, 'function');
        }
    });
});
