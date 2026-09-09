<!--
    Search a long list, take a few from it.

    Written once and used three times: domains, social platforms, languages.
    All three ask the same question — many options, a few taken — and all three
    had their own copy of this, which is how they drifted. The domain search
    learned to show what was already added and to reveal the highlighted row
    while arrowing; the other two never did.

    The caller owns the matching, because ranking 539 TLDs and ranking eleven
    language families are not the same problem. This owns the input, the
    keyboard, and what a row looks like.
-->
<script lang="ts">
    /** One row of the list. `note` sits beside the label, `meta` at the end. */
    export interface Option {
        id: string;
        label: string;
        note?: string;
        meta?: string;
    }

    /*
     * let, not const, for the whole destructuring.
     *
     * `query` is $bindable and this component writes to it when a pick clears
     * the box, which prefer-const cannot see. Svelte takes one $props() call,
     * so the other bindings share its declaration and the rule has to be off
     * for the block rather than for a line.
     */
    /* eslint-disable prefer-const */
    let {
        id,
        labelledBy,
        placeholder,
        matches,
        already = [],
        query = $bindable(''),
        onpick,
        onremovelast
    }: {
        id: string;
        labelledBy: string;
        placeholder: string;
        /** Already ranked by the caller; this renders them in order. */
        matches: Option[];
        /** Options the query matches that are already taken, named rather than hidden. */
        already?: Option[];
        query?: string;
        onpick: (id: string) => void;
        /** Backspace on an empty query. Omit where there is nothing to take back. */
        onremovelast?: () => void;
    } = $props();
    /* eslint-enable prefer-const */

    let open = $state(false);
    let index = $state(0);

    /**
     * Keep the highlighted option in view.
     *
     * Forty options in a sixteen-rem box means arrowing walks the highlight
     * out of the visible area while the list sits still. 'nearest' scrolls
     * only when it has to, so moving within view does not jump the list.
     */
    function reveal() {
        queueMicrotask(() =>
            document
                .querySelector(`#${id}-list [aria-selected="true"]`)
                ?.scrollIntoView({ block: 'nearest' })
        );
    }

    function onKeydown(event: KeyboardEvent) {
        if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
            event.preventDefault();
            open = true;
            const step = event.key === 'ArrowDown' ? 1 : -1;
            const count = matches.length;
            index = count === 0 ? 0 : (index + step + count) % count;
            reveal();
            return;
        }
        if (event.key === 'Enter') {
            event.preventDefault();
            const picked = matches[index]?.id;
            if (picked) {
                onpick(picked);
                query = '';
                index = 0;
            }
            return;
        }
        /*
         * Backspace on an empty query takes back the last one. The convention
         * for every control shaped like this, and the only way to undo a
         * mistyped pick without reaching for its cross.
         */
        if (event.key === 'Backspace' && query === '' && onremovelast) {
            event.preventDefault();
            onremovelast();
            return;
        }
        if (event.key === 'Escape' && open) {
            // Handled here so the same keypress does not also reach the page's
            // Escape ladder and wipe the table filters behind an open list.
            event.stopPropagation();
            open = false;
        }
    }
</script>

<div class="relative max-w-sm">
    <input
        {id}
        {placeholder}
        bind:value={query}
        onfocus={() => (open = true)}
        onblur={() => setTimeout(() => (open = false), 120)}
        oninput={() => {
            open = true;
            index = 0;
        }}
        onkeydown={onKeydown}
        role="combobox"
        aria-expanded={open}
        aria-controls="{id}-list"
        aria-labelledby={labelledBy}
        autocomplete="off"
        class="w-full rounded-lg border border-stone-300 bg-white px-3 py-2 text-sm
               placeholder:text-stone-400 focus:border-stone-500 focus:outline-none
               focus:ring-2 focus:ring-stone-900/10 dark:border-stone-700 dark:bg-stone-950
               dark:placeholder:text-stone-600 dark:focus:ring-white/10"
    />
    {#if open}
        <div
            class="absolute z-20 mt-1 w-full overflow-hidden rounded-lg border border-stone-200
                   bg-white shadow-lg dark:border-stone-700 dark:bg-stone-900"
        >
            <ul id="{id}-list" role="listbox" class="max-h-64 overflow-y-auto py-1">
                <!--
                    First, not last. An option already taken is kept out of the
                    results, so searching for one you have looks exactly like
                    searching for one that does not exist — and below forty
                    matches, saying so may as well not be there.
                -->
                {#each already as option (option.id)}
                    <li
                        class="flex items-baseline justify-between gap-2 px-3 py-1.5 text-sm
                               text-stone-500 dark:text-stone-400"
                    >
                        <span>{option.label}</span>
                        <span class="text-xs">already added</span>
                    </li>
                {/each}

                {#each matches as option, i (option.id)}
                    <li>
                        <!--
                            onmousedown rather than onclick: the input's blur
                            fires first on a click and would close the list out
                            from under the pointer.
                        -->
                        <button
                            type="button"
                            role="option"
                            aria-selected={i === index}
                            onmousedown={(e) => {
                                e.preventDefault();
                                onpick(option.id);
                                query = '';
                                index = 0;
                            }}
                            onmouseenter={() => (index = i)}
                            class="flex w-full items-baseline gap-2 px-3 py-1.5 text-left text-sm
                                   {i === index ? 'bg-stone-100 dark:bg-stone-800' : ''}"
                        >
                            <span>{option.label}</span>
                            {#if option.note}
                                <span class="truncate text-xs text-stone-500">{option.note}</span>
                            {/if}
                            {#if option.meta}
                                <span
                                    class="ml-auto text-xs tabular-nums text-stone-500
                                           dark:text-stone-400">{option.meta}</span
                                >
                            {/if}
                        </button>
                    </li>
                {/each}

                {#if matches.length === 0 && already.length === 0}
                    <li class="px-3 py-2 text-sm text-stone-500">
                        Nothing matches “{query.trim()}”.
                    </li>
                {/if}
            </ul>
            {#if matches.length > 0}
                <p
                    class="border-t border-stone-200 px-3 py-1.5 text-xs text-stone-500
                           dark:border-stone-800 dark:text-stone-400"
                >
                    ↑↓ to move · ↵ to add{onremovelast ? ' · ⌫ removes the last' : ''}
                </p>
            {/if}
        </div>
    {/if}
</div>
