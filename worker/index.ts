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
import { drainWebQueue } from './webqueue.ts';
import { closeBrowser } from './checks/web.ts';
import { sendResults } from '../src/lib/server/email.ts';
import { sleep } from './checks/shared.ts';
import { makeLogger } from './log.ts';
import { CHECK_LABEL, type CheckKind } from '../src/lib/types.ts';

/**
 * Everything except the web check. The web check is drained afterwards on a
 * much slower clock, because search engines punish volume without warning and
 * the penalty outlasts the run — see worker/webqueue.ts.
 */
const FAST_CHECKS: CheckKind[] = ['com', 'appStore', 'playStore'];

const POLL_MS = 5000;

/**
 * A claim is a lease, not a flag.
 *
 * The worker stamps claimedAt when it takes a run and keeps stamping it while
 * it works. If the process dies — killed, restarted, crashed — the stamp stops
 * and the run becomes claimable again. Without this a run whose worker went
 * away sits in 'generating' forever, because claiming only ever looked for
 * 'queued', and the only way out was editing the database by hand.
 */
const HEARTBEAT_MS = 30_000;
const LEASE_SECONDS = 150;
const APP_URL = process.env.PUBLIC_APP_URL ?? 'http://localhost:5173';

async function claimNext(): Promise<Run | null> {
  const source = await db();
  // Claim atomically: two workers on one run would double every API call.
  const claimed = await source
    .createQueryBuilder()
    .update(RunEntity)
    .set({ status: 'generating', claimedAt: new Date() })
    .where(
      `id = (SELECT id FROM runs
             WHERE "emailVerified" = true
               AND (
                 status = 'queued'
                 -- Or its worker stopped renewing the lease and is gone.
                 OR (status IN ('generating', 'checking')
                     AND "claimedAt" < now() - interval '${LEASE_SECONDS} seconds')
               )
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
  const log = makeLogger(source, run.id);

  // Renew the lease while we work, so nothing else takes this run from us.
  const heartbeat = setInterval(() => {
    runs.update(run.id, { claimedAt: new Date() }).catch(() => {});
  }, HEARTBEAT_MS);

  try {
    await runProcess();
  } finally {
    clearInterval(heartbeat);
  }

  async function runProcess() {
  // Anything left by a previous, abandoned attempt is cleared: partial
  // candidates would be checked twice and counted twice.
  const leftover = await candidates.countBy({ runId: run.id });
  if (leftover > 0) {
    await candidates.delete({ runId: run.id });
    await log(`Restarting — discarded ${leftover} names from an interrupted attempt`, 'warn');
  }
  await runs.update(run.id, { generatedCount: 0, checkedCount: 0 });

  await log(`Generating ${run.targetCount} names`);

  // Names are stored as each batch arrives rather than at the end, so the page
  // fills in while generation is still running.
  let stored_count = 0;
  const generated = await generateNames(
    run.brief,
    run.strategies as never,
    run.targetCount,
    async (fresh, total) => {
      if (fresh.length > 0) {
        await candidates.insert(
          fresh.map((g, i) => ({
            runId: run.id,
            name: g.name,
            rationale: g.rationale,
            position: stored_count + i
          }))
        );
        stored_count += fresh.length;
      }
      await runs.update(run.id, { generatedCount: total });
      await log(`Generated ${total} of ${run.targetCount}`);
    }
  );

  if (generated.length === 0) {
    const reason = 'Generation produced no names. Is the Claude CLI signed in? Try `claude login`.';
    await log(reason, 'error');
    await runs.update(run.id, { status: 'failed', error: reason, finishedAt: new Date() });
    return;
  }

  await runs.update(run.id, { status: 'checking', generatedCount: generated.length });
  await log(
    `Checking ${generated.length} names — ${FAST_CHECKS.map((k) => CHECK_LABEL[k]).join(', ')}`,
    'success'
  );

  const required = {
    com: run.requireCom,
    appStore: run.requireAppStore,
    playStore: run.requirePlayStore,
    google: run.requireGoogle
  };

  let checked = 0;
  const stored = await candidates.find({ where: { runId: run.id }, order: { position: 'ASC' } });

  for (const candidate of stored) {
    const result = await checkCandidate(candidate.name, required, FAST_CHECKS);
    await candidates.update(candidate.id, {
      com: result.statuses.com!,
      appStore: result.statuses.appStore!,
      playStore: result.statuses.playStore!,
      // A name dropped by an earlier gate never reaches the web queue.
      google: result.droppedBy ? 'skipped' : 'pending',
      detail: result.detail,
      passed: result.passed,
      droppedBy: result.droppedBy,
      checkedAt: new Date()
    });
    checked++;
    await runs.update(run.id, { checkedCount: checked });
    if (result.droppedBy) {
      await log(`${candidate.name} — dropped, ${CHECK_LABEL[result.droppedBy]} taken`);
    }
    if (checked % 25 === 0) await log(`Checked ${checked} of ${stored.length}`);
  }

  // Phase two. Only survivors are here, which is what makes a minute apiece
  // affordable — the funnel has already removed most of the field.
  const queued = stored.length - (await candidates.countBy({ runId: run.id, google: 'skipped' }));
  if (queued > 0) {
    await log(`Web check queue: ${queued} names survived the earlier gates`, 'success');
    const { resolved, abandoned } = await drainWebQueue(
      candidates,
      run.id,
      required,
      async (done, total, note) => {
        if (note) await log(note, 'warn');
        else if (done % 10 === 0) await log(`Web check ${done} of ${total}`);
      }
    );
    await log(
      `Web checks done — ${resolved} resolved` + (abandoned ? `, ${abandoned} left unverified` : ''),
      abandoned ? 'warn' : 'success'
    );
  }

  const survivors = await candidates.find({
    where: { runId: run.id, passed: true },
    order: { position: 'ASC' }
  });

  await runs.update(run.id, { status: 'done', finishedAt: new Date() });

  const mail = await sendResults(
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
  if (mail.sent) await runs.update(run.id, { notifiedAt: new Date() });

  await log(`Finished — ${survivors.length} of ${stored.length} names passed every requirement`, 'success');
    if (!mail.sent) await log(`Results email failed: ${mail.reason}`, 'error');
    else await log(`Results emailed to ${run.email}`, 'success');
  }
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
