/**
 * The local worker.
 *
 * Everything expensive happens here, on your machine, for two reasons. A run
 * takes tens of minutes and a Vercel function is capped near a minute; and the
 * store and search endpoints block datacentre addresses far more readily than
 * a residential one, so checks run more reliably from here than they ever
 * would from a deployed function.
 *
 * The app writes queued runs to Neon and reads results back. This process is
 * the only thing that does the work. When it is not running, runs simply queue
 * — which is the intended behaviour for an idea captured from the road.
 *
 *   npm run worker
 */

import 'dotenv/config';
import { db } from '../src/lib/server/db.ts';
import { RunEntity, type Run } from '../src/lib/server/entities/run.ts';
import { CandidateEntity } from '../src/lib/server/entities/candidate.ts';
import { generateNames } from './generate.ts';
import { checkCandidate } from './pipeline.ts';
import { closeBrowser } from './checks/web.ts';
import { sendResults } from '../src/lib/server/email.ts';
import { sleep } from './checks/shared.ts';
import { CHECK_ORDER } from '../src/lib/types.ts';

const POLL_MS = 5000;
const APP_URL = process.env.PUBLIC_APP_URL ?? 'http://localhost:5173';

async function claimNext(): Promise<Run | null> {
  const source = await db();
  // Claim atomically: two workers on one run would double every API call.
  const claimed = await source
    .createQueryBuilder()
    .update(RunEntity)
    .set({ status: 'generating', claimedAt: new Date() })
    .where(
      `id = (SELECT id FROM runs WHERE status = 'queued' AND "emailVerified" = true
             ORDER BY "createdAt" LIMIT 1 FOR UPDATE SKIP LOCKED)`
    )
    .returning('*')
    .execute();
  return (claimed.raw?.[0] as Run) ?? null;
}

async function processRun(run: Run): Promise<void> {
  const source = await db();
  const runs = source.getRepository(RunEntity);
  const candidates = source.getRepository(CandidateEntity);

  console.log(`\n[${run.id.slice(0, 8)}] ${run.brief.slice(0, 60)}`);
  console.log(`  generating ${run.targetCount} names...`);

  const generated = await generateNames(
    run.brief,
    run.strategies as never,
    run.targetCount,
    async (total) => {
      await runs.update(run.id, { generatedCount: total });
      console.log(`  generated ${total}`);
    }
  );

  if (generated.length === 0) {
    await runs.update(run.id, {
      status: 'failed',
      error: 'Generation produced no names. Is the Claude CLI signed in? Try `claude login`.',
      finishedAt: new Date()
    });
    return;
  }

  await candidates.insert(
    generated.map((g, i) => ({
      runId: run.id,
      name: g.name,
      rationale: g.rationale,
      position: i
    }))
  );
  await runs.update(run.id, { status: 'checking', generatedCount: generated.length });

  const required = {
    com: run.requireCom,
    appStore: run.requireAppStore,
    playStore: run.requirePlayStore,
    google: run.requireGoogle
  };

  let checked = 0;
  const stored = await candidates.find({ where: { runId: run.id }, order: { position: 'ASC' } });

  for (const candidate of stored) {
    const result = await checkCandidate(candidate.name, required);
    await candidates.update(candidate.id, {
      com: result.statuses.com,
      appStore: result.statuses.appStore,
      playStore: result.statuses.playStore,
      google: result.statuses.google,
      detail: result.detail,
      passed: result.passed,
      droppedBy: result.droppedBy,
      checkedAt: new Date()
    });
    checked++;
    await runs.update(run.id, { checkedCount: checked });
    if (checked % 10 === 0) console.log(`  checked ${checked}/${stored.length}`);
  }

  const survivors = await candidates.find({
    where: { runId: run.id, passed: true },
    order: { position: 'ASC' }
  });

  await runs.update(run.id, { status: 'done', finishedAt: new Date() });

  const sent = await sendResults(
    run.email,
    run.id,
    run.brief,
    survivors.map((c) => ({
      name: c.name,
      com: c.com,
      appStore: c.appStore,
      playStore: c.playStore,
      google: c.google
    })),
    `${APP_URL}/?requestid=${run.id}`
  );
  if (sent) await runs.update(run.id, { notifiedAt: new Date() });

  console.log(`  done — ${survivors.length} passed of ${stored.length}${sent ? ', emailed' : ''}`);
}

async function main() {
  await db();
  console.log('worker ready; polling for queued runs');
  for (;;) {
    try {
      const run = await claimNext();
      if (run) await processRun(run);
      else await sleep(POLL_MS);
    } catch (error) {
      console.error('worker error:', (error as Error).message);
      await sleep(POLL_MS);
    }
  }
}

process.on('SIGINT', async () => {
  await closeBrowser();
  process.exit(0);
});

main();
