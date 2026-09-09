<!--
    The bar every page wears.

    It was written twice — once on the compose page and once on the history
    list — and the copies had already drifted: the list put its own row count
    where the tagline goes, so moving between the two changed what the product
    called itself. A header is the one thing on a page that should not depend
    on which page it is.

    The right-hand side is the part that legitimately differs, so it is a
    snippet the page fills in. Everything else is fixed here.
-->
<script lang="ts">
    import type { Snippet } from 'svelte';
    import { resolve } from '$app/paths';

    const { children }: { children?: Snippet } = $props();
</script>

<header
    class="sticky top-0 z-30 -mx-6 mb-2 flex flex-wrap items-center justify-between gap-x-6
           gap-y-2 border-b border-stone-200 bg-stone-50/85 px-6 py-3 backdrop-blur
           dark:border-stone-800 dark:bg-stone-950/85"
>
    <div class="flex flex-wrap items-baseline gap-x-3">
        <!--
            The wordmark goes home, because every wordmark does. It was the one
            thing on the bar that looked clickable and was not — and on the
            history page it sat beside a 'New run' button doing the job it
            should have been doing itself.

            No underline: it is a wordmark rather than a link in prose, and the
            hover says enough.
        -->
        <h1 class="text-lg font-semibold tracking-tight">
            <a href={resolve('/')} class="transition-opacity duration-100 hover:opacity-70">Inoa</a>
        </h1>
        <!--
            A tagline, not the instructions. It says what the product is for;
            what it does is in the page description a crawler reads.
        -->
        <p class="hidden text-sm text-stone-600 sm:block dark:text-stone-400">
            Find a name that's actually free.
        </p>
    </div>
    <nav class="flex items-center gap-4 text-sm">
        {@render children?.()}
    </nav>
</header>
