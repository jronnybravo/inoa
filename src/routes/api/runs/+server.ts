import { randomInt } from 'node:crypto';
import { json, error } from '@sveltejs/kit';
import { IsNull, Not } from 'typeorm';
import { z } from 'zod';
import { db } from '$lib/server/db';
import { sendVerificationCode } from '$lib/server/email';
import { Run } from '$lib/server/entities/run';
import { Verification } from '$lib/server/entities/verification';
import { isTld } from '$lib/tlds';
import { STRATEGIES, type StrategyId } from '$lib/types';
import type { RequestHandler } from './$types';

const ids = STRATEGIES.map((s) => s.id) as [StrategyId, ...StrategyId[]];

const Body = z.object({
    brief: z.string().min(12).max(2000),
    strategies: z.array(z.enum(ids)).min(1),
    /**
     * Which domains to check, and which of those must be free.
     *
     * Capped at twelve because each one is a request per name: at a thousand
     * names, twelve TLDs is twelve thousand. Nobody's quota is spent on them,
     * but the person's afternoon is.
     */
    tlds: z.array(z.string().refine(isTld, 'not a domain anybody can register')).max(12),
    requiredTlds: z.array(z.string()),
    requireAppStore: z.boolean(),
    requirePlayStore: z.boolean(),
    requireGoogle: z.boolean(),
    email: z.email(),
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

/**
 * The same rules the form states, in the same words.
 *
 * Zod reports a failure as 'Too small: expected string to have >=12
 * characters', which is a sentence for whoever is reading a stack trace. The
 * form checks all of this before it sends anything, so reaching here means a
 * request that did not come from the form - but it still gets an answer a
 * person could act on rather than a validator's internal phrasing.
 */
const SAID_PLAINLY: Record<string, string> = {
    brief: 'The brief needs to be between 12 and 2000 characters.',
    strategies: 'Choose at least one naming strategy.',
    email: 'That email address does not look complete.',
    targetCount: 'Ask for a whole number between 50 and 2000 names.',
    tlds: 'Choose up to twelve domains, all of them real ones.',
    requiredTlds: 'A domain can only be required if it is also being checked.'
};

export const POST: RequestHandler = async ({ request }) => {
    const parsed = Body.safeParse(await request.json());
    if (!parsed.success) {
        const first = parsed.error.issues[0];
        const field = String(first?.path[0] ?? '');
        error(400, SAID_PLAINLY[field] ?? 'That request was not something a run can be made from.');
    }

    /*
     * Required is a subset of checked, enforced rather than assumed.
     *
     * A TLD required but not checked can never come back clear, so every name
     * in the run would fail for a reason no column could show.
     */
    const stray = parsed.data.requiredTlds.filter((tld) => !parsed.data.tlds.includes(tld));
    if (stray.length > 0) {
        error(400, SAID_PLAINLY.requiredTlds);
    }

    await db();

    /*
     * An address that has already proved itself does not prove itself again.
     *
     * The code exists so nobody can queue work against somebody else's inbox.
     * Once an address has consumed one, that is established, and asking again
     * on every run is a chore that protects nothing.
     */
    const proven = await Verification.findOne({
        where: { email: parsed.data.email, consumedAt: Not(IsNull()) },
        order: { consumedAt: 'DESC' }
    });

    if (proven) {
        const run = await Run.create({
            ...parsed.data,
            status: 'queued' as const,
            emailVerified: true
        }).save();
        return json({ id: run.id, verified: true });
    }

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
    return json({ id: run.id, verified: false, emailSent: sent, emailProblem: reason });
};
