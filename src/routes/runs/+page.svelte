<script lang="ts">
    import AppHeader from '$lib/AppHeader.svelte';
    import { STATUS_TONE, STATUS_WORD } from '$lib/status';
    import { STRATEGIES } from '$lib/types';
    import type { PageData } from './$types';
    import { resolve } from '$app/paths';

    const { data }: { data: PageData } = $props();

    const strategyLabel = (id: string): string => STRATEGIES.find((s) => s.id === id)?.label ?? id;

    /**
     * The date, at the resolution somebody actually wants.
     *
     * A run from an hour ago and a run from March are looked for differently:
     * one by 'the one I started this morning', the other by roughly when. Same
     * day gets a clock, everything else gets a date.
     */
    function when(iso: string): string {
        const at = new Date(iso);
        const sameDay = at.toDateString() === new Date().toDateString();
        return sameDay
            ? at.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })
            : at.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: '2-digit' });
    }

    /** How long it took, for the ones that finished. */
    function took(from: string, to: string | null): string {
        if (!to) {
            return '';
        }
        const minutes = Math.round((new Date(to).getTime() - new Date(from).getTime()) / 60000);
        if (minutes < 1) {
            return 'under a minute';
        }
        return minutes < 90 ? `${minutes} min` : `${Math.round(minutes / 60)} hr`;
    }
</script>

<svelte:head><title>Runs · Inoa</title></svelte:head>

<AppHeader>
    <a
        href={resolve('/')}
        class="rounded-lg bg-stone-900 px-4 py-2 text-sm font-medium text-white
               transition-opacity duration-150 hover:opacity-90 dark:bg-white
               dark:text-stone-900">New run</a
    >
</AppHeader>

<!--
    The count belongs here, not in the header. It was in the tagline's place,
    which made the product describe itself differently depending on which page
    you were looking at.
-->
{#if data.runs.length > 0}
    <p class="mt-4 text-sm text-stone-600 dark:text-stone-400">
        {data.runs.length}
        {data.runs.length === 1 ? 'run' : 'runs'}, newest first.
    </p>
{/if}

{#if data.runs.length === 0}
    <p
        class="mt-8 rounded-xl border border-stone-200 bg-white px-6 py-10 text-center text-sm
               text-stone-500 dark:border-stone-800 dark:bg-stone-900"
    >
        Nothing here yet. Start a run and it will be listed here afterwards — this page is the
        reason you no longer have to keep the link.
    </p>
{:else}
    <!--
        Cards rather than a table.

        The table on the run page has a column per check because every row is
        the same shape. A run is not: the brief is a sentence, the counts are
        numbers, the status is a word, and forcing them into columns makes the
        sentence a column of truncated fragments. Each row here is a link with
        the brief given the room to be read.
    -->
    <ul class="mt-2 space-y-2">
        {#each data.runs as run (run.id)}
            <li>
                <a
                    href="{resolve('/')}?requestid={run.id}"
                    class="block rounded-xl border border-stone-200 bg-white px-5 py-4
                           transition-colors duration-100 hover:border-stone-400
                           dark:border-stone-800 dark:bg-stone-900 dark:hover:border-stone-600"
                >
                    <div class="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
                        <p class="text-sm font-medium text-stone-900 dark:text-stone-100">
                            {run.brief}
                        </p>
                        <span class="flex items-center gap-1.5 text-xs whitespace-nowrap">
                            <span class="h-1.5 w-1.5 rounded-full {STATUS_TONE[run.status]}"></span>
                            <!-- Total over every RunStatus, so there is no case to fall back to. -->
                            {STATUS_WORD[run.status]}
                        </span>
                    </div>

                    <div
                        class="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs
                               text-stone-500 dark:text-stone-400"
                    >
                        <span class="tabular-nums">
                            <!--
                                What was found, not what was asked for. A
                                stopped run that generated 412 of 1000 is a
                                run with 412 names in it, and the target is
                                the less interesting half of that.
                            -->
                            {run.names.toLocaleString()} of {run.targetCount.toLocaleString()} names
                        </span>
                        {#if run.names > 0}
                            <span class="tabular-nums">{run.passed.toLocaleString()} passing</span>
                        {/if}
                        {#if run.strategies}
                            <span class="hidden sm:inline"
                                >{run.strategies.map(strategyLabel).join(', ')}</span
                            >
                        {/if}
                        <span class="ml-auto tabular-nums"
                            >{when(run.createdAt)}{took(run.createdAt, run.finishedAt)
                                ? ` · ${took(run.createdAt, run.finishedAt)}`
                                : ''}</span
                        >
                    </div>
                </a>
            </li>
        {/each}
    </ul>
{/if}
