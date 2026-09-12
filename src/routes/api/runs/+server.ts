import { json, error } from '@sveltejs/kit';
import { IsNull, Not } from 'typeorm';
import { z } from 'zod';
import { isPlatform } from '$lib/handles';
import { isLanguage } from '$lib/languages';
import { searchConfigured } from '$lib/search';
import { db } from '$lib/server/db';
import { mailConfigured } from '$lib/server/email';
import { Run } from '$lib/server/entities/run';
import { Verification } from '$lib/server/entities/verification';
import { issueCode } from '$lib/server/verification';
import { isTld } from '$lib/tlds';
import { NAME_PATTERN, OWN_NAMES_MAX, STORE_ORDER, STRATEGIES, type StrategyId } from '$lib/types';
import type { RequestHandler } from './$types';

const ids = STRATEGIES.map((s) => s.id) as [StrategyId, ...StrategyId[]];

const Body = z.object({
    brief: z.string().min(12).max(2000),
    strategies: z.array(z.enum(ids)).min(1),
    /** Empty means any, which is what 'Other languages' meant all along. */
    languages: z.array(z.string().refine(isLanguage, 'not a language this offers')).default([]),
    /**
     * Names the person brought with them, to be checked alongside the rest.
     *
     * Held to the same shape as a generated name, because they go through the
     * same checks: a domain lookup cannot be asked about 'My Great Idea!'. The
     * form parses the box with parseOwnNames and tells them what it dropped, so
     * anything arriving here that fails is a caller ignoring that, not a person
     * being surprised.
     */
    ownNames: z
        .array(z.string().refine((n) => NAME_PATTERN.test(n), 'letters only, 3 to 16 of them'))
        .max(OWN_NAMES_MAX)
        .default([]),
    /**
     * Which domains to check, and which of those must be free.
     *
     * No ceiling. Domain checks are the cheapest thing in the pipeline and
     * queue against nobody's quota, so a long list costs the person running it
     * time and costs everybody else nothing — which makes it their call. Each
     * entry is still checked against the list of TLDs a registrar carries, so
     * the array cannot be filled with things that do not exist.
     */
    tlds: z.array(z.string().refine(isTld, 'not a domain anybody can register')),
    requiredTlds: z.array(z.string()),
    /**
     * Social platforms to check the name as a handle on.
     *
     * A short list by necessity — see $lib/handles for why Instagram and
     * TikTok are not on it — so no cap is needed and none is imposed.
     */
    handles: z.array(z.string().refine(isPlatform, 'not a platform this can check')),
    requiredHandles: z.array(z.string()),
    /** The stores and the web check, on the same footing as the other two. */
    stores: z.array(z.enum(STORE_ORDER)),
    requiredStores: z.array(z.string()),
    /** A column of search links, for a deployment that cannot run the check. */
    webLinks: z.boolean().default(false),
    requireAppStore: z.boolean(),
    requirePlayStore: z.boolean(),
    requireGoogle: z.boolean(),
    /**
     * Optional, because a deployment with no mail configured cannot verify an
     * address and has nowhere to send results. Required in the shape only when
     * it can be used — see below.
     *
     * An empty string is read as 'no address'. A form field that exists and was
     * left alone sends '', which is neither null nor an address, so the shape
     * rejected it before the no-mail branch below could decide it did not need
     * one — and the run was refused with 'That email address does not look
     * complete' on a deployment that never asks for an address at all.
     */
    email: z.preprocess(
        (given) => (typeof given === 'string' && given.trim() === '' ? null : given),
        z.email().nullish()
    ),
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
    languages: 'Pick languages from the list, or none for any.',
    email: 'That email address does not look complete.',
    targetCount: 'Ask for a whole number between 50 and 2000 names.',
    tlds: 'Every domain has to be one a registrar actually carries.',
    requiredTlds: 'A domain can only be required if it is also being checked.',
    handles: 'Handles can only be checked on GitHub, X and YouTube.',
    requiredHandles: 'A handle can only be required if it is also being checked.',
    stores: 'The only stores this can check are the App Store, Google Play and the web.',
    requiredStores: 'A store can only be required if it is also being checked.',
    google:
        'The web check needs a search provider. Without one you can still show a ' +
        'column of search links.'
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
    const strayHandles = parsed.data.requiredHandles.filter(
        (id) => !parsed.data.handles.includes(id)
    );
    if (strayHandles.length > 0) {
        error(400, SAID_PLAINLY.requiredHandles);
    }
    /*
     * The web check cannot be asked for when nothing can answer it.
     *
     * Without a provider the only honest options are 'do not look' and 'give
     * me a link to look myself'. Accepting the check anyway would queue a
     * thousand names against a browser at about one a minute, which is a
     * sixteen-hour run nobody asked for.
     */
    if (!searchConfigured() && parsed.data.stores.includes('google')) {
        error(400, SAID_PLAINLY.google);
    }

    const strayStores = parsed.data.requiredStores.filter(
        (id) => !parsed.data.stores.includes(id as (typeof STORE_ORDER)[number])
    );
    if (strayStores.length > 0) {
        error(400, SAID_PLAINLY.requiredStores);
    }

    /*
     * No mail, no address, no verification.
     *
     * The code exists to stop anybody queueing work against somebody else's
     * inbox. With no way to send one there is nothing to prove, and asking for
     * an address anyway would be collecting a detail nothing can use — so a
     * run here starts immediately and the form never asks.
     */
    if (!mailConfigured()) {
        await db();
        const { email: _ignored, ...settings } = parsed.data;
        const run = await Run.create({
            ...settings,
            email: null,
            status: 'queued' as const,
            emailVerified: false
        }).save();
        return json({ id: run.id, verified: true });
    }

    if (!parsed.data.email) {
        error(400, SAID_PLAINLY.email);
    }
    const email = parsed.data.email;

    await db();

    /*
     * An address that has already proved itself does not prove itself again.
     *
     * The code exists so nobody can queue work against somebody else's inbox.
     * Once an address has consumed one, that is established, and asking again
     * on every run is a chore that protects nothing.
     */
    const proven = await Verification.findOne({
        where: { email, consumedAt: Not(IsNull()) },
        order: { consumedAt: 'DESC' }
    });

    if (proven) {
        const run = await Run.create({
            ...parsed.data,
            email,
            status: 'queued' as const,
            emailVerified: true
        }).save();
        return json({ id: run.id, verified: true });
    }

    const run = await Run.create({
        ...parsed.data,
        email,
        status: 'awaiting_verification' as const,
        emailVerified: false
    }).save();

    const { sent, reason } = await issueCode(run.id, email);
    // The reason travels to the client: a run whose code never arrived is
    // otherwise indistinguishable from one the user simply has not opened yet.
    return json({ id: run.id, verified: false, emailSent: sent, emailProblem: reason });
};
