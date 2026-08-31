import type { PageServerLoad } from './$types';
import { db } from '$lib/server/db';
import { Run } from '$lib/server/entities/run';

/**
 * The page is one route in two states, keyed on ?requestid=. Without it you get
 * an editable form; with it the same fields render locked, above the results as
 * they arrive.
 */
export const load: PageServerLoad = async ({ url }) => {
    const id = url.searchParams.get('requestid');
    if (!id) return { run: null };

    try {
        await db();
        const run = await Run.findOneBy({ id });
        if (!run) return { run: null, notFound: true };
        const { email, ...safe } = run;
        return { run: { ...safe, email: email.replace(/(.).*(@.*)/, '$1•••$2') } };
    } catch {
        // A missing DATABASE_URL should show the form, not a 500.
        return { run: null };
    }
};
