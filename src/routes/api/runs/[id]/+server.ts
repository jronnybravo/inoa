import type { RequestHandler } from './$types';
import { json, error } from '@sveltejs/kit';
import { MoreThan } from 'typeorm';
import { db } from '$lib/server/db';
import { RunEntity } from '$lib/server/entities/run';
import { CandidateEntity } from '$lib/server/entities/candidate';
import { RunEventEntity } from '$lib/server/entities/event';

/**
 * The polling endpoint. Deliberately a plain read: a streaming response would
 * hold a Vercel function open and reintroduce the duration cap this whole
 * architecture exists to avoid.
 */
export const GET: RequestHandler = async ({ params, url }) => {
  const source = await db();
  const run = await source.getRepository(RunEntity).findOneBy({ id: params.id });
  if (!run) error(404, 'No such request');

  // The console is append-only, so the page asks only for lines it has not
  // seen. A long run produces thousands and re-sending them every 2.5s is
  // bandwidth spent on text the browser already has.
  //
  // `since` alone is not enough to prevent repeats: Postgres keeps microseconds
  // and a JS Date keeps milliseconds, so a timestamp that survives the round
  // trip is fractionally EARLIER than the row it came from and matches it
  // again. Each line carries its id and the client drops ones it already has.
  const since = url.searchParams.get('since');
  const events = await source.getRepository(RunEventEntity).find({
    where: since ? { runId: run.id, at: MoreThan(new Date(since)) } : { runId: run.id },
    order: { at: 'ASC' },
    take: 500
  });

  const onlyPassed = url.searchParams.get('passed') === '1';
  const candidates = await source.getRepository(CandidateEntity).find({
    where: onlyPassed ? { runId: run.id, passed: true } : { runId: run.id },
    order: { position: 'ASC' },
    take: 2000
  });

  const { email, ...safe } = run;
  return json({
    run: { ...safe, email: email.replace(/(.).*(@.*)/, '$1•••$2') },
    events: events.map((e) => ({ id: e.id, at: e.at, level: e.level, message: e.message })),
    candidates: candidates.map((c) => ({
      id: c.id,
      name: c.name,
      rationale: c.rationale,
      strategy: c.strategy,
      com: c.com,
      appStore: c.appStore,
      playStore: c.playStore,
      google: c.google,
      detail: c.detail,
      passed: c.passed,
      droppedBy: c.droppedBy
    }))
  });
};
