/**
 * What a run asks for, and who it asks.
 *
 * Three failures met in one real run, all of them silent, all of them pinned
 * here. A fifty-name run asking for compounds and invented words produced fifty
 * compounds and reported no problem at all:
 *
 *   1. `codex exec` blocked on an stdin that was never closed. The `stdio`
 *      option this passed to execFile is not an execFile option — execFile
 *      builds its own pipes — so the CLI sat holding an open pipe until the
 *      timeout killed it.
 *   2. It exits 0 on that signal, so an empty answer arrived as a SUCCESSFUL
 *      batch of zero names. No failover ran, and the empty batch counted
 *      towards the tally that means 'this brief is exhausted'.
 *   3. The batch number picked both the approach and the source, so 'invented'
 *      was welded to the one source that was failing.
 *
 * The stubs here are real executables on a PATH of our own, so the spawn, the
 * stdin and the exit code are the genuine article rather than a mock of one.
 *
 *   node --test --experimental-strip-types worker/rotation.test.ts
 */

import assert from 'node:assert/strict';
import { chmodSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, it } from 'node:test';
import { generateNames, promptFor, sourceFor } from './generate.ts';
import { ALL_GENERATORS } from './generators.ts';

const KEYS = ['PATH', 'INOA_GENERATOR', 'INOA_AI', 'ANTHROPIC_API_KEY', 'OPENAI_API_KEY'];
const saved = new Map(KEYS.map((key) => [key, process.env[key]]));

afterEach(() => {
    for (const [key, value] of saved) {
        // '' rather than a delete: these are all read as strings, an unset
        // variable and an empty one mean the same thing to every reader here,
        // and it keeps the restore a plain assignment.
        process.env[key] = value ?? '';
    }
});

/** One source by label. Throws rather than returning undefined, so a rename shows. */
function cli(label: string) {
    const source = ALL_GENERATORS.find((g) => g.label === label);
    assert.ok(source, `no source called ${label}`);
    return source;
}

/**
 * A directory of stub CLIs, put on PATH in place of the real ones.
 *
 * Each script is named for the binary the generator actually spawns, so
 * `claudeCli.complete()` runs ours. Only the keys are cleared alongside — an
 * API key in the environment would add a source these cases do not expect.
 */
function withStubs(scripts: Record<string, string>): string {
    const dir = mkdtempSync(join(tmpdir(), 'inoa-stub-'));
    for (const [name, body] of Object.entries(scripts)) {
        const path = join(dir, name);
        writeFileSync(path, `#!/bin/sh\n${body}\n`);
        chmodSync(path, 0o755);
    }
    process.env.PATH = dir;
    process.env.ANTHROPIC_API_KEY = '';
    process.env.OPENAI_API_KEY = '';
    process.env.INOA_AI = '';
    process.env.INOA_GENERATOR = '';
    return dir;
}

/**
 * Twenty-five distinct letter-only names, prefixed so the writer is visible.
 *
 * The stub sets its own PATH because the case above replaced the real one with
 * a directory holding nothing but these scripts — which a child shell inherits,
 * leaving it unable to find `tr`. Every name then came out as the bare prefix,
 * and twenty-five names deduplicated down to one.
 */
const emits = (prefix: string) => `
PATH=/usr/bin:/bin
i=0
while [ $i -lt 25 ]; do
  n=$(LC_ALL=C tr -dc 'a-z' </dev/urandom | head -c 9)
  printf '${prefix}%s\\treason enough for this one here\\n' "$n"
  i=$((i + 1))
done`;

describe('stdin', () => {
    it('is closed, so a CLI that reads it still answers', async () => {
        // `cat` returns only at end of file. An open pipe never reaches one,
        // which is exactly how twelve minutes of a real run were spent.
        withStubs({ claude: `cat >/dev/null${emits('Cla')}` });
        const started = Date.now();
        const out = await cli('claude-cli').complete('anything');
        assert.ok(out.includes('Cla'), 'the stub answered');
        assert.ok(Date.now() - started < 10_000, 'and did not wait on stdin to close');
    });
});

describe('a source that answers with nothing', () => {
    it('is a failure, however cleanly it exits', async () => {
        withStubs({ claude: 'exit 0' });
        await assert.rejects(cli('claude-cli').complete('anything'), /nothing at all/);
    });

    it('hands the batch to the next source rather than counting it done', async () => {
        withStubs({ claude: 'exit 0', codex: emits('Cod') });
        const names = await generateNames('a brief that wants names', ['compound'], 20);
        assert.equal(names.length, 20);
        assert.ok(
            names.every((n) => n.source === 'codex-cli'),
            'every name came from the source that actually answered'
        );
    });
});

describe('the approach and the source', () => {
    it('advance on different clocks', () => {
        // Two approaches, two sources. Sources alternate every batch, and the
        // pairing shifts after the fourth so the second half of the cycle is
        // the other way round. The old code returned `turn` for both.
        const seq = (strategies: number, sources: number, n: number) =>
            Array.from({ length: n }, (_, turn) => [turn % strategies, sourceFor(turn, sources)]);

        assert.deepEqual(
            seq(2, 2, 4),
            [
                [0, 0],
                [1, 1],
                [0, 1],
                [1, 0]
            ],
            'all four pairings inside four batches, two per source'
        );

        // Whatever the counts, every pairing turns up and no source is favoured.
        const shapes: [number, number][] = [
            [1, 2],
            [2, 2],
            [2, 3],
            [3, 2],
            [7, 2]
        ];
        for (const [strategies, sources] of shapes) {
            const turns = strategies * sources * 2;
            const pairs = seq(strategies, sources, turns);
            assert.equal(
                new Set(pairs.map(String)).size,
                strategies * sources,
                `${strategies} approaches over ${sources} sources covers every pairing`
            );
            const load = pairs.map(([, src]) => src);
            for (let i = 0; i < sources; i++) {
                assert.equal(
                    load.filter((s) => s === i).length,
                    turns / sources,
                    `source ${i} took its share of ${strategies}x${sources}`
                );
            }
        }

        // One source is not a rotation, and dividing by none should not be how
        // we find that out.
        assert.equal(sourceFor(3, 1), 0);
        assert.equal(sourceFor(3, 0), 0);
    });

    it('so every approach reaches every source', async () => {
        withStubs({ claude: emits('Cla'), codex: emits('Cod') });
        // Four batches is enough: the pairing shifts as soon as the sources
        // have each had one.
        const names = await generateNames(
            'a brief that wants names',
            ['compound', 'invented'],
            200
        );

        const pairs = new Set(names.map((n) => `${n.strategy}/${n.source}`));
        assert.deepEqual(
            [...pairs].sort(),
            [
                'compound/claude-cli',
                'compound/codex-cli',
                'invented/claude-cli',
                'invented/codex-cli'
            ],
            'both approaches came from both sources'
        );
    });

    it('and a source that dies takes a share of the run, not an approach', async () => {
        withStubs({ claude: emits('Cla'), codex: 'exit 1' });
        const names = await generateNames('a brief that wants names', ['compound', 'invented'], 60);

        assert.ok(names.length > 0, 'the run still produced names');
        assert.ok(
            names.some((n) => n.strategy === 'invented'),
            'including the approach the dead source used to monopolise'
        );
        assert.ok(names.every((n) => n.source === 'claude-cli'));
    });
});

/**
 * What each approach's request actually forbids.
 *
 * 'Draw only on these languages' was not holding, and the failure was
 * invisible because the result is a decent name: a run narrowed to
 * Austronesian, Romance and Classical returned HusayBoard — Tagalog husay
 * welded to English board. A positive constraint alone left the model free to
 * read 'draw on' as 'draw partly on', so the prompt now says what not to do.
 */
describe('what a request says about language', () => {
    const BRIEF = 'A review app for Filipino board and civil service examinees.';

    it('tells a foreign batch not to reach for English', () => {
        const prompt = promptFor(BRIEF, 'foreign', 10, [], ['Tagalog', 'Cebuano']);
        assert.match(prompt, /Draw only on these languages: Tagalog, Cebuano/);
        assert.match(prompt, /Do not attach an\s+English word to a foreign one/);
    });

    /*
     * And neither rule belongs anywhere else. A compound or an invented batch
     * draws on material these constraints would simply narrow.
     */
    for (const strategy of ['compound', 'invented', 'short'] as const) {
        it(`leaves ${strategy} unconstrained by language`, () => {
            const prompt = promptFor(BRIEF, strategy, 10, [], ['Tagalog']);
            assert.doesNotMatch(prompt, /Draw only on these languages|Combine ONE word/);
        });
    }
});
