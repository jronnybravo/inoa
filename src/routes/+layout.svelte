<script lang="ts">
    import type { Snippet } from 'svelte';
    import { page } from '$app/state';
    import '../app.css';

    const { children }: { children: Snippet } = $props();

    /*
     * The long form, for a crawler and a link preview.
     *
     * The header carries a tagline instead — beside a product name there is
     * room for one line, and it should say what the thing is for rather than
     * recite its steps. This is where the steps belong, and it no longer names
     * the .com specifically now that a run chooses its own domains.
     */
    const DESCRIPTION =
        'Generate brand names from a brief, then screen each one against the places ' +
        'a name can already be taken: the domains you choose, the App Store, ' +
        'Google Play, and the web.';

    /*
     * Absolute, because a crawler will not resolve a relative one.
     *
     * Taken from the request rather than from PUBLIC_APP_URL so a preview
     * deployment advertises its own address instead of production's, and so
     * the tags are right on a fresh clone with nothing configured.
     */
    const image = $derived(`${page.url.origin}/og.png`);
</script>

<svelte:head>
    <title>Inoa</title>
    <meta name="description" content={DESCRIPTION} />

    <meta property="og:type" content="website" />
    <meta property="og:site_name" content="Inoa" />
    <meta property="og:title" content="Inoa" />
    <meta property="og:description" content={DESCRIPTION} />
    <meta property="og:url" content={page.url.href} />
    <meta property="og:image" content={image} />
    <meta property="og:image:width" content="2560" />
    <meta property="og:image:height" content="1280" />
    <meta property="og:image:alt" content="A finished naming run, with a verdict for every check" />

    <meta name="twitter:card" content="summary_large_image" />
    <meta name="twitter:title" content="Inoa" />
    <meta name="twitter:description" content={DESCRIPTION} />
    <meta name="twitter:image" content={image} />
</svelte:head>

<div class="min-h-screen bg-stone-50 text-stone-900 dark:bg-stone-950 dark:text-stone-100">
    <!--
        No top padding: the page's own header is a sticky bar and supplies its
        own, so it sits against the top of the window rather than 40px down it
        and then jumping there on the first scroll.
    -->
    <main class="mx-auto max-w-7xl px-6 pb-10">
        <!--
            One route, two documents.

            The page is a compose form without ?requestid= and a results table
            with one, and Svelte keeps a component alive across a client-side
            navigation between them. That is the right default nearly
            everywhere, and wrong here: every piece of the page's state is
            initialised from the run it was mounted with, so 'Start another'
            handed back the last run's brief, strategies, count and masked
            address rather than an empty form - and the mask is not an address,
            so the server rejected a field the person never typed.

            Keying on the run identity makes leaving a run mean leaving it.
            Resetting the fields by hand instead would have to be revisited
            every time a new piece of state is added, which is exactly how this
            appeared in the first place.
        -->
        {#key page.url.searchParams.get('requestid') ?? ''}
            {@render children()}
        {/key}
    </main>
</div>
