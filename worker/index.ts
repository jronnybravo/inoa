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
import { LessThan } from 'typeorm';
import { db } from '../src/lib/server/db.ts';
import { sendResults } from '../src/lib/server/email.ts';
import { Candidate } from '../src/lib/server/entities/candidate.ts';
import { Run } from '../src/lib/server/entities/run.ts';
import { CHECK_LABEL } from '../src/lib/types.ts';
import { priorVerdict } from './checks/reuse.ts';
import { sleep } from './checks/shared.ts';
import { closeBrowser } from './checks/web.ts';
import { generateNames } from './generate.ts';
import { makeLogger } from './log.ts';
import { checkCandidate, fastChecks } from './pipeline.ts';
import { drainWebQueue } from './webqueue.ts';

/**
 * How many names are checked at once.
 *
 * Each name is almost entirely spent waiting on somebody else's server, and
 * the services have their own shared limiters, so this is about keeping those
 * limiters saturated rather than about this machine's capacity. Serially, one
 * name occupied the whole pipeline for the length of its slowest wait.
 */
const CHECK_CONCURRENCY = Number(process.env.INOA_CHECK_CONCURRENCY ?? 8);

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

/**
 * Take the next run that needs a worker.
 *
 * Deliberately no row locking. 'FOR UPDATE SKIP LOCKED' is the neat way to do
 * this, but SQLite has no such thing and RETURNING is not portable either, so
 * a query written that way limits where this can be deployed.
 *
 * Instead the claim is optimistic: find a candidate, then update it only if it
 * still looks the way it did when we read it. Losing that race means another
 * worker took it, which costs one wasted statement and a retry. The cutoff is
 * computed here rather than in SQL, because every database spells date
 * arithmetic differently.
 */
async function claimNext(): Promise<Run | null> {
    const cutoff = new Date(Date.now() - LEASE_SECONDS * 1000);

    const waiting = await Run.find({
        where: [
            { emailVerified: true, status: 'queued' },
            // Or a worker took it and stopped renewing the lease.
            { emailVerified: true, status: 'generating', claimedAt: LessThan(cutoff) },
            { emailVerified: true, status: 'checking', claimedAt: LessThan(cutoff) }
        ],
        order: { createdAt: 'ASC' },
        take: 5
    });

    for (const run of waiting) {
        const taken = await Run.update(
            // The same conditions again: if they no longer hold, somebody else won.
            run.status === 'queued'
                ? { id: run.id, status: 'queued' }
                : { id: run.id, status: run.status, claimedAt: LessThan(cutoff) },
            { status: 'generating', claimedAt: new Date() }
        );
        if (taken.affected === 1) {
            run.status = 'generating';
            return run;
        }
    }
    return null;
}

async function processRun(run: Run): Promise<void> {
    const source = await db();

    console.log(`\n[${run.id.slice(0, 8)}] ${run.brief.slice(0, 60)}`);
    const log = makeLogger(source, run.id);

    // Renew the lease while we work, so nothing else takes this run from us.
    const heartbeat = setInterval(() => {
        Run.update(run.id, { claimedAt: new Date() }).catch(() => {});
    }, HEARTBEAT_MS);

    try {
        await runProcess();
    } finally {
        clearInterval(heartbeat);
    }

    async function runProcess() {
        /**
         * Resume rather than start over where that is possible.
         *
         * Generation is the expensive half. An attempt that already produced the
         * full set and died during checking should carry on checking; only a
         * half-generated set has to be discarded, because topping it up would need
         * the exclusion list that died with the process.
         */
        const leftover = await Candidate.countBy({ runId: run.id });
        const resuming = leftover >= run.targetCount;

        if (leftover > 0 && !resuming) {
            await Candidate.delete({ runId: run.id });
            await log(
                `Restarting — discarded ${leftover} partial names from an interrupted attempt`,
                'warn'
            );
            await Run.update(run.id, { generatedCount: 0, checkedCount: 0 });
        }

        /**
         * Generation and checking run together.
         *
         * A name is checkable the moment it exists, and the two halves contend for
         * nothing: generation waits on one service, the checks wait on others. Run in
         * sequence they added up; run together the checking is nearly free, because
         * it happens inside time that was already being spent waiting.
         */
        let generationDone = resuming;
        let stored_count = leftover;

        if (resuming) {
            await log(`Resuming — ${leftover} names already generated`, 'success');
        } else {
            await log(`Generating ${run.targetCount} names`);
        }

        const generating = resuming
            ? Promise.resolve(
                  (
                      await Candidate.find({ where: { runId: run.id }, order: { position: 'ASC' } })
                  ).map((c) => ({
                      name: c.name,
                      rationale: c.rationale ?? '',
                      strategy: (c.strategy ?? 'compound') as never
                  }))
              )
            : generateNames(
                  run.brief,
                  (run.strategies ?? ['compound']) as never,
                  run.targetCount,
                  async (fresh, total) => {
                      if (fresh.length > 0) {
                          await Candidate.insert(
                              fresh.map((g, i) => ({
                                  runId: run.id,
                                  name: g.name,
                                  rationale: g.rationale,
                                  strategy: g.strategy,
                                  position: stored_count + i
                              }))
                          );
                          stored_count += fresh.length;
                      }
                      await Run.update(run.id, { generatedCount: total });
                      await log(`Generated ${total} of ${run.targetCount}`);
                  },
                  async (reason) => log(`Generation: ${reason}`, 'warn')
              );

        const required = {
            com: run.requireCom,
            appStore: run.requireAppStore,
            playStore: run.requirePlayStore,
            google: run.requireGoogle
        };

        let checked = 0;

        const kinds = fastChecks();
        const deferWeb = !kinds.includes('google');

        /** Drain names as they appear, and keep draining until generation is over. */
        const checking = (async () => {
            await log(`Checking as names arrive — ${kinds.map((k) => CHECK_LABEL[k]).join(', ')}`);

            let borrowed = 0;

            const one = async (candidate: { id: string; name: string }) => {
                const result = await checkCandidate(
                    candidate.name,
                    required,
                    kinds,
                    async (n, k) => {
                        const found = await priorVerdict(n, k, run.id);
                        if (found) {
                            borrowed++;
                        }
                        return found;
                    }
                );
                await Candidate.update(candidate.id, {
                    com: result.statuses.com,
                    appStore: result.statuses.appStore,
                    playStore: result.statuses.playStore,
                    /*
                     * When the web check runs here, its own verdict stands.
                     *
                     * This previously wrote 'skipped' whenever anything had dropped the
                     * name — including when the web check was itself the thing that
                     * dropped it. A name rejected for having four companies trading under
                     * it displayed as though the check had never been made.
                     *
                     * checkCandidate already marks the checks an earlier gate cut short as
                     * 'skipped', so its answer needs no correcting.
                     */
                    google: deferWeb
                        ? result.droppedBy
                            ? 'skipped'
                            : 'pending'
                        : result.statuses.google,
                    detail: result.detail,
                    passed: result.passed,
                    droppedBy: result.droppedBy,
                    checkedAt: new Date()
                });
                checked++;
                // Written per name, not per batch: the page polls this, and a counter
                // that only moves every two dozen names reads as a stall.
                await Run.update(run.id, { checkedCount: checked });
                if (result.droppedBy) {
                    // Name what was found, not just that something was. A line saying a
                    // name is taken is an assertion; one naming the listing is evidence.
                    const found = result.detail[result.droppedBy]?.split(' | ')[0]?.slice(0, 60);
                    await log(
                        `${candidate.name} — taken on ${CHECK_LABEL[result.droppedBy]}` +
                            (found ? `: ${found}` : '')
                    );
                }
            };

            for (;;) {
                const batch = await Candidate.find({
                    where: { runId: run.id, com: 'pending' as never },
                    order: { position: 'ASC' },
                    take: CHECK_CONCURRENCY * 3
                });

                if (batch.length === 0) {
                    if (generationDone) {
                        return;
                    }
                    await sleep(2000);
                    continue;
                }

                // Fixed pool: as one name finishes, the next starts. The shared limiters
                // keep each service to its own pace regardless of how many are in flight.
                let cursor = 0;
                await Promise.all(
                    Array.from({ length: Math.min(CHECK_CONCURRENCY, batch.length) }, async () => {
                        for (let next = cursor++; next < batch.length; next = cursor++) {
                            const candidate = batch[next];
                            if (candidate) {
                                await one(candidate);
                            }
                        }
                    })
                );
                await log(
                    `Checked ${checked}` +
                        (borrowed > 0 ? ` — ${borrowed} verdicts reused from earlier runs` : '')
                );
            }
        })();

        const generated = await generating;
        generationDone = true;

        if (generated.length === 0) {
            const reason =
                'Generation produced no names. Usually the Claude usage limit — check the warnings above; ' +
                'otherwise confirm the CLI is signed in with `claude login`.';
            await log(reason, 'error');
            await Run.update(run.id, { status: 'failed', error: reason, finishedAt: new Date() });
            return;
        }

        // The stored count, not the requested one: concurrent batches overshoot and
        // every name they produced is kept, so '1042 of 1000' was the denominator
        // being wrong rather than the numerator.
        await Run.update(run.id, {
            status: 'checking',
            generatedCount: await Candidate.countBy({ runId: run.id })
        });
        await checking;
        const stored = await Candidate.find({ where: { runId: run.id } });

        // Phase two. Only survivors are here, which is what makes a minute apiece
        // affordable — the funnel has already removed most of the field.
        const queued =
            stored.length - (await Candidate.countBy({ runId: run.id, google: 'skipped' }));
        if (deferWeb && queued > 0) {
            await log(`Web check queue: ${queued} names survived the earlier gates`, 'success');
            const { resolved, abandoned } = await drainWebQueue(
                Candidate,
                run.id,
                required,
                async (done, total, note) => {
                    if (note) {
                        await log(note, 'warn');
                    } else if (done % 10 === 0) {
                        await log(`Web check ${done} of ${total}`);
                    }
                }
            );
            await log(
                `Web checks done — ${resolved} resolved` +
                    (abandoned ? `, ${abandoned} left unverified` : ''),
                abandoned ? 'warn' : 'success'
            );
        }

        const survivors = await Candidate.find({
            where: { runId: run.id, passed: true },
            order: { position: 'ASC' }
        });

        await Run.update(run.id, { status: 'done', finishedAt: new Date() });

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
        if (mail.sent) {
            await Run.update(run.id, { notifiedAt: new Date() });
        }

        await log(
            `Finished — ${survivors.length} of ${stored.length} names passed every requirement`,
            'success'
        );
        if (!mail.sent) {
            await log(`Results email failed: ${mail.reason}`, 'error');
        } else {
            await log(`Results emailed to ${run.email}`, 'success');
        }
    }
}

async function main() {
    await db();
    console.log('worker ready; polling for queued runs');
    for (;;) {
        try {
            const run = await claimNext();
            if (run) {
                await processRun(run);
            } else {
                await sleep(POLL_MS);
            }
        } catch (error) {
            console.error('worker error:', (error as Error).message);
            await sleep(POLL_MS);
        }
    }
}

process.on('SIGINT', () => {
    void closeBrowser().finally(() => {
        process.exit(0);
    });
});

void main();
