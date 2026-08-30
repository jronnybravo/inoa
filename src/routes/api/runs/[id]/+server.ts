import { json, error } from '@sveltejs/kit';
import { db } from '$lib/server/db';
import { RunEntity } from '$lib/server/entities/run';
import { CandidateEntity } from '$lib/server/entities/candidate';

/**
 * The polling endpoint. Deliberately a plain read: a streaming response would
 * hold a Vercel function open and reintroduce the duration cap this whole
 * architecture exists to avoid.
 */
export async function GET({ params, url }) {
  const source = await db();
  const run = await source.getRepository(RunEntity).findOneBy({ id: params.id });
  if (!run) error(404, 'No such request');

  const onlyPassed = url.searchParams.get('passed') === '1';
  const candidates = await source.getRepository(CandidateEntity).find({
    where: onlyPassed ? { runId: run.id, passed: true } : { runId: run.id },
    order: { position: 'ASC' },
    take: 2000
  });

  const { email, ...safe } = run;
  return json({
    run: { ...safe, email: email.replace(/(.).*(@.*)/, '$1•••$2') },
    candidates: candidates.map((c) => ({
      id: c.id,
      name: c.name,
      rationale: c.rationale,
      com: c.com,
      appStore: c.appStore,
      playStore: c.playStore,
      google: c.google,
      detail: c.detail,
      passed: c.passed,
      droppedBy: c.droppedBy
    }))
  });
}
