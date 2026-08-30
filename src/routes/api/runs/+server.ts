import type { RequestHandler } from './$types';
import { json, error } from '@sveltejs/kit';
import { randomInt } from 'node:crypto';
import { z } from 'zod';
import { db } from '$lib/server/db';
import { RunEntity } from '$lib/server/entities/run';
import { VerificationEntity } from '$lib/server/entities/verification';
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
  targetCount: z.number().int().min(50).max(2000).default(1000)
});

export const POST: RequestHandler = async ({ request }) => {
  const parsed = Body.safeParse(await request.json());
  if (!parsed.success) error(400, parsed.error.issues[0]?.message ?? 'Invalid request');

  const source = await db();
  const runs = source.getRepository(RunEntity);

  const run = await runs.save(
    runs.create({ ...parsed.data, status: 'awaiting_verification', emailVerified: false })
  );

  // Six digits, from a CSPRNG rather than Math.random.
  const code = String(randomInt(0, 1_000_000)).padStart(6, '0');
  await source.getRepository(VerificationEntity).save({
    runId: run.id,
    email: run.email,
    code,
    expiresAt: new Date(Date.now() + 20 * 60_000)
  });

  const sent = await sendVerificationCode(run.email, code);
  return json({ id: run.id, emailSent: sent });
};
