/**
 * Re-run the checks that could not answer — and, on request, the ones that did.
 *
 * 'unknown' means we failed to find out, not that anything is wrong with the
 * name — a rate limit, a blocked search, a bug in a checker. All of those are
 * worth asking again about later, which makes re-checking a normal operation
 * rather than a repair job.
 *
 *   npm run recheck -- <runId>
 *   npm run recheck -- <runId> playStore              # just one check
 *   npm run recheck -- <runId> com --include-clear    # revisit 'clear' too
 *
 * By default only cells currently marked 'unknown' are touched, so anything
 * already decided keeps its verdict and this is safe to run repeatedly.
 *
 * --include-clear widens that to cells that say 'clear'. A verdict is only as
 * good as the checker that produced it, and when a checker is corrected the
 * rows it already wrote do not correct themselves — a stored 'clear' from a
 * checker that used to be too generous looks exactly like a sound one. This is
 * how those get revisited. It never touches 'taken', which was a positive
 * finding, or 'skipped', which belongs to the funnel rather than to a check.
 */

import 'dotenv/config';
import { candidateStatuses, runChecks, statusColumns } from '../src/lib/checks.ts';
import { db } from '../src/lib/server/db.ts';
import { Candidate } from '../src/lib/server/entities/candidate.ts';
import { Run } from '../src/lib/server/entities/run.ts';
import { isTldKind, statusOf, type CheckKind, type CheckStatus } from '../src/lib/types.ts';
import { jitter, sleep } from './checks/shared.ts';
import { closeBrowser, hasSearchApi } from './checks/web.ts';
import { computePassed, runnerFor } from './pipeline.ts';

/** How long to leave between two calls of the same kind. */
const STORE_PACE: Record<string, number> = {
    appStore: 3200,
    playStore: 1200,
    // The web check is the one that needs real distance when no API is set.
    google: 800
};

// A domain check is DNS and one request to a host nobody else is calling.
const DOMAIN_PACE = 150;

const KNOWN_FLAGS = new Set(['--include-clear', '--yes']);

/**
 * Past this, say what it will cost before spending it.
 *
 * --include-clear can multiply the work by a hundred: a thousand-name run has
 * a handful of 'unknown' cells and hundreds of 'clear' ones, and the Play and
 * App Store checks are paced in seconds apiece. Without an API key the web
 * check is paced in minutes, which turns the same request into days.
 */
const LONG_PASS_MS = 10 * 60_000;

/** Jitter adds up to 60% on top of each interval, so the mean is about 1.3x. */
const JITTER_FACTOR = 1.3;

function usage(problem?: string): never {
    if (problem) {
        console.error(`recheck: ${problem}\n`);
    }
    console.error('usage: npm run recheck -- <runId> [checkKind] [--include-clear] [--yes]\n');
    // Not listed: which checks exist depends on the run, and usage() is
    // reachable before one has been loaded.
    console.error("  checkKind        one of the run's own checks, e.g. tld:com or appStore");
    console.error('                   (default: all of them)');
    console.error("  --include-clear  also revisit cells that currently say 'clear', for");
    console.error('                   correcting verdicts stored before a checker was fixed');
    console.error('  --yes            start a long pass without asking');
    process.exit(1);
}

function describeDuration(ms: number): string {
    if (ms < 90_000) {
        return `${Math.max(1, Math.round(ms / 1000))}s`;
    }
    if (ms < 90 * 60_000) {
        return `${Math.round(ms / 60_000)}m`;
    }
    return `${(ms / (60 * 60_000)).toFixed(1)}h`;
}

const args = process.argv.slice(2);
const flags = args.filter((arg) => arg.startsWith('-'));
const [runId, only, ...extra] = args.filter((arg) => !arg.startsWith('-'));

const unknownFlag = flags.find((flag) => !KNOWN_FLAGS.has(flag));
if (unknownFlag) {
    usage(`unknown option ${unknownFlag}`);
}
if (extra.length > 0) {
    usage(`unexpected argument ${extra[0] ?? ''}`);
}
if (!runId) {
    usage('a run id is required');
}
const includeClear = flags.includes('--include-clear');
const confirmed = flags.includes('--yes');
const revisit: CheckStatus[] = includeClear ? ['unknown', 'clear'] : ['unknown'];

const source = await db();
const run = await Run.findOneBy({ id: runId });
if (!run) {
    console.error(`no run ${runId}`);
    process.exit(1);
}

// Which checks exist is now the run's own business, so the argument is
// validated against that run rather than against a fixed list.
const { kinds: all, required } = runChecks(run);
if (only !== undefined && !all.includes(only as CheckKind)) {
    usage(`${only} is not a check in this run; expected one of ${all.join(', ')}`);
}

const kinds: CheckKind[] = only ? [only as CheckKind] : all;

const paceFor = (kind: CheckKind): number => {
    if (isTldKind(kind)) {
        return DOMAIN_PACE;
    }
    return kind === 'google' && !hasSearchApi() ? 60_000 : (STORE_PACE[kind] ?? DOMAIN_PACE);
};

/**
 * The cells one check has to revisit, as they stand right now.
 *
 * Read again for each kind rather than once up front. A pass over several
 * kinds writes `detail` and `passed` for the whole row, so a row that two
 * kinds both touch would otherwise be written from a snapshot taken before
 * either ran — putting back the detail the previous kind had just recorded and
 * recomputing `passed` from its stale verdict. The plan below is a forecast;
 * the work itself needs current rows.
 */
/**
 * The run's rows, read once.
 *
 * rowsFor() is called twice for every kind — once to price the work and once
 * to do it — so a thirteen-check run was reading the whole table twenty-six
 * times to answer questions about the same two thousand rows. The pass writes
 * as it goes, so the cache is refreshed between kinds rather than held for the
 * whole run.
 */
let cached: Candidate[] | null = null;
const allRows = async (): Promise<Candidate[]> => {
    cached ??= await Candidate.find({ where: { runId }, order: { position: 'ASC' } });
    return cached;
};

const rowsFor = async (kind: CheckKind): Promise<Candidate[]> => {
    /*
     * Filtered here rather than in SQL.
     *
     * The store verdicts are still columns, but the domain ones live together
     * in a JSON value, and querying inside one is the sort of thing every
     * dialect spells differently — this project runs on three. A run is at
     * most a couple of thousand rows, so reading them and asking in JavaScript
     * costs a fraction of a second and works everywhere.
     */
    const rows = await allRows();
    return rows.filter((row) => revisit.includes(statusOf(candidateStatuses(row), kind)));
};

/** Everything to do, priced, before any of it is done. */
const jobs: { kind: CheckKind; count: number; interval: number; cost: number }[] = [];
for (const kind of kinds) {
    const count = (await rowsFor(kind)).length;
    if (count > 0) {
        const interval = paceFor(kind);
        jobs.push({ kind, count, interval, cost: count * interval * JITTER_FACTOR });
    }
}

if (jobs.length === 0) {
    console.log(`nothing to re-check (${revisit.join(' or ')})`);
    await source.destroy();
    process.exit(0);
}

const total = jobs.reduce((sum, job) => sum + job.cost, 0);
const cells = jobs.reduce((sum, job) => sum + job.count, 0);
const planRow = (label: string, count: number, cost: number): string =>
    `  ${label.padEnd(10)} ${String(count).padStart(5)}  ~${describeDuration(cost)}`;

console.log(`re-checking ${revisit.join(' and ')} cells in run ${runId.slice(0, 8)}:`);
for (const job of jobs) {
    console.log(planRow(job.kind, job.count, job.cost));
}
console.log(`${planRow('total', cells, total)}\n`);

if (total > LONG_PASS_MS && !confirmed) {
    console.error(`That is roughly ${describeDuration(total)} of work. Add --yes to start it.`);
    await source.destroy();
    process.exit(1);
}

for (const { kind, interval } of jobs) {
    // The previous kind wrote to these rows, so read them again rather than
    // recomputing `passed` from a snapshot taken before it ran.
    cached = null;
    const rows = await rowsFor(kind);
    if (rows.length === 0) {
        continue;
    }
    console.log(`${kind}: re-checking ${rows.length}`);

    let resolved = 0;
    let changed = 0;
    for (const [i, candidate] of rows.entries()) {
        const before = statusOf(candidateStatuses(candidate), kind);
        const outcome = await runnerFor(kind)(candidate.name);
        const statuses = { ...candidateStatuses(candidate), [kind]: outcome.status };
        await Candidate.update(candidate.id, {
            ...statusColumns(statuses),
            detail: { ...candidate.detail, [kind]: outcome.detail ?? '' },
            passed: computePassed(statuses, required),
            checkedAt: new Date()
        });
        if (outcome.status !== 'unknown') {
            resolved++;
        }
        // A corrected verdict is the point of --include-clear, so it is worth
        // naming: a run that quietly rewrites itself is hard to trust.
        if (outcome.status !== before) {
            changed++;
            console.log(`  ${candidate.name}: ${before} → ${outcome.status}`);
        }
        if ((i + 1) % 10 === 0) {
            console.log(`  ${i + 1}/${rows.length}`);
        }
        if (i < rows.length - 1) {
            await sleep(jitter(interval));
        }
    }
    console.log(`${kind}: ${resolved} of ${rows.length} now answered, ${changed} changed`);
}

const passing = await Candidate.countBy({ runId, passed: true });
console.log(`\n${passing} names now pass every required check`);
await closeBrowser();
await source.destroy();
