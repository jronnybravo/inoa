import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { db } from '$lib/server/db';
import { RunEntity } from '$lib/server/entities/run';
import { CandidateEntity } from '$lib/server/entities/candidate';
import { CHECK_ORDER, type CheckKind } from '$lib/types';
import { checkCandidate, computePassed } from '../../../../../../worker/pipeline.ts';

/**
 * Re-run the checks for one name, on demand.
 *
 * Unlike a run, this is small enough to do inline: four requests at most, and
 * usually fewer. It exists because a verdict is a reading of somebody else's
 * search results at one moment — listings appear, domains lapse, a rate limit
 * turns a real answer into 'unverified' — and the person looking at the row is
 * the one who knows it is worth asking again.
 *
 * With no body it runs whatever the run requires. Pass a kind to run one.
 */
export const POST: RequestHandler = async ({ params, request }) => {
  const source = await db();
  const candidates = source.getRepository(CandidateEntity);

  const candidate = await candidates.findOneBy({ id: params.id });
  if (!candidate) error(404, 'No such candidate');

  const run = await source.getRepository(RunEntity).findOneBy({ id: candidate.runId });
  if (!run) error(404, 'No such run');

  const body = (await request.json().catch(() => ({}))) as { kind?: CheckKind };
  const required = {
    com: run.requireCom,
    appStore: run.requireAppStore,
    playStore: run.requirePlayStore,
    google: run.requireGoogle
  };

  // A run with no requirements would otherwise check nothing at all.
  const settingsKinds = CHECK_ORDER.filter((k) => required[k]);
  const kinds: CheckKind[] = body.kind
    ? [body.kind]
    : settingsKinds.length > 0
      ? settingsKinds
      : CHECK_ORDER;

  const result = await checkCandidate(candidate.name, required, kinds);

  // Only the checks that ran are overwritten; the rest keep their verdicts.
  const merged = {
    com: result.statuses.com ?? candidate.com,
    appStore: result.statuses.appStore ?? candidate.appStore,
    playStore: result.statuses.playStore ?? candidate.playStore,
    google: result.statuses.google ?? candidate.google
  };

  await candidates.update(candidate.id, {
    ...merged,
    detail: { ...candidate.detail, ...result.detail },
    passed: computePassed(merged, required),
    droppedBy: result.droppedBy ?? candidate.droppedBy,
    checkedAt: new Date()
  });

  return json({
    id: candidate.id,
    ...merged,
    detail: { ...candidate.detail, ...result.detail },
    passed: computePassed(merged, required),
    ran: kinds
  });
};
