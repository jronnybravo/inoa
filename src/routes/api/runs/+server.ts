import type { RequestHandler } from './$types';
import { json, error } from '@sveltejs/kit';
import { randomInt } from 'node:crypto';
import { z } from 'zod';
import { db } from '$lib/server/db';
import { Run } from '$lib/server/entities/run';
import { Verification } from '$lib/server/entities/verification';
import { sendVerificationCode } from '$lib/server/email';
import { STRATEGIES } from '$lib/types';

const ids = STRATEGIES.map((s) => s.id);

const Body = z.object({
  brief: z.string().min(12).max(2000),
  strategies: z.array(z.enum(ids as [string, ...string[]])).min(1),
  requireCom: z.boolean(),
  requireAppStore: z.boolean(),
  requirePlayStore: z.boolean(),
  requireGoogle: z.boolean(),
  email: z.string().email(),
  /**
   * A cost control, not a preference.
   *
   * Roughly half of every run's names reach the paid search tier — measured at
   * 585 of 1052 on a real run — and a free Tavily allowance is 1,000 searches
   * a month. The size of a run is therefore the main thing standing between a
   * curious afternoon and an exhausted quota.
   */
  targetCount: z.number().int().min(50).max(2000)
});

export const POST: RequestHandler = async ({ request }) => {
  const parsed = Body.safeParse(await request.json());
  if (!parsed.success) error(400, parsed.error.issues[0]?.message ?? 'Invalid request');

  await db();

  const run = await Run.create({
    ...parsed.data,
    status: 'awaiting_verification' as const,
    emailVerified: false
  }).save();

  // Six digits, from a CSPRNG rather than Math.random.
  const code = String(randomInt(0, 1_000_000)).padStart(6, '0');
  await Verification.create({
    runId: run.id,
    email: run.email,
    code,
    expiresAt: new Date(Date.now() + 20 * 60_000)
  }).save();

  const { sent, reason } = await sendVerificationCode(run.email, code);
  // The reason travels to the client: a run whose code never arrived is
  // otherwise indistinguishable from one the user simply has not opened yet.
  return json({ id: run.id, emailSent: sent, emailProblem: reason });
};
