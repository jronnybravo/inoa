<script lang="ts">
    import type { Snippet } from 'svelte';
    import { page } from '$app/state';
    import '../app.css';

    const { children }: { children: Snippet } = $props();

    const DESCRIPTION =
        'Generate brand names from a brief, then screen each one against the places ' +
        'a name can already be taken: the .com, the App Store, Google Play, and the web.';

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
    <main class="mx-auto max-w-7xl px-6 py-10">
        {@render children()}
    </main>
</div>
