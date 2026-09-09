import { runChecks } from '$lib/checks';
import { searchConfigured } from '$lib/search';
import { db } from '$lib/server/db';
import { mailConfigured } from '$lib/server/email';
import { Candidate } from '$lib/server/entities/candidate';
import { Run } from '$lib/server/entities/run';
import { candidateView, runView } from '$lib/server/views';
import { STORE_ORDER } from '$lib/types';
import type { RunSettings } from '$lib/types';
import type { PageServerLoad } from './$types';

/**
 * The page is one route in two states, keyed on ?requestid=. Without it you get
 * an editable form; with it the same fields render locked, above the results as
 * they arrive.
 */
/** Everything the form asks for, read off a run that already answered it. */
async function settingsOf(id: string): Promise<RunSettings | null> {
    try {
        await db();
        const run = await Run.findOneBy({ id });
        if (!run) {
            return null;
        }
        /*
         * Through runChecks, not off the columns.
         *
         * It is the one place that knows what a null tlds list means on a run
         * from before the TLDs were a choice, and what a null stores list
         * means on one from before the stores were. Reading the columns here
         * would be a second copy of that, and the older half of it is exactly
         * the half nobody would remember to update.
         */
        const { kinds, required } = runChecks(run);
        const named = (prefix: string, from: readonly string[]): string[] =>
            from.filter((k) => k.startsWith(prefix)).map((k) => k.slice(prefix.length));
        const stores = (from: readonly string[]): string[] =>
            STORE_ORDER.filter((kind) => from.includes(kind));

        return {
            brief: run.brief,
            strategies: run.strategies ?? [],
            languages: run.languages ?? [],
            tlds: named('tld:', kinds),
            requiredTlds: named('tld:', required),
            handles: named('at:', kinds),
            requiredHandles: named('at:', required),
            stores: stores(kinds),
            requiredStores: stores(required),
            webLinks: run.webLinks,
            targetCount: run.targetCount,
            // Never the address. It is masked everywhere else it is shown, and
            // an unmasked one here would be a way to read it back off a link.
            email: null
        };
    } catch {
        return null;
    }
}

export const load: PageServerLoad = async ({ url }) => {
    /*
     * Whether this deployment can send mail decides whether the form asks for
     * an address at all. Read here rather than guessed at in the browser: it
     * is an environment variable, and the page has no other way to know.
     */
    const mail = mailConfigured();
    // Whether the web check can run at all, which decides what the form offers.
    const search = searchConfigured();

    const id = url.searchParams.get('requestid');
    if (!id) {
        /*
         * ?from= is this same empty form with a run's settings already in it.
         *
         * 'Edit the options and run again' needs no second screen — editing
         * settings is what this form is, and the only thing missing was a way
         * to arrive with them filled in. A separate copy of every control
         * rendered somewhere else would be two forms to keep in step.
         */
        const from = url.searchParams.get('from');
        return { run: null, mail, search, prefill: from ? await settingsOf(from) : null };
    }

    try {
        await db();
        const run = await Run.findOneBy({ id });
        if (!run) {
            return { run: null, mail, search, notFound: true };
        }
        /*
         * The rows travel with the run.
         *
         * Sending the run alone meant a finished thousand-name run painted
         * '— passing' over an empty table until the first poll answered, two
         * and a half seconds later. That is the moment somebody arrives from
         * the results email, and it was answering 'nothing' before it answered
         * anything.
         */
        const candidates = await Candidate.find({
            where: { runId: run.id },
            order: { position: 'ASC' },
            take: 2000
        });

        return { run: runView(run), mail, search, candidates: candidates.map(candidateView) };
    } catch {
        // A missing DATABASE_URL should show the form, not a 500.
        return { run: null, mail, search };
    }
};
