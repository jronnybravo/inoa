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
import {
    ALL_GENERATORS,
    aiAllowed,
    clearUsageLimits,
    exhaustedUntil,
    generators,
    hasGenerator,
    noteUsageLimit,
    resetAt,
    setAsideUntil,
    usable
} from './generators.ts';

const KEYS = ['ANTHROPIC_API_KEY', 'OPENAI_API_KEY', 'CLAUDE_CLI', 'CODEX_CLI', 'INOA_AI', 'PATH'];
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
    for (const key of [
        'ANTHROPIC_API_KEY',
        'OPENAI_API_KEY',
        'CLAUDE_CLI',
        'CODEX_CLI',
        'INOA_AI'
    ]) {
        Reflect.deleteProperty(process.env, key);
    }
    for (const [key, value] of Object.entries(configured)) {
        process.env[key] = value;
    }
}

const labels = (): string[] => generators().map((g) => g.label);

afterEach(() => {
    clearUsageLimits();
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
        only({ CLAUDE_CLI: 'true' });
        withCli('claude');
        assert.deepEqual(labels(), ['claude-cli']);
        assert.equal(hasGenerator(), true);
    });

    it('offers both CLIs when both are installed, so a run can rotate', () => {
        only({ CLAUDE_CLI: 'true', CODEX_CLI: 'true' });
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

describe('a CLI beats a key outright', () => {
    /*
     * Not by a hair, and not as a preference that can be overflowed past. A
     * signed-in CLI spends a subscription already paid for; a key spends money
     * per batch. So the keys are not touched at all while a CLI is working —
     * not as failover, not as overflow — and a machine that wants its keys used
     * says so by switching the CLIs off.
     */
    it('ignores the keys entirely when a CLI is on', () => {
        only({ CLAUDE_CLI: 'true', ANTHROPIC_API_KEY: 'a', OPENAI_API_KEY: 'b' });
        withCli('claude');
        assert.deepEqual(labels(), ['claude-cli']);
    });

    it('rotates between the CLIs, and still ignores the keys', () => {
        only({ CLAUDE_CLI: 'true', CODEX_CLI: 'true', ANTHROPIC_API_KEY: 'a' });
        withCli('claude', 'codex');
        assert.deepEqual(labels(), ['claude-cli', 'codex-cli']);
    });

    it('uses the keys when no CLI is installed', () => {
        only({ OPENAI_API_KEY: 'b', ANTHROPIC_API_KEY: 'a' });
        withoutCli();
        assert.deepEqual(labels(), ['anthropic', 'openai']);
    });

    it('offers nothing when neither is there, and names get composed', () => {
        only();
        withoutCli();
        assert.deepEqual(labels(), []);
        assert.equal(hasGenerator(), false);
    });
});

describe('CLAUDE_CLI and CODEX_CLI', () => {
    /*
     * Neither is assumed. A subscription is somebody's account and their
     * money's worth of quota, and spending it because a binary happened to be
     * on PATH is not a decision this should make for them.
     */
    it('leaves an installed CLI alone until it is asked for', () => {
        only();
        withCli('claude', 'codex');
        assert.deepEqual(labels(), []);
    });

    it('uses the one it is told to, and only that one', () => {
        only({ CODEX_CLI: 'true' });
        withCli('claude', 'codex');
        assert.deepEqual(labels(), ['codex-cli']);
    });

    it('rotates the ones it is told to', () => {
        only({ CLAUDE_CLI: 'true', CODEX_CLI: 'true' });
        withCli('claude', 'codex');
        assert.deepEqual(labels(), ['claude-cli', 'codex-cli']);
    });

    /*
     * The keys are reached by asking for no CLI, which is also the default —
     * so a machine with a key and nothing else set up simply works.
     */
    it('uses the keys when no CLI is asked for', () => {
        only({ ANTHROPIC_API_KEY: 'a' });
        withCli('claude', 'codex');
        assert.deepEqual(labels(), ['anthropic']);
    });

    it('ignores the keys the moment a CLI is asked for', () => {
        only({ CLAUDE_CLI: 'true', ANTHROPIC_API_KEY: 'a' });
        withCli('claude', 'codex');
        assert.deepEqual(labels(), ['claude-cli']);
    });

    it('reads the same true and false as every other switch here', () => {
        for (const on of ['true', '1', 'on', 'yes', 'TRUE', '  on  ']) {
            only({ CLAUDE_CLI: on });
            withCli('claude');
            assert.deepEqual(labels(), ['claude-cli'], `${JSON.stringify(on)} should switch it on`);
        }
        for (const off of ['false', '0', 'off', 'no', '']) {
            only({ CLAUDE_CLI: off });
            withCli('claude');
            assert.deepEqual(labels(), [], `${JSON.stringify(off)} should leave it off`);
        }
    });

    it('cannot conjure a CLI that is not installed', () => {
        only({ CLAUDE_CLI: 'true' });
        withoutCli();
        assert.deepEqual(labels(), []);
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
        only({ CLAUDE_CLI: 'true', ANTHROPIC_API_KEY: 'a' });
        withCli('claude');
        process.env.INOA_AI = 'on';
        assert.equal(aiAllowed(), true);
        assert.deepEqual(labels(), ['claude-cli']);
    });

    it('is on by default, because most runs want a model', () => {
        only({ ANTHROPIC_API_KEY: 'a' });
        assert.equal(aiAllowed(), true);
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

/**
 * A quota is not a fault, and does not deserve the next batch.
 *
 * A usage limit comes back on a clock rather than on a retry, so asking again
 * spends the next window's allowance and nothing else. Generation used to end
 * the moment any source reported one — even with a second CLI sitting idle
 * beside it — so a limit on one subscription cost the whole run.
 */
describe('a source that has run out of quota', () => {
    const NOW = Date.parse('2026-09-12T10:00:00Z');
    const limited = (said: string) => noteUsageLimit('claude-cli', said, NOW);

    it('is set aside, leaving the rest of the rotation to carry on', () => {
        only({ CLAUDE_CLI: 'true', CODEX_CLI: 'true' });
        withCli('claude', 'codex');
        limited('Claude usage limit reached.');
        assert.deepEqual(
            usable(NOW).map((g) => g.label),
            ['codex-cli'],
            'the other CLI keeps the run going'
        );
        // Still CONFIGURED, which is what decides generate against compose.
        assert.deepEqual(labels(), ['claude-cli', 'codex-cli']);
    });

    it('comes back by itself once the window has passed', () => {
        only({ CLAUDE_CLI: 'true' });
        withCli('claude');
        const until = limited('usage limit reached');
        assert.equal(setAsideUntil('claude-cli', NOW), until);
        assert.equal(setAsideUntil('claude-cli', until + 1), undefined);
        assert.deepEqual(
            usable(until + 1).map((g) => g.label),
            ['claude-cli']
        );
    });

    /*
     * Nothing left is a different thing from nothing configured, and the two
     * must not be confused: one is a run that waits, the other is a run that
     * composes its names from a word list.
     */
    it('reports when the first one returns, once they are all out', () => {
        only({ CLAUDE_CLI: 'true', CODEX_CLI: 'true' });
        withCli('claude', 'codex');
        limited('usage limit reached');
        noteUsageLimit('codex-cli', 'usage limit reached', NOW + 60_000);
        assert.deepEqual(
            usable(NOW).map((g) => g.label),
            []
        );
        assert.equal(exhaustedUntil(NOW), setAsideUntil('claude-cli', NOW));
    });

    it('says nothing is exhausted while something can still answer', () => {
        only({ CLAUDE_CLI: 'true', CODEX_CLI: 'true' });
        withCli('claude', 'codex');
        limited('usage limit reached');
        assert.equal(exhaustedUntil(NOW), undefined);
    });

    it('keeps the longer of two limits rather than shortening one', () => {
        only({ CLAUDE_CLI: 'true' });
        withCli('claude');
        const far = limited('try again in 6 hours');
        const near = limited('try again in 10 minutes');
        assert.equal(near, far, 'a shorter reading must not release it early');
    });
});

/**
 * Reading a reset time out of somebody else's error text.
 *
 * None of these formats is promised by the service that prints it, so each is
 * tried and none is required: a message that matches nothing falls back to a
 * cooldown rather than to a guess dressed up as a reading.
 */
describe('when a service says its quota comes back', () => {
    const NOW = Date.parse('2026-09-12T10:00:00Z');
    const at = (said: string) => resetAt(said, NOW);

    it('reads a wait in hours and minutes', () => {
        assert.equal(
            at('You have hit your usage limit. Try again in 4 hours 12 minutes.'),
            NOW + (4 * 60 + 12) * 60_000
        );
        assert.equal(at('rate limited — retry in 30 minutes'), NOW + 30 * 60_000);
        assert.equal(at('try again in 2h'), NOW + 2 * 60 * 60_000);
    });

    /*
     * Verbatim from the Codex CLI, met in a real run. It is the format that
     * made the case for every other decision here: a written-out date with an
     * ordinal Date.parse will not take, naming a reset a MONTH out — which the
     * cap used to refuse in favour of retrying hourly until then.
     */
    it('reads what the Codex CLI actually prints', () => {
        const said =
            "ERROR: You've hit your usage limit. Upgrade to Plus to continue using Codex " +
            '(https://chatgpt.com/explore/plus), or try again at Oct 10th, 2026 9:31 PM.';
        assert.equal(at(said), new Date(2026, 9, 10, 21, 31).getTime());
    });

    it('reads an explicit instant', () => {
        assert.equal(
            at('Your limit will reset at 2026-09-12T11:30:00Z'),
            Date.parse('2026-09-12T11:30:00Z')
        );
        assert.equal(at(`limit resets ${Math.floor(NOW / 1000) + 3600}`), NOW + 3_600_000);
    });

    /*
     * Built from the local clock rather than written down, because 'at 3pm'
     * means three in the afternoon wherever the worker is running and a fixed
     * expectation would pass in one timezone and fail in the next.
     */
    it('reads a clock time as the next time it comes round', () => {
        const local = new Date(NOW);
        const soon = (local.getHours() + 2) % 24;
        const at2 = at(`Your limit will reset at ${soon}:00`);
        assert.ok(at2, 'a time two hours out should be read');
        assert.equal(at2, NOW + 2 * 60 * 60 * 1000);
    });

    /*
     * A time already gone today means tomorrow, which is more than twelve
     * hours away and so refused by the cap below — the cooldown covers it
     * instead. Better a source retried in an hour than one shelved overnight
     * on the strength of a clock reading.
     */
    it('takes a clock time already past today as tomorrow', () => {
        const local = new Date(NOW);
        const gone = (local.getHours() + 23) % 24;
        const tomorrow = at(`your limit will reset at ${gone}:00`);
        assert.ok(tomorrow, 'a time gone today means the next one');
        assert.ok(tomorrow > NOW && tomorrow - NOW < 24 * 60 * 60 * 1000);
    });

    /*
     * A misread must not take a source out for a week, and a reading that is
     * already in the past is not a reading at all.
     */
    it('refuses a time that is absurd or already gone', () => {
        assert.equal(at('reset at 2020-01-01T00:00:00Z'), undefined);
        assert.equal(at('try again at Jan 1st, 2099 9:00 AM'), undefined);
    });

    it('says nothing about a message that names no time', () => {
        assert.equal(at('Claude usage limit reached.'), undefined);
        assert.equal(at(''), undefined);
    });
});
