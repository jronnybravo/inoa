/**
 * Re-run the checks that could not answer.
 *
 * 'unknown' means we failed to find out, not that anything is wrong with the
 * name — a rate limit, a blocked search, a bug in a checker. All of those are
 * worth asking again about later, which makes re-checking a normal operation
 * rather than a repair job.
 *
 *   npm run recheck -- <runId>
 *   npm run recheck -- <runId> playStore     # just one check
 *
 * Only cells currently marked 'unknown' are touched. Anything already decided
 * keeps its verdict, so this is safe to run repeatedly.
 */

import 'dotenv/config';
import { db } from '../src/lib/server/db.ts';
import { Candidate } from '../src/lib/server/entities/candidate.ts';
import { Run } from '../src/lib/server/entities/run.ts';
import { CHECK_ORDER, type CheckKind } from '../src/lib/types.ts';
import { checkAppStore } from './checks/appstore.ts';
import { checkCom } from './checks/domain.ts';
import { checkPlayStore } from './checks/playstore.ts';
import { jitter, sleep, type CheckOutcome } from './checks/shared.ts';
import { checkWeb, closeBrowser, hasSearchApi } from './checks/web.ts';
import { computePassed } from './pipeline.ts';

const RUNNERS: Record<CheckKind, (name: string) => Promise<CheckOutcome>> = {
    com: checkCom,
    appStore: checkAppStore,
    playStore: checkPlayStore,
    google: checkWeb
};

const PACE: Record<CheckKind, number> = {
    com: 150,
    appStore: 3200,
    playStore: 1200,
    // The web check is the one that needs real distance when no API is set.
    google: 800
};

const [runId, only] = process.argv.slice(2);
if (!runId) {
    console.error('usage: npm run recheck -- <runId> [checkKind]');
    process.exit(1);
}

const kinds = only ? [only as CheckKind] : CHECK_ORDER;
const source = await db();
const run = await Run.findOneBy({ id: runId });
if (!run) {
    console.error(`no run ${runId}`);
    process.exit(1);
}

const required = {
    com: run.requireCom,
    appStore: run.requireAppStore,
    playStore: run.requirePlayStore,
    google: run.requireGoogle
};

for (const kind of kinds) {
    const stuck = await Candidate.find({
        where: { runId, [kind]: 'unknown' } as never,
        order: { position: 'ASC' }
    });
    if (stuck.length === 0) {
        console.log(`${kind}: nothing unknown`);
        continue;
    }

    const interval = kind === 'google' && !hasSearchApi() ? 60_000 : PACE[kind];
    console.log(`${kind}: re-checking ${stuck.length}`);

    let resolved = 0;
    for (const [i, candidate] of stuck.entries()) {
        const outcome = await RUNNERS[kind](candidate.name);
        const statuses = {
            com: candidate.com,
            appStore: candidate.appStore,
            playStore: candidate.playStore,
            google: candidate.google,
            [kind]: outcome.status
        };
        await Candidate.update(candidate.id, {
            [kind]: outcome.status,
            detail: { ...candidate.detail, [kind]: outcome.detail ?? '' },
            passed: computePassed(statuses, required),
            checkedAt: new Date()
        });
        if (outcome.status !== 'unknown') {
            resolved++;
        }
        if ((i + 1) % 10 === 0) {
            console.log(`  ${i + 1}/${stuck.length}`);
        }
        if (i < stuck.length - 1) {
            await sleep(jitter(interval));
        }
    }
    console.log(`${kind}: ${resolved} of ${stuck.length} now answered`);
}

const passing = await Candidate.countBy({ runId, passed: true });
console.log(`\n${passing} names now pass every required check`);
await closeBrowser();
await source.destroy();
