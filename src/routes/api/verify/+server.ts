import type { RequestHandler } from './$types';
import { json, error } from '@sveltejs/kit';
import { db } from '$lib/server/db';
import { Run } from '$lib/server/entities/run';
import { Verification } from '$lib/server/entities/verification';

const MAX_ATTEMPTS = 6;

export const POST: RequestHandler = async ({ request }) => {
    const { runId, code } = (await request.json()) as { runId?: string; code?: string };
    if (!runId || !code) error(400, 'Missing runId or code');

    await db();
    const record = await Verification.findOne({
        where: { runId },
        order: { createdAt: 'DESC' }
    });

    if (!record) error(404, 'No verification pending for this request');
    if (record.consumedAt) error(400, 'That code was already used');
    if (record.expiresAt < new Date()) error(400, 'That code has expired');
    // Bounded so six digits cannot be walked through.
    if (record.attempts >= MAX_ATTEMPTS) error(429, 'Too many attempts; start a new request');

    if (record.code !== code.trim()) {
        await Verification.update(record.id, { attempts: record.attempts + 1 });
        error(400, 'That code is not right');
    }

    await Verification.update(record.id, { consumedAt: new Date() });
    // Verification is what moves a run into the worker's queue.
    await Run.update(runId, { emailVerified: true, status: 'queued' });

    return json({ ok: true });
};
