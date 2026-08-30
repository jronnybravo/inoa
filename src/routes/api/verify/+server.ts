import { json, error } from '@sveltejs/kit';
import { db } from '$lib/server/db';
import { RunEntity } from '$lib/server/entities/run';
import { VerificationEntity } from '$lib/server/entities/verification';

const MAX_ATTEMPTS = 6;

export async function POST({ request }) {
  const { runId, code } = (await request.json()) as { runId?: string; code?: string };
  if (!runId || !code) error(400, 'Missing runId or code');

  const source = await db();
  const verifications = source.getRepository(VerificationEntity);
  const record = await verifications.findOne({
    where: { runId },
    order: { createdAt: 'DESC' }
  });

  if (!record) error(404, 'No verification pending for this request');
  if (record.consumedAt) error(400, 'That code was already used');
  if (record.expiresAt < new Date()) error(400, 'That code has expired');
  // Bounded so six digits cannot be walked through.
  if (record.attempts >= MAX_ATTEMPTS) error(429, 'Too many attempts; start a new request');

  if (record.code !== code.trim()) {
    await verifications.update(record.id, { attempts: record.attempts + 1 });
    error(400, 'That code is not right');
  }

  await verifications.update(record.id, { consumedAt: new Date() });
  // Verification is what moves a run into the worker's queue.
  await source
    .getRepository(RunEntity)
    .update(runId, { emailVerified: true, status: 'queued' });

  return json({ ok: true });
}
