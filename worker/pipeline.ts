/**
 * The checking funnel.
 *
 * Checks run cheapest-first — .com, App Store, Play Store, then web — because
 * the expensive ones are the rate-limited ones. Apple tolerates roughly 20
 * calls a minute and the web tier costs a browser or an API credit, so every
 * name the .com gate drops is a name they never have to see.
 *
 * A REQUIRED check that comes back 'taken' drops the name immediately and the
 * remaining checks are marked skipped. An unrequired check never drops a name;
 * it is recorded and the funnel continues, so the results table is complete for
 * everything that survives.
 *
 * 'unknown' never drops a name and never counts as a pass. We did not find a
 * collision, but we did not establish there isn't one, and quietly promoting
 * that to 'clear' is exactly the bug that let 500 names through unchecked.
 *
 * The web check does not run here. It is drained separately and far more
 * slowly — see worker/webqueue.ts for why.
 */

import { CHECK_ORDER, type CheckKind, type CheckStatus } from '../src/lib/types.ts';
import { checkCom } from './checks/domain.ts';
import { checkAppStore } from './checks/appstore.ts';
import { checkPlayStore } from './checks/playstore.ts';
import { checkWeb } from './checks/web.ts';
import { jitter, sleep, type CheckOutcome } from './checks/shared.ts';

const RUNNERS: Record<CheckKind, (name: string) => Promise<CheckOutcome>> = {
  com: checkCom,
  appStore: checkAppStore,
  playStore: checkPlayStore,
  google: checkWeb
};

/** Apple is the tightest limit, so it sets the pace between names. */
const PACE: Record<CheckKind, number> = {
  com: 150,
  appStore: 3200,
  playStore: 1200,
  google: 800
};

export interface Requirements {
  com: boolean;
  appStore: boolean;
  playStore: boolean;
  google: boolean;
}

export interface CandidateResult {
  statuses: Partial<Record<CheckKind, CheckStatus>>;
  detail: Partial<Record<CheckKind, string>>;
  /** null while a required check has not answered yet. */
  passed: boolean | null;
  droppedBy: CheckKind | null;
}

/**
 * Did every required check positively clear this name?
 *
 * A check still pending is not a pass, so this returns null while any required
 * check has yet to answer — which is what keeps a name out of the results
 * email until the slow web queue has actually reached it.
 */
export function computePassed(
  statuses: Partial<Record<CheckKind, CheckStatus>>,
  required: Requirements
): boolean | null {
  const relevant = CHECK_ORDER.filter((kind) => required[kind]);
  if (relevant.some((kind) => (statuses[kind] ?? 'pending') === 'pending')) return null;
  return relevant.every((kind) => statuses[kind] === 'clear');
}

export async function checkCandidate(
  name: string,
  required: Requirements,
  kinds: CheckKind[] = CHECK_ORDER
): Promise<CandidateResult> {
  const statuses = {} as Record<CheckKind, CheckStatus>;
  const detail: Partial<Record<CheckKind, string>> = {};
  let droppedBy: CheckKind | null = null;

  for (const kind of CHECK_ORDER) {
    // Checks this pass is not responsible for keep whatever state they hold.
    if (!kinds.includes(kind)) continue;

    if (droppedBy) {
      statuses[kind] = 'skipped';
      continue;
    }

    const outcome = await RUNNERS[kind](name);
    statuses[kind] = outcome.status;
    if (outcome.detail) detail[kind] = outcome.detail;

    if (required[kind] && outcome.status === 'taken') droppedBy = kind;
    await sleep(jitter(PACE[kind]));
  }

  return { statuses, detail, passed: computePassed(statuses, required), droppedBy };
}
