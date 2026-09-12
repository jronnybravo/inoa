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
import { IsNull, LessThan } from 'typeorm';
import { candidateStatuses, runChecks, statusColumns } from '../src/lib/checks.ts';
import { languagesCovered } from '../src/lib/languages.ts';
import { db } from '../src/lib/server/db.ts';
import { sendResults } from '../src/lib/server/email.ts';
import { Candidate } from '../src/lib/server/entities/candidate.ts';
import { Run } from '../src/lib/server/entities/run.ts';
import { OWN_SOURCE, checkLabel, type CheckKind } from '../src/lib/types.ts';
import { CHECKER_VERSION, priorVerdict } from './checks/reuse.ts';
import { sleep } from './checks/shared.ts';
import { closeBrowser } from './checks/web.ts';
import { claimable } from './claim.ts';
import { generateNames } from './generate.ts';
import { makeLogger } from './log.ts';
import { checkCandidate, defersWeb, fastChecks } from './pipeline.ts';
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
        where: claimable(cutoff) as never,
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

    /*
     * The lease renewal doubles as the stop signal.
     *
     * Stopping is written to the row by whoever asked for it, so the worker
     * has to read it back to find out. The heartbeat is already the one thing
     * touching this row on a timer, so it is where the question gets asked -
     * a second poller would be a second thing to keep alive and a second
     * thing to leak.
     *
     * The cost is that a stop takes effect within a heartbeat rather than
     * instantly. At a few seconds a name that is a handful of extra checks,
     * which is a fair price for not polling the database every second of
     * every run.
     */
    const stopping = new AbortController();
    const heartbeat = setInterval(() => {
        void (async () => {
            try {
                await Run.update(run.id, { claimedAt: new Date() });
                const current = await Run.findOneBy({ id: run.id });
                if (current?.status === 'stopped') {
                    stopping.abort();
                }
            } catch {
                // A missed beat is survivable; the next one asks again.
            }
        })();
    }, HEARTBEAT_MS);

    try {
        await runProcess(stopping.signal);
    } finally {
        clearInterval(heartbeat);
    }

    /**
     * Leave a stopped run readable rather than mid-sentence.
     *
     * The names and verdicts already found are kept - they cost real calls
     * against real rate limits, and they are the reason somebody would look at
     * a stopped run at all. Only the fact that nobody is working on it any
     * more is recorded.
     */
    async function concludeStopped(): Promise<void> {
        const kept = await Candidate.countBy({ runId: run.id });
        const checkedSoFar = await Candidate.countBy({ runId: run.id, passed: true });
        await Run.update(run.id, { status: 'stopped', finishedAt: new Date() });
        // The last line names what did not happen, because 'stopped' on its
        // own reads as though the whole worker went down with it.
        await log(
            `Stopped on request — ${kept} names kept, ${checkedSoFar} passing so far. ` +
                'The worker is free and will take the next queued run.',
            'warn'
        );
    }

    async function runProcess(stop: AbortSignal) {
        /*
         * Read through a call, not the property.
         *
         * `stop.aborted` is a boolean the control-flow analysis is happy to
         * narrow: after one `if (stop.aborted) return`, every later check is
         * "always falsy" as far as the compiler is concerned. It is not - the
         * whole point is that it flips underneath us - and a call is opaque to
         * that narrowing.
         */
        const stopped = (): boolean => stop.aborted;
        /**
         * Top up. Never start over.
         *
         * A half-generated set used to be deleted and regenerated, on the
         * grounds that topping it up needed an exclusion list that died with
         * the process. It did not — the names are rows, and reading them back
         * is one query. Deleting them threw away real model calls to avoid a
         * SELECT.
         *
         * Which is also what 'find more' asks for: the same run, its target
         * raised, everything already found kept. One rule covers both, so
         * there is no mode to get wrong.
         */
        let held = await Candidate.find({
            where: { runId: run.id },
            order: { position: 'ASC' }
        });

        /*
         * The names the person brought with them, seeded once.
         *
         * Here rather than at the point the run was created, so one path owns
         * the creation of a candidate row and a run claimed twice cannot seed
         * them twice — the filter against what is already stored is what makes
         * that safe, and it is the same filter that stops a topped-up run
         * adding them again.
         */
        const known = new Set(held.map((c) => c.name.toLowerCase()));
        const bringing = (run.ownNames ?? []).filter((n) => !known.has(n.toLowerCase()));
        if (bringing.length > 0) {
            await Candidate.insert(
                bringing.map((name, i) => ({
                    runId: run.id,
                    name,
                    rationale: null,
                    // Neither generated nor composed: nothing chose an approach
                    // for it, and saying 'compound' would be inventing a story.
                    strategy: null,
                    source: OWN_SOURCE,
                    position: held.length + i
                }))
            );
            await log(
                `Checking ${bringing.length} name${bringing.length === 1 ? '' : 's'} you brought`,
                'success'
            );
            held = await Candidate.find({
                where: { runId: run.id },
                order: { position: 'ASC' }
            });
        }

        /*
         * Only what was generated counts towards the target.
         *
         * targetCount asks how many names to GENERATE. A shortlist somebody
         * already had is not generation, and counting it would quietly hand
         * back fewer names than the number on the form — twenty of your own
         * would make a fifty-name run generate thirty.
         */
        const leftover = held.filter((c) => c.source !== OWN_SOURCE).length;
        const wanted = Math.max(0, run.targetCount - leftover);
        const resuming = wanted === 0;

        /**
         * Generation and checking run together.
         *
         * A name is checkable the moment it exists, and the two halves contend for
         * nothing: generation waits on one service, the checks wait on others. Run in
         * sequence they added up; run together the checking is nearly free, because
         * it happens inside time that was already being spent waiting.
         */
        let generationDone = resuming;
        // Positions run across every row, brought names included.
        let stored_count = held.length;

        if (resuming) {
            await log(`Resuming — ${leftover} names already generated`, 'success');
        } else if (leftover > 0) {
            await log(`Adding ${wanted} names to the ${leftover} already found`, 'success');
        } else {
            await log(`Generating ${run.targetCount} names`);
        }

        const generating = resuming
            ? Promise.resolve(
                  held.map((c) => ({
                      name: c.name,
                      rationale: c.rationale ?? '',
                      strategy: (c.strategy ?? 'compound') as never,
                      source: c.source ?? ''
                  }))
              )
            : generateNames(
                  run.brief,
                  (run.strategies ?? ['compound']) as never,
                  wanted,
                  languagesCovered(run.languages ?? []),
                  async (fresh, total) => {
                      if (fresh.length > 0) {
                          await Candidate.insert(
                              fresh.map((g, i) => ({
                                  runId: run.id,
                                  name: g.name,
                                  rationale: g.rationale,
                                  strategy: g.strategy,
                                  source: g.source,
                                  position: stored_count + i
                              }))
                          );
                          stored_count += fresh.length;
                      }
                      await Run.update(run.id, { generatedCount: leftover + total });
                      await log(`Generated ${leftover + total} of ${run.targetCount}`);
                  },
                  async (reason) => log(`Generation: ${reason}`, 'warn'),
                  held.map((c) => c.name),
                  // Read for taste, not just avoided: the box under the brief
                  // says what this person likes the sound of, which the brief
                  // itself never does.
                  held.filter((c) => c.source === OWN_SOURCE).map((c) => c.name)
              );

        // Whichever TLDs this run asked for, plus the stores it required.
        const { kinds: all, required } = runChecks(run);

        /*
         * Seeded, not zeroed.
         *
         * The page reads this counter, and a run being topped up has already
         * checked everything it held — starting from zero would walk the
         * number backwards in front of somebody watching.
         */
        let checked = held.filter((c) => c.checkedAt).length;

        const kinds = fastChecks(all);
        const deferWeb = defersWeb(all);

        /** Drain names as they appear, and keep draining until generation is over. */
        const checking = (async () => {
            await log(`Checking as names arrive — ${kinds.map(checkLabel).join(', ')}`);

            let borrowed = 0;

            const one = async (candidate: { id: string; name: string }) => {
                /*
                 * When each verdict was actually seen, kind by kind.
                 *
                 * Anything checked here was seen now; anything borrowed keeps
                 * the time of the original sighting, so the next run ages it
                 * from there. Writing 'now' for a borrowed verdict is what made
                 * the reuse window unable to expire — see reuse.ts.
                 */
                const now = new Date();
                const observedAt: Partial<Record<CheckKind, string>> = Object.fromEntries(
                    kinds.map((k) => [k, now.toISOString()])
                );

                const result = await checkCandidate(
                    candidate.name,
                    required,
                    kinds,
                    async (n, k) => {
                        const found = await priorVerdict(n, k, run.id);
                        if (found) {
                            borrowed++;
                            observedAt[k] = found.observedAt;
                        }
                        return found;
                    },
                    all
                );
                const columns = statusColumns(result.statuses);
                await Candidate.update(candidate.id, {
                    ...columns,
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
                    google: deferWeb ? (result.droppedBy ? 'skipped' : 'pending') : columns.google,
                    detail: result.detail,
                    observedAt,
                    checkerVersion: CHECKER_VERSION,
                    passed: result.passed,
                    droppedBy: result.droppedBy,
                    checkedAt: now
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
                        `${candidate.name} — taken on ${checkLabel(result.droppedBy)}` +
                            (found ? `: ${found}` : '')
                    );
                }
            };

            for (;;) {
                if (stopped()) {
                    return;
                }
                /*
                 * Unchecked means unstamped, not '.com still pending'.
                 *
                 * The old query asked for a pending .com, which stopped being
                 * a question once a run could decline to check the .com at all
                 * — every name would have looked unchecked forever.
                 */
                const batch = await Candidate.find({
                    where: { runId: run.id, checkedAt: IsNull() },
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
                            // Checked per name, not per batch: a batch is up to
                            // three times the concurrency, and finishing one
                            // after a stop was asked for is the wait the person
                            // asking is watching.
                            if (stopped()) {
                                return;
                            }
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

        /*
         * Every status write from here down is guarded, because 'stopped' is
         * already in the row by the time we notice it. An unguarded update
         * would move the run back to 'checking' or on to 'done' and quietly
         * un-stop it - the worker would exit, the row would claim to be
         * working, and the next worker would pick it up again.
         */
        if (stopped()) {
            await concludeStopped();
            return;
        }

        /*
         * The stored count, not the requested one: concurrent batches overshoot
         * and every name they produced is kept, so '1042 of 1000' was the
         * denominator being wrong rather than the numerator.
         *
         * Minus the ones nothing generated. Counting every row read a run that
         * brought four names of its own as '54 of 50 generated', which is a
         * claim about the model that the model had nothing to do with.
         * Subtracted rather than filtered, because `source` is null on every
         * row written before that column existed and SQL will not compare it.
         */
        const rows = await Candidate.countBy({ runId: run.id });
        const brought = await Candidate.countBy({ runId: run.id, source: OWN_SOURCE });
        await Run.update(run.id, {
            status: 'checking',
            generatedCount: rows - brought
        });
        await checking;
        if (stopped()) {
            await concludeStopped();
            return;
        }
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
                },
                undefined,
                stop
            );
            await log(
                `Web checks done — ${resolved} resolved` +
                    (abandoned ? `, ${abandoned} left unverified` : ''),
                abandoned ? 'warn' : 'success'
            );
        }

        if (stopped()) {
            await concludeStopped();
            return;
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
            survivors.map((c) => ({ name: c.name, statuses: candidateStatuses(c) })),
            all,
            `${APP_URL}/?requestid=${run.id}`
        );
        if (mail.sent) {
            await Run.update(run.id, { notifiedAt: new Date() });
        }

        await log(
            `Finished — ${survivors.length} of ${stored.length} names passed every requirement`,
            'success'
        );
        /*
         * No address is not a failure.
         *
         * A deployment with no Resend key never asked for one, so there is
         * nothing to report as broken — the results are on the page, which is
         * where they were always going to be. Only a run that had somewhere to
         * send to and could not is an error.
         */
        if (mail.sent) {
            await log(`Results emailed to ${run.email}`, 'success');
        } else if (run.email) {
            await log(`Results email failed: ${mail.reason}`, 'error');
        } else {
            await log('No address on this run — the results are on its page', 'info');
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
