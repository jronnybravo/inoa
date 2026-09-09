import { searchConfigured } from '$lib/search';
import { db } from '$lib/server/db';
import { mailConfigured } from '$lib/server/email';
import { Candidate } from '$lib/server/entities/candidate';
import { Run } from '$lib/server/entities/run';
import { candidateView, runView } from '$lib/server/views';
import type { PageServerLoad } from './$types';

/**
 * The page is one route in two states, keyed on ?requestid=. Without it you get
 * an editable form; with it the same fields render locked, above the results as
 * they arrive.
 */
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
        return { run: null, mail, search };
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
