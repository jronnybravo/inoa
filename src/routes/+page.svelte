<script lang="ts">
    import FieldIcon from '$lib/FieldIcon.svelte';
    import { ALL_TLDS, isTld } from '$lib/tlds';
    import {
        checkLabel,
        checkSearch,
        statusOf,
        STORE_ORDER,
        tldKind,
        STRATEGIES,
        TERMINAL_STATUSES,
        type CandidateView,
        type CheckKind,
        type CheckStatus,
        type RunEventView,
        type RunPayload,
        type RunView,
        type StrategyTally
    } from '$lib/types';
    import type { PageData } from './$types';
    import { goto } from '$app/navigation';
    import { resolve } from '$app/paths';

    const { data }: { data: PageData } = $props();

    /**
     * One route, two jobs. Without a request id you are composing a brief; with
     * one you are watching it run. They want opposite layouts - a form wants a
     * narrow centred column, a running job wants width for the table and a
     * second column for the console - so they are laid out separately rather
     * than one being a disabled version of the other.
     */
    const watching = $derived(Boolean(data.run));

    let brief = $state(data.run?.brief ?? '');
    let strategies = $state<string[]>(data.run?.strategies ?? ['compound', 'invented']);
    /**
     * The domains to look for, and which of them a name must actually be free on.
     *
     * Two lists rather than one with a flag, because they are two questions
     * asked in two places: which columns the table has, and which of those can
     * end a name. Everything picked is checked and reported; only the required
     * ones drop anything.
     */
    let tlds = $state<string[]>(['com']);
    let requiredTlds = $state<string[]>(['com']);

    /**
     * What the run must clear, for the checks that are not domains.
     *
     * Still a record of booleans: there are three of them and there always
     * will be, which is exactly what stopped being true of the domains.
     */
    const requiredStores = $state<Record<string, boolean>>({
        appStore: true,
        playStore: true,
        google: false
    });
    /**
     * The domain search: query, whether the list is showing, and the highlight.
     *
     * A thousand options cannot be a row of chips, and a native <select multiple>
     * of a thousand is worse. This is the search-and-pick control people expect
     * for a list this size — type to narrow, arrows to move, Enter to take.
     */
    let tldQuery = $state('');
    let tldOpen = $state(false);
    let tldIndex = $state(0);

    /** Enough to scroll, few enough to render on every keystroke. */
    const TLD_SHOWN = 40;
    const TLD_MAX = 12;

    /** Typed as somebody would say it: '.io', 'IO' and 'io' are one query. */
    const tldQueryClean = $derived(tldQuery.trim().toLowerCase().replace(/^\./, ''));

    /**
     * Already-chosen domains matching the query.
     *
     * Chosen domains are kept out of the results, which on its own makes
     * searching for one you already have look like it does not exist. Naming
     * them is the difference between 'not found' and 'you have it'.
     */
    const tldAlready = $derived(
        tldQueryClean ? tlds.filter((t) => t.startsWith(tldQueryClean)).slice(0, 4) : []
    );

    /**
     * Domains matching what has been typed, best first.
     *
     * Prefix matches lead: somebody typing 'co' means .co and .com long before
     * they mean .telecom. Within each group the order is the file's own, which
     * is how many of the top million sites use each one — so an empty query
     * opens on the domains people actually register.
     */
    const tldMatches = $derived.by(() => {
        const q = tldQueryClean;
        const chosen = new Set(tlds);
        const starts: (readonly [string, string?])[] = [];
        const contains: (readonly [string, string?])[] = [];

        for (const entry of ALL_TLDS) {
            if (chosen.has(entry[0])) {
                continue;
            }
            if (!q) {
                starts.push(entry);
            } else if (entry[0].startsWith(q) || entry[1]?.startsWith(q)) {
                starts.push(entry);
            } else if (entry[0].includes(q) || entry[1]?.includes(q)) {
                contains.push(entry);
            }
            if (starts.length >= TLD_SHOWN) {
                break;
            }
        }
        return [...starts, ...contains].slice(0, TLD_SHOWN);
    });

    function addTld(tld: string) {
        if (!isTld(tld) || tlds.includes(tld) || tlds.length >= TLD_MAX) {
            return;
        }
        tlds = [...tlds, tld];
        tldQuery = '';
        tldIndex = 0;
    }

    function removeTld(tld: string) {
        tlds = tlds.filter((t) => t !== tld);
        // Required is a subset of checked, kept so here as well as on the
        // server: a requirement on a domain nobody looks at can never clear.
        requiredTlds = requiredTlds.filter((t) => t !== tld);
    }

    const toggleRequiredTld = (tld: string): void => {
        requiredTlds = requiredTlds.includes(tld)
            ? requiredTlds.filter((t) => t !== tld)
            : [...requiredTlds, tld];
    };

    /**
     * Keep the highlighted option in view.
     *
     * Forty options in a sixteen-rem box means arrowing down walks the
     * highlight straight out of the visible area, and the list sits still
     * while an invisible row is selected. 'nearest' scrolls only when it has
     * to, so moving within view does not jump the list about.
     */
    function revealHighlighted() {
        queueMicrotask(() =>
            document
                .querySelector('#tld-list [aria-selected="true"]')
                ?.scrollIntoView({ block: 'nearest' })
        );
    }

    /** Arrow keys move the highlight, Enter takes it, Escape closes the list. */
    function onTldKeydown(event: KeyboardEvent) {
        if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
            event.preventDefault();
            tldOpen = true;
            const step = event.key === 'ArrowDown' ? 1 : -1;
            const count = tldMatches.length;
            tldIndex = count === 0 ? 0 : (tldIndex + step + count) % count;
            revealHighlighted();
            return;
        }
        if (event.key === 'Enter') {
            event.preventDefault();
            const picked = tldMatches[tldIndex]?.[0];
            if (picked) {
                addTld(picked);
            }
            return;
        }
        /*
         * Backspace on an empty query takes back the last domain.
         *
         * The convention for every control shaped like this one, and the only
         * way to undo a mistyped pick without reaching for its cross — which
         * is a 20px target at the far end of the row you just added to.
         */
        if (event.key === 'Backspace' && tldQuery === '' && tlds.length > 0) {
            event.preventDefault();
            removeTld(tlds[tlds.length - 1] as string);
            return;
        }
        if (event.key === 'Escape' && tldOpen) {
            // Handled here so the page's own Escape ladder does not also fire
            // and wipe the table filters underneath an open dropdown.
            event.stopPropagation();
            tldOpen = false;
        }
    }

    let email = $state(data.run?.email ?? '');
    let targetCount = $state(data.run?.targetCount ?? 1000);

    let submitting = $state(false);
    let problem = $state('');

    /*
     * The server's rules, mirrored.
     *
     * Duplication on purpose: the API validates with Zod and reports the first
     * failure in Zod's words, which is a sentence written for a developer
     * reading a stack trace. Anything the person can be told here, they should
     * be told here, in their own terms, before a request is made.
     */
    const BRIEF_MIN = 12;
    const BRIEF_MAX = 2000;
    const COUNT_MIN = 50;
    const COUNT_MAX = 2000;
    const EMAIL_SHAPE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

    /**
     * What still stands between this form and a run, in the order it is read.
     *
     * Ordered by field position rather than severity, because the list doubles
     * as directions through the form: fixing them top to bottom is walking
     * down the page.
     */
    const unmet = $derived.by(() => {
        const out: { field: string; message: string }[] = [];
        const written = brief.trim();

        if (written.length === 0) {
            out.push({ field: 'brief', message: 'Describe the business in a sentence.' });
        } else if (written.length < BRIEF_MIN) {
            const short = BRIEF_MIN - written.length;
            out.push({
                field: 'brief',
                message: `The brief is too short to generate from — ${short} more character${short === 1 ? '' : 's'} at least.`
            });
        } else if (written.length > BRIEF_MAX) {
            out.push({
                field: 'brief',
                message: `The brief is ${written.length - BRIEF_MAX} characters over the ${BRIEF_MAX} limit.`
            });
        }

        if (strategies.length === 0) {
            out.push({ field: 'strategy', message: 'Choose at least one naming strategy.' });
        }

        // Typed number, but a cleared number input really does hand back null,
        // which is why this is checked rather than trusted.
        if (!Number.isInteger(targetCount) || targetCount < COUNT_MIN || targetCount > COUNT_MAX) {
            out.push({
                field: 'count',
                message: `Ask for a whole number between ${COUNT_MIN} and ${COUNT_MAX} names.`
            });
        }

        const address = email.trim();
        if (address.length === 0) {
            out.push({ field: 'email', message: 'Add the address the results should go to.' });
        } else if (!EMAIL_SHAPE.test(address)) {
            out.push({
                field: 'email',
                message: `${address} does not look like an email address.`
            });
        }

        return out;
    });

    /*
     * Nothing is marked wrong until it has been submitted once.
     *
     * An empty form is not a form full of mistakes, and telling somebody their
     * brief is too short before they have finished the first word is nagging
     * rather than helping. After the first attempt the list stays live, so
     * each fix visibly removes a line.
     */
    let attempted = $state(false);

    const problemFor = (field: string): string | undefined =>
        attempted ? unmet.find((u) => u.field === field)?.message : undefined;

    /**
     * A mark per field, drawn rather than imported.
     *
     * The rail is a column of six labels in the same size and weight, which is
     * a paragraph to read rather than a form to scan. A shape beside each one
     * gives the eye something to land on and makes 'the domains row' findable
     * without reading the words.
     *
     * Inline paths on a shared 24x24 grid: no icon font, no CDN, no build step,
     * and they take their colour from the text they sit beside. Six simple
     * shapes is less code than any of the alternatives.
     */
    const ICONS = {
        brief: ['M6 3.5h12v17H6z', 'M9 8h6', 'M9 12h6', 'M9 16h4'],
        strategy: [
            'M12 3.5l1.7 4.8 4.8 1.7-4.8 1.7-1.7 4.8-1.7-4.8-4.8-1.7 4.8-1.7z',
            'M18.4 15.4l.7 1.9 1.9.7-1.9.7-.7 1.9-.7-1.9-1.9-.7 1.9-.7z'
        ],
        domain: [
            'M12 3.5a8.5 8.5 0 100 17 8.5 8.5 0 000-17z',
            'M3.5 12h17',
            'M12 3.5c2.2 2.3 3.4 5.3 3.4 8.5s-1.2 6.2-3.4 8.5c-2.2-2.3-3.4-5.3-3.4-8.5S9.8 5.8 12 3.5z'
        ],
        stores: [
            'M12 3.5l7 2.5v6c0 4.2-2.8 7.3-7 8.5-4.2-1.2-7-4.3-7-8.5V6z',
            'M9 12l2.2 2.2 4.3-4.2'
        ],
        count: ['M10 4L8 20', 'M16 4l-2 16', 'M5 9.5h14', 'M4.5 14.5h14'],
        email: ['M3.5 5.5h17v13h-17z', 'M3.5 6.5l8.5 6 8.5-6']
        // satisfies, not a Record annotation: the keys stay literal, so
        // ICONS.brief is a string[] rather than one that might not be there.
    } satisfies Record<string, string[]>;

    /**
     * One row of the compose form: a label rail, then the control.
     *
     * A constant because it is repeated six times and is most of the reason
     * the rows line up.
     *
     * 18rem rather than something narrower because the rail carries a line of
     * explanation under each label, and at 15rem three of them wrapped to a
     * third line - which set the height of rows whose control was a single
     * input, making the form taller than the two-column version it replaced.
     *
     * Below sm the rail sits above its control, which is the only thing that
     * fits on a phone and is also what a label normally does.
     */
    const ROW =
        'grid gap-x-8 gap-y-2 py-4 first:pt-0 last:pb-0 ' +
        'sm:grid-cols-[minmax(0,18rem)_minmax(0,1fr)]';

    /**
     * Send the person to the thing they need to change, not just tell them.
     *
     * With the summary panel gone this is the only thing that says where the
     * problem is on a screen too short to show the whole form, so it cannot be
     * the half of the pair that quietly does nothing.
     *
     * Instant, not smooth. A smooth scroll here is an animation nobody asked
     * for in direct response to a button press, and it is the part that fails
     * quietly: it is suppressed outright in some environments, leaving focus
     * on a field 1300px below the fold and the page exactly where it was.
     */
    function focusField(field: string) {
        const el = document.getElementById(field);
        el?.scrollIntoView({ block: 'center' });
        el?.focus({ preventScroll: true });
    }
    let pendingRunId = $state('');
    let emailProblem = $state('');
    let code = $state('');
    /**
     * The code prompt, as a dialog rather than a panel in the form.
     *
     * Inline, it appeared where the Execute button had been, several hundred
     * pixels below a form the person had stopped reading - and it is the one
     * moment in this flow that is genuinely modal, because nothing else on the
     * page does anything until the code is in.
     */
    let verifyDialog = $state<HTMLDialogElement | null>(null);
    /**
     * Kept apart from `problem`, which renders above the form.
     *
     * A wrong code reported there would be painted behind the very dialog that
     * asked for it.
     */
    let verifyProblem = $state('');

    let run = $state<RunView | null>(data.run ?? null);
    // Seeded from the server load, so a finished run is populated at first
    // paint rather than after the first poll.
    let candidates = $state<CandidateView[]>(data.candidates ?? []);
    let events = $state<RunEventView[]>([]);
    // A seen-list, never rendered, so reactivity would cost updates and buy
    // nothing.
    // eslint-disable-next-line svelte/prefer-svelte-reactivity
    const seenEvents = new Set<string>();
    /**
     * Off by default, on every run.
     *
     * The whole table is the result; the winners are one view of it. Opening on
     * a filtered subset hides how each rejected name was rejected, and on a run
     * still in progress shows nothing at all, since nothing passes until every
     * required check has answered.
     */
    let onlyPassed = $state<boolean>(false);
    /**
     * One filter per column, each empty meaning "any".
     *
     * Kept beside the headings rather than above the table: the question a
     * person has is always about a column ("which of these are free on the
     * .com?"), so the control belongs where the answer is.
     */
    let nameFilter = $state('');
    let approachFilter = $state('');
    // Keyed by check, and the checks are the run's own — so it starts empty
    // and gains a key the first time somebody filters on a column.
    let checkFilter = $state<Record<string, string>>({});

    const anyFilter = $derived(
        Boolean(nameFilter || approachFilter || Object.values(checkFilter).some(Boolean))
    );

    /** Escape clears the filters, from anywhere on the page. */
    function onKeydown(event: KeyboardEvent) {
        if (event.key !== 'Escape') {
            return;
        }
        // Innermost thing first: a menu is what Escape means while one is open,
        // and clearing the filters underneath it would be a surprise.
        //
        // The dialog is innermost of all. A modal <dialog> is supposed to
        // close itself on Escape, but that is the browser's close watcher
        // rather than a keypress this page can see, and the rest of the ladder
        // is ours - so it is closed here explicitly and the same keypress is
        // stopped from also wiping the filters behind it. close() on an
        // already-closed dialog is a no-op, so doing both is safe.
        for (const dialog of [verifyDialog, stopDialog]) {
            if (dialog?.open) {
                dialog.close();
                return;
            }
        }
        if (menu) {
            const trigger = document.getElementById(`row-menu-${menu.id}`);
            menu = null;
            trigger?.focus();
            return;
        }
        if (hint) {
            hint = null;
            return;
        }
        if (anyFilter) {
            clearFilters();
        }
    }

    function clearFilters() {
        nameFilter = '';
        approachFilter = '';
        checkFilter = {};
    }
    const selected = $state<Record<string, boolean>>({});
    // Open while there is something to watch, closed once there is not: a
    // finished run spent 23rem of the results area on historical chatter.
    let consoleOpen = $state(!data.run || !TERMINAL_STATUSES.includes(data.run.status));
    let copied = $state(false);
    let logEl = $state<HTMLDivElement | null>(null);

    /** Rows with a check in flight, so the button can say so. */
    let rechecking = $state<Record<string, boolean>>({});
    /**
     * The open dropdown, positioned in viewport coordinates.
     *
     * The table scrolls inside its own panel, so a menu positioned against the
     * row would be clipped by that container. Fixed coordinates taken from the
     * button escape it.
     */
    let menu = $state<{ id: string; x: number; y: number; anchorTop: number } | null>(null);

    /**
     * Keep a fixed-position popover inside the viewport.
     *
     * Escaping the scroll panel with fixed coordinates solved the clipping it
     * was written for and introduced a worse one: a row near the bottom opened
     * its menu below the fold, and because the menu is fixed, no amount of
     * scrolling could reach it. It flips above the trigger when there is no
     * room below, and is clamped on both axes.
     *
     * An action rather than an effect: this reads the rendered height, and
     * writing that back into state to re-render would be a loop.
     */
    function placed(node: HTMLElement, anchor: { x: number; y: number; anchorTop: number }) {
        const MARGIN = 8;
        const position = (a: { x: number; y: number; anchorTop: number }) => {
            const box = node.getBoundingClientRect();
            const noRoomBelow = a.y + box.height > window.innerHeight - MARGIN;
            const top = noRoomBelow ? Math.max(MARGIN, a.anchorTop - box.height - 4) : a.y;
            // The menu is translated fully left of x, so x must clear its width.
            const left = Math.min(Math.max(a.x, box.width + MARGIN), window.innerWidth - MARGIN);
            node.style.top = `${top}px`;
            node.style.left = `${left}px`;
        };
        position(anchor);
        return { update: position };
    }

    /**
     * The reason a name was proposed, shown on hover.
     *
     * It was already carried as a title attribute, which is the worst place for
     * it: about a second's delay, unstyled, invisible on touch, and gone the
     * moment you move. Fixed coordinates because the table scrolls inside its
     * own panel and would clip anything anchored to the row.
     */
    let hint = $state<{ text: string; x: number; y: number } | null>(null);

    function showHint(event: MouseEvent, text: string | null) {
        if (!text) {
            return;
        }
        const r = (event.currentTarget as HTMLElement).getBoundingClientRect();
        hint = { text, x: r.left, y: r.bottom + 6 };
    }

    /**
     * Fold a poll's rows into the ones on screen, keeping every unchanged row.
     *
     * Assigning the response wholesale replaced a thousand objects every two and
     * a half seconds. The keyed each block kept the DOM nodes, but every cell's
     * text and classes were reassigned, so the whole table repainted and visibly
     * flashed. Reusing the previous object for a row whose verdicts have not
     * moved lets Svelte skip it entirely.
     */
    function mergeCandidates(current: CandidateView[], incoming: CandidateView[]): CandidateView[] {
        const previous = new Map(current.map((c) => [c.id, c]));
        let changed = incoming.length !== current.length;

        const next = incoming.map((row, i) => {
            const before = previous.get(row.id);
            if (
                before &&
                columns.every((k) => statusOf(before.statuses, k) === statusOf(row.statuses, k)) &&
                before.passed === row.passed &&
                current[i]?.id === row.id
            ) {
                return before;
            }
            changed = true;
            return row;
        });

        // An unchanged poll must not even reassign the array, or every derived
        // value recomputes and the table repaints for nothing.
        return changed ? next : current;
    }

    async function recheck(candidate: { id: string }, kind?: string) {
        menu = null;
        rechecking = { ...rechecking, [candidate.id]: true };
        try {
            const response = await fetch(`/api/candidates/${candidate.id}/check`, {
                method: 'POST',
                headers: { 'content-type': 'application/json' },
                body: JSON.stringify(kind ? { kind } : {})
            });
            if (response.ok) {
                const updated = (await response.json()) as CandidateView;
                // Patch the row in place rather than waiting for the next poll.
                candidates = candidates.map((c) =>
                    c.id === updated.id ? { ...c, ...updated } : c
                );
            }
        } catch {
            // The next poll will show the truth either way.
        } finally {
            rechecking = { ...rechecking, [candidate.id]: false };
        }
    }

    /**
     * The columns of the results table.
     *
     * Taken from the run while there is one, and from the form before there
     * is, so composing a run previews the table it will produce.
     */
    const columns = $derived<CheckKind[]>(
        run ? run.checks.kinds : [...tlds.map(tldKind), ...STORE_ORDER]
    );

    /** Which checks the run treats as gates, as opposed to merely reporting. */
    const requiredKinds = $derived<CheckKind[]>(
        run
            ? run.checks.required
            : [
                  ...tlds.filter((t) => requiredTlds.includes(t)).map(tldKind),
                  ...STORE_ORDER.filter((k) => requiredStores[k])
              ]
    );

    const storeRequirements = STORE_ORDER.map((key) => ({ key, label: checkLabel(key) }));

    /**
     * A glyph per verdict, with the word kept everywhere the glyph cannot go.
     *
     * The table is five columns of the same five words, and at that density the
     * words stop being read - the eye is scanning for a shape and a colour, so
     * it may as well be given one. The grid becomes legible at a glance, which
     * is the thing a naming run is actually for.
     *
     * The old objection to symbols was sound and is answered rather than
     * dropped: a dash reads as an empty cell, and 'skipped' is a real verdict
     * about the funnel, not a blank. So nothing here is a dash or a dot.
     * Every glyph is a mark somebody deliberately made.
     *
     * These are text glyphs, not emoji, for two reasons: emoji ignore the
     * colour classes below, and they render at wildly different weights across
     * platforms. And the word survives in all four places a glyph would fail -
     * the legend, the hover title, the screen-reader label, and the CSV.
     */
    const CELL: Record<CheckStatus, { text: string; icon: string; class: string }> = {
        clear: { text: 'free', icon: '✓', class: 'text-emerald-700 dark:text-emerald-400' },
        taken: { text: 'taken', icon: '✕', class: 'text-rose-700/90 dark:text-rose-400/90' },
        unknown: { text: 'unverified', icon: '?', class: 'text-amber-700 dark:text-amber-400' },
        skipped: { text: 'skipped', icon: '⊘', class: 'text-stone-400 dark:text-stone-600' },
        pending: { text: 'waiting', icon: '…', class: 'text-stone-400 dark:text-stone-500' }
    };

    /**
     * What each verdict means, in the table rather than in someone's head.
     *
     * Five states is more than a table usually carries, and four of them are not
     * self-evident: 'unverified' is not a soft no, and a dash is not a blank.
     */
    const LEGEND: { status: CheckStatus; note: string }[] = [
        { status: 'clear', note: 'nothing found' },
        { status: 'taken', note: 'someone is using it' },
        { status: 'unknown', note: 'no trustworthy answer' },
        { status: 'skipped', note: 'dropped by an earlier check, so never run' },
        { status: 'pending', note: 'not checked yet' }
    ];

    /** Short forms, because the column is narrow and the filter names them fully. */
    function strategyLabel(id: string | null): string {
        return id ? (STRATEGY_LABEL[id] ?? id) : '—';
    }

    /**
     * Statuses in words. `capitalize` on the enum shipped
     * 'Awaiting_verification' to the pill, underscore included.
     */
    const STATUS_LABEL: Record<string, string> = {
        awaiting_verification: 'Awaiting verification',
        queued: 'Queued',
        generating: 'Generating',
        checking: 'Checking',
        done: 'Done',
        failed: 'Failed',
        stopped: 'Stopped'
    };

    const STRATEGY_LABEL: Record<string, string> = {
        compound: 'Combination',
        invented: 'Invented',
        metaphor: 'Metaphor',
        portmanteau: 'Blend',
        foreign: 'Language',
        short: 'Abstract'
    };

    /** The hairline under a sticky header, which a border would scroll away from. */
    const FILTER_INPUT =
        'w-full rounded border bg-white px-1.5 py-1 text-xs font-normal ' +
        'placeholder:text-stone-400 focus:outline-none focus:ring-2 focus:ring-stone-900/10 ' +
        'dark:bg-stone-950 dark:placeholder:text-stone-600 dark:focus:ring-white/10';
    const FILTER_IDLE = 'border-stone-300 dark:border-stone-700';
    const FILTER_ACTIVE = 'border-stone-900 bg-stone-50 dark:border-stone-100 dark:bg-stone-800/60';
    const CLEAR_BUTTON =
        'absolute inset-y-0 right-0 flex w-5 items-center justify-center text-sm ' +
        'leading-none text-stone-400 hover:text-stone-900 dark:hover:text-stone-100';

    const HEADER_EDGE =
        'shadow-[inset_0_-1px_0_rgb(0_0_0/0.08)] dark:shadow-[inset_0_-1px_0_rgb(255_255_255/0.08)]';

    const LEVEL: Record<string, string> = {
        info: 'text-stone-600 dark:text-stone-400',
        success: 'text-emerald-700 dark:text-emerald-400',
        warn: 'text-amber-700 dark:text-amber-400',
        error: 'text-rose-700 dark:text-rose-400'
    };

    /**
     * Filtering happens here rather than in the query, because the counts beside
     * each approach have to reflect the whole run, not the current filter.
     */
    /**
     * How the Name column is ordered, cycling on each click.
     *
     * Three states rather than two, because the unsorted order is not an
     * absence of one: rows arrive in generation order, which is the sequence
     * the model produced them in and the only ordering that says anything the
     * alphabet does not. Sorting has to be undoable, and a third click is a
     * cheaper way back than a separate control.
     */
    type NameSort = 'none' | 'asc' | 'desc';
    let nameSort = $state<NameSort>('none');
    const NEXT_SORT: Record<NameSort, NameSort> = { none: 'asc', asc: 'desc', desc: 'none' };
    const SORT_HINT: Record<NameSort, string> = {
        none: 'Sort names A to Z',
        asc: 'Sort names Z to A',
        desc: 'Return to the order they were generated in'
    };

    const shown = $derived.by(() => {
        const matching = candidates.filter((c) => {
            if (nameFilter && !c.name.toLowerCase().includes(nameFilter.toLowerCase())) {
                return false;
            }
            if (approachFilter && c.strategy !== approachFilter) {
                return false;
            }
            return columns.every(
                (k) => !checkFilter[k] || statusOf(c.statuses, k) === checkFilter[k]
            );
        });
        const lensed = onlyNearMisses
            ? matching.filter((c) => nearMisses.some((n) => n.id === c.id))
            : matching;
        if (nameSort === 'none') {
            return lensed;
        }
        // filter() has already allocated, so sorting in place cannot disturb
        // the candidates array the rest of the page reads.
        const direction = nameSort === 'asc' ? 1 : -1;
        return lensed.sort((a, b) => direction * a.name.localeCompare(b.name));
    });

    /** Whole-run tallies from the server, so filtering does not distort them. */
    let tallies = $state<StrategyTally[]>([]);

    /**
     * Passed of checked, of generated.
     *
     * 'passed / total' read a stopped run as a failed one: fifty names that
     * were generated and never examined reported as `0/50`, which is the
     * project's own cardinal sin stated at the summary level. The middle
     * number is how many were actually asked about.
     */
    const byStrategy = $derived(
        STRATEGIES.map((s) => {
            const tally = tallies.find((t) => t.strategy === s.id);
            return {
                ...s,
                total: tally?.total ?? 0,
                checked: tally?.checked ?? tally?.total ?? 0,
                passed: tally?.passed ?? 0
            };
        }).filter((s) => s.total > 0)
    );

    const totalNames = $derived(tallies.reduce((sum, t) => sum + t.total, 0));
    const unattributed = $derived(tallies.find((t) => !t.strategy)?.total ?? 0);

    const passedCount = $derived(candidates.filter((c) => c.passed === true).length);

    /**
     * Blocked only by something we could not find out.
     *
     * The whole product turns on 'unverified' not being 'free', and every
     * number above the table used to drop the distinction: a name held up by
     * a bot-blocked domain counted the same as one that is genuinely taken.
     * These are the names that would pass if the checks could be completed,
     * which makes them the shortlist worth revisiting rather than discarding.
     */
    const nearMisses = $derived(
        candidates.filter(
            (c) =>
                requiredKinds.length > 0 &&
                requiredKinds.some((k) => statusOf(c.statuses, k) === 'unknown') &&
                requiredKinds.every((k) => ['clear', 'unknown'].includes(statusOf(c.statuses, k)))
        )
    );

    let onlyNearMisses = $state<boolean>(false);

    /** The run's three numbers, in the order the work happens. */
    /*
     * The strip reports what could not be established alongside what passed.
     *
     * 'passing' on its own invited the reading this project exists to prevent:
     * everything not passing looks taken, when some of it was never answered.
     *
     * Both counts are suppressed until candidates have actually arrived. The
     * server sends the run before it sends the rows, so printing 0 here stated
     * a finished run had found nothing — a confident wrong answer at the exact
     * moment somebody arrives from the results email.
     */
    const counted = $derived(candidates.length > 0);
    const progress = $derived([
        { label: 'generated', value: run?.generatedCount ?? 0, of: run?.targetCount ?? 0 },
        { label: 'checked', value: run?.checkedCount ?? 0, of: run?.generatedCount ?? 0 },
        { label: 'passing', value: counted ? passedCount : null, of: null as number | null },
        ...(counted && nearMisses.length > 0
            ? [{ label: 'unverified', value: nearMisses.length, of: null as number | null }]
            : [])
    ]);
    const finished = $derived(run !== null && TERMINAL_STATUSES.includes(run.status));
    /** Only a run somebody is still working on can be stopped. */
    const stoppable = $derived(run !== null && !TERMINAL_STATUSES.includes(run.status));

    /**
     * Stopping asks twice, in a dialog rather than in the button.
     *
     * A run is an hour of somebody else's rate limits, and the button sits in
     * the header where a misclick is cheap to make and expensive to undo.
     *
     * The first attempt swapped 'Stop' for 'Confirm stop' in place, which made
     * the misclick worse rather than better: the confirming button appeared
     * under a pointer that was already there, so a double-click or one
     * impatient second click carried straight through the guard it was
     * supposed to hit. It also moved the progress figures sideways, and
     * changed a button's label without announcing it.
     *
     * A native <dialog> is the answer to all of that. showModal() puts it in
     * the top layer, makes the page behind it inert, moves focus into it and
     * gives Escape back for free - and the confirming button lands somewhere
     * the pointer is not.
     */
    let stopDialog = $state<HTMLDialogElement | null>(null);
    let stopping = $state(false);

    async function stopRun() {
        if (!run) {
            return;
        }
        stopping = true;
        try {
            await fetch(`/api/runs/${run.id}/stop`, { method: 'POST' });
        } finally {
            stopping = false;
            stopDialog?.close();
        }
    }

    async function execute() {
        attempted = true;
        if (unmet.length > 0) {
            // The button stays live so it can answer this question. A disabled
            // control cannot be focused, cannot be asked why, and tells a
            // screen reader nothing at all.
            problem = '';
            focusField(unmet[0]?.field ?? 'brief');
            return;
        }

        problem = '';
        submitting = true;
        try {
            const response = await fetch('/api/runs', {
                method: 'POST',
                headers: { 'content-type': 'application/json' },
                body: JSON.stringify({
                    brief,
                    strategies,
                    tlds,
                    requiredTlds,
                    requireAppStore: requiredStores.appStore,
                    requirePlayStore: requiredStores.playStore,
                    requireGoogle: requiredStores.google,
                    email,
                    targetCount
                })
            });
            const payload = (await response.json()) as {
                id: string;
                verified: boolean;
                emailSent?: boolean;
                emailProblem?: string;
                message?: string;
            };
            if (!response.ok) {
                throw new Error(payload.message ?? 'Could not start');
            }

            // An address that has verified before starts immediately.
            if (payload.verified) {
                await openRun(payload.id);
                return;
            }

            pendingRunId = payload.id;
            emailProblem = payload.emailSent
                ? ''
                : (payload.emailProblem ?? 'The code could not be sent.');
            askForCode();
        } catch (e) {
            problem = (e as Error).message;
        } finally {
            submitting = false;
        }
    }

    /** Move to the run's own page, without discarding the document. */
    async function openRun(id: string) {
        const url = new URL(resolve('/'), location.origin);
        url.searchParams.set('requestid', id);
        // resolve() has already been applied to the path; the rule only
        // recognises it as a bare argument, and a query string cannot be
        // expressed through it.
        // eslint-disable-next-line svelte/no-navigation-without-resolve
        await goto(url, { keepFocus: true, noScroll: true });
    }

    /**
     * Reopen the prompt for a run that is already waiting on a code.
     *
     * Closing the dialog leaves the run in 'awaiting_verification', which no
     * worker will ever claim. Without a way back to it, the only route on was
     * Execute again - a second run, a second code, and the first row orphaned.
     */
    function askForCode() {
        verifyProblem = '';
        verifyDialog?.showModal();
    }

    async function verify() {
        verifyProblem = '';
        submitting = true;
        try {
            const response = await fetch('/api/verify', {
                method: 'POST',
                headers: { 'content-type': 'application/json' },
                body: JSON.stringify({ runId: pendingRunId, code })
            });
            if (!response.ok) {
                const body = (await response.json()) as { message?: string };
                throw new Error(body.message ?? 'Could not verify');
            }
            verifyDialog?.close();
            // Client-side navigation. Assigning to window.location threw the whole
            // document away and rebuilt it, which reads as the app restarting at the
            // exact moment the run begins.
            await openRun(pendingRunId);
        } catch (e) {
            verifyProblem = (e as Error).message;
        } finally {
            submitting = false;
        }
    }

    /**
     * Polling, not SSE. A streaming response holds a Vercel function open and
     * hits the duration cap this whole architecture exists to avoid.
     */
    $effect(() => {
        if (!data.run) {
            return;
        }
        // Redundant while the layout keys this component on the run id, and
        // kept because it costs nothing: the run on screen should follow the
        // run in `data` whether or not something above decides to remount.
        run = data.run;
        /*
         * An AbortController rather than a boolean flag.
         *
         * Leaving the page mid-request used to let that request finish and
         * write its result into state nobody was watching. Aborting cancels
         * the fetch as well as ending the loop.
         */
        const polling = new AbortController();
        // Deliberately not awaited: the effect returns its teardown below.
        void (async () => {
            let since = '';
            while (!polling.signal.aborted) {
                try {
                    const query = `passed=${onlyPassed ? 1 : 0}${since ? `&since=${encodeURIComponent(since)}` : ''}`;
                    const r = await fetch(`/api/runs/${data.run.id}?${query}`, {
                        signal: polling.signal
                    });
                    if (r.ok) {
                        const payload = (await r.json()) as RunPayload;
                        run = payload.run;
                        candidates = mergeCandidates(candidates, payload.candidates);
                        tallies = payload.tallies;
                        if (payload.events.length > 0) {
                            const fresh = payload.events.filter((e) => !seenEvents.has(e.id));
                            for (const e of fresh) {
                                seenEvents.add(e.id);
                            }
                            if (fresh.length) {
                                events = [...events, ...fresh].slice(-800);
                            }
                            since = payload.events.at(-1)?.at ?? since;
                        }
                        if (TERMINAL_STATUSES.includes(run.status)) {
                            return;
                        }
                    }
                } catch {
                    // Transient; the next tick retries.
                }
                await new Promise((r) => setTimeout(r, 2500));
            }
        })();
        return () => {
            polling.abort();
        };
    });

    // Follow the tail, the way a terminal does.
    $effect(() => {
        // Read the length so this re-runs whenever a line arrives.
        void events.length;
        if (logEl) {
            logEl.scrollTop = logEl.scrollHeight;
        }
    });

    function visibleRows() {
        return shown.filter((c) => selected[c.id] ?? true);
    }

    async function copyCsv() {
        const header = ['Name', 'Approach', ...columns.map(checkLabel)].join(',');
        const rows = visibleRows().map((c) =>
            [
                c.name,
                strategyLabel(c.strategy),
                ...columns.map((k) => CELL[statusOf(c.statuses, k)].text)
            ]
                .map((v) => `"${v}"`)
                .join(',')
        );
        await navigator.clipboard.writeText([header, ...rows].join('\n'));
        copied = true;
        setTimeout(() => (copied = false), 1600);
    }

    const time = (at: string) => new Date(at).toLocaleTimeString('en-GB', { hour12: false });
</script>

<svelte:window onkeydown={onKeydown} />

<!--
    A bar, not a banner.

    A thousand-name table is most of what this page is, and scrolling it used
    to carry the only way out of a run - and the only way to start one - off
    the top of the window. It stays; z-30 puts it over the table's own sticky
    heading and under the row menu, which has to be over everything.

    Translucent with a blur rather than opaque: a solid bar over a scrolling
    table reads as a gap in the page, and the tint keeps the text legible
    without pretending nothing is behind it.
-->
<header
    class="sticky top-0 z-30 -mx-6 mb-2 flex flex-wrap items-center justify-between gap-x-6
           gap-y-2 border-b border-stone-200 bg-stone-50/85 px-6 py-3 backdrop-blur
           dark:border-stone-800 dark:bg-stone-950/85"
>
    <div class="flex flex-wrap items-baseline gap-x-3">
        <h1 class="text-lg font-semibold tracking-tight">Inoa</h1>
        <!--
            The description, not a second title. 'Naming run' described the
            page and left the product unnamed on the one surface that is always
            visible; the name goes here and what it does follows it.
        -->
        <p class="hidden text-sm text-stone-600 sm:block dark:text-stone-400">
            Generate brand names from a brief, then screen each against the places a name can be
            taken.
        </p>
    </div>
    {#if watching}
        <a
            href={resolve('/')}
            class="text-sm text-stone-600 underline underline-offset-4 hover:text-stone-900
                       dark:text-stone-400 dark:hover:text-stone-100">Start another</a
        >
    {/if}
</header>

{#if !watching}
    <!--
        Compose: a horizontal form, one field to a row.

        This started as a single 672px column in a 1232px page, which left
        608px of nothing beside it and pushed Execute 332px below the fold. The
        first fix was two columns, which used the width but read as two
        independent stacks - the eye had to start over halfway across.

        A label rail instead: every field is one row, every label starts at the
        same x, every control starts at the same x. There is one place to look
        for what a thing is called and one place to look for its value, and the
        controls get the width they were short of.

        No width of its own, so it fills the same measure the results do.
        Compose and watch are the same page one step apart, and a card that
        changed width on submit made Execute look like it had navigated
        somewhere else rather than started the thing in front of you.
    -->
    <section class="mt-8">
        {#if data.notFound}
            <!--
                The server already knew this and said nothing. Landing on a
                blank form reads as 'my run was deleted', and the next move is
                to spend another hour regenerating something that may still
                exist under a link they mistyped.
            -->
            <p
                class="mb-4 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-900
                       dark:bg-amber-950/40 dark:text-amber-200"
            >
                No run matches that link. It may have been mistyped, or belong to a database that
                has since been cleared. The form below starts a new one.
            </p>
        {/if}

        {#if problem}
            <p
                class="mb-4 rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-800
                       dark:bg-rose-950/50 dark:text-rose-200"
            >
                {problem}
            </p>
        {/if}
        <!--
            Divided rather than spaced. With the labels in a rail the rows are
            ragged down the right - a textarea, then a grid, then one small
            number box - and a hairline is what says those are separate fields
            rather than one field that lost its alignment.
        -->
        <div
            class="divide-y divide-stone-200 rounded-xl border border-stone-200 bg-white px-6 py-6
                dark:divide-stone-800 dark:border-stone-800 dark:bg-stone-900"
        >
            <div class={ROW}>
                <div>
                    <label for="brief" class="flex items-center gap-2 text-sm font-medium">
                        <FieldIcon paths={ICONS.brief} />Brief
                    </label>
                    <p id="brief-help" class="mt-1 text-xs text-stone-500">
                        A sentence about the business. The names are generated from this, so what it
                        does matters more than how it is phrased.
                    </p>
                </div>
                <!--
                    A column, so the textarea can take what is left of it.
                    The rail beside it runs to three lines at this width and
                    the field to two, which left 18px of nothing under the box
                    and made the row look like it had come up short.
                -->
                <div class="flex h-full flex-col">
                    <textarea
                        id="brief"
                        bind:value={brief}
                        rows="2"
                        placeholder="A marketplace connecting local farms to restaurant kitchens."
                        aria-invalid={problemFor('brief') ? 'true' : undefined}
                        aria-describedby={problemFor('brief')
                            ? 'brief-help brief-error'
                            : 'brief-help'}
                        class="w-full flex-1 rounded-lg border bg-white px-3 py-2 text-sm
                               placeholder:text-stone-400 focus:outline-none focus:ring-2
                               dark:bg-stone-950 dark:placeholder:text-stone-600
                               {problemFor('brief')
                            ? 'border-rose-400 focus:border-rose-500 focus:ring-rose-500/20 dark:border-rose-800'
                            : 'border-stone-300 focus:border-stone-500 focus:ring-stone-900/10 dark:border-stone-700 dark:focus:ring-white/10'}"
                    ></textarea>
                    {#if problemFor('brief')}
                        <p id="brief-error" class="mt-1 text-xs text-rose-700 dark:text-rose-400">
                            {problemFor('brief')}
                        </p>
                    {/if}
                </div>
            </div>

            <div class={ROW}>
                <div>
                    <span id="strategy-label" class="flex items-center gap-2 text-sm font-medium">
                        <FieldIcon paths={ICONS.strategy} />Naming strategy
                    </span>
                    <p id="strategy-help" class="mt-1 text-xs text-stone-500">
                        Pick one or more. Each batch uses a single approach, so choosing two splits
                        the run evenly between them.
                    </p>
                </div>
                <div>
                    <!--
                        Three across rather than two. The rail buys the control
                        column enough width for it, and it turns six cards from
                        three rows into two.
                    -->
                    <!--
                        A named group rather than six loose checkboxes.
                        Execute sends focus to the first unmet field, and for
                        this one that is the container - so it has to be able
                        to say what it is and what is wrong with it. It is the
                        only field here whose control is not a labelled input,
                        which is why it needs saying by hand.

                        No aria-invalid: a group cannot carry it. The error is
                        announced through aria-describedby instead, which is
                        the half that says what to do about it.
                    -->
                    <div
                        id="strategy"
                        tabindex="-1"
                        role="group"
                        aria-labelledby="strategy-label"
                        aria-describedby={problemFor('strategy')
                            ? 'strategy-help strategy-error'
                            : 'strategy-help'}
                        class="grid gap-2 focus:outline-none sm:grid-cols-2 xl:grid-cols-3"
                    >
                        {#each STRATEGIES as s (s.id)}
                            <label
                                class="flex cursor-pointer items-start gap-2.5 rounded-lg border p-3 text-sm
                                       transition-colors duration-150
                                       {strategies.includes(s.id)
                                    ? 'border-stone-900 bg-stone-50 dark:border-stone-100 dark:bg-stone-800/50'
                                    : 'border-stone-200 hover:border-stone-400 dark:border-stone-800 dark:hover:border-stone-600'}"
                            >
                                <input
                                    type="checkbox"
                                    class="mt-0.5 accent-stone-900 dark:accent-stone-100"
                                    checked={strategies.includes(s.id)}
                                    onchange={(e) => {
                                        const on = e.currentTarget.checked;
                                        strategies = on
                                            ? [...strategies, s.id]
                                            : strategies.filter((x) => x !== s.id);
                                    }}
                                />
                                <span>
                                    <span class="font-medium">{s.label}</span>
                                    <span class="block text-xs text-stone-500 dark:text-stone-500"
                                        >{s.hint}</span
                                    >
                                </span>
                            </label>
                        {/each}
                    </div>
                    {#if problemFor('strategy')}
                        <p
                            id="strategy-error"
                            class="mt-1 text-xs text-rose-700 dark:text-rose-400"
                        >
                            {problemFor('strategy')}
                        </p>
                    {/if}
                </div>
            </div>

            <div class={ROW}>
                <div>
                    <span id="tlds-label" class="flex items-center gap-2 text-sm font-medium">
                        <FieldIcon paths={ICONS.domain} />Domains to check
                    </span>
                    <p id="tlds-help" class="mt-1 text-xs text-stone-500">
                        Each one gets a column of its own. Click a domain to make it a requirement:
                        a required domain drops the name the moment it is taken, the rest are
                        checked and reported either way.
                    </p>
                </div>
                <div>
                    <!--
                        Search first, then what it has produced.
                        
                        The other way round, the thing you type into moved down
                        the page every time you used it, and the list you were
                        building pushed the control that builds it out from
                        under the cursor. Fixed at the top, the input stays
                        where it was and the pills grow downward from it.
                    -->
                    <div class="relative max-w-sm">
                        <input
                            id="tlds"
                            bind:value={tldQuery}
                            onfocus={() => (tldOpen = true)}
                            onblur={() => setTimeout(() => (tldOpen = false), 120)}
                            oninput={() => {
                                tldOpen = true;
                                tldIndex = 0;
                            }}
                            onkeydown={onTldKeydown}
                            disabled={tlds.length >= TLD_MAX}
                            role="combobox"
                            aria-expanded={tldOpen}
                            aria-controls="tld-list"
                            aria-labelledby="tlds-label"
                            aria-describedby="tlds-help"
                            autocomplete="off"
                            placeholder={tlds.length >= TLD_MAX
                                ? `${TLD_MAX} domains is the most one run can check`
                                : `Search top-level domains — .com, .io, .ai…`}
                            class="w-full rounded-lg border border-stone-300 px-3 py-2 text-sm
                                   placeholder:text-stone-400 focus:border-stone-500
                                   focus:outline-none focus:ring-2 focus:ring-stone-900/10
                                   disabled:opacity-50 dark:border-stone-700 dark:bg-stone-950
                                   dark:placeholder:text-stone-600 dark:focus:ring-white/10"
                        />
                        {#if tldOpen}
                            <!--
                                onmousedown rather than onclick: the input's blur
                                fires first on a click and would close the list
                                out from under the pointer.
                            -->
                            <div
                                class="absolute z-20 mt-1 w-full overflow-hidden rounded-lg border
                                       border-stone-200 bg-white shadow-lg dark:border-stone-700
                                       dark:bg-stone-900"
                            >
                                <ul
                                    id="tld-list"
                                    role="listbox"
                                    class="max-h-64 overflow-y-auto py-1"
                                >
                                    <!--
                                        First, not last.
                                        
                                        A domain already picked is kept out of
                                        the results, so searching for one you
                                        have looks exactly like searching for
                                        one that does not exist. Below forty
                                        matches it may as well not be there:
                                        searching 'com' scrolled past .company
                                        and .community to say so.
                                    -->
                                    {#each tldAlready as tld (tld)}
                                        <li
                                            class="flex items-baseline justify-between gap-2 px-3 py-1.5
                                                   text-sm text-stone-500 dark:text-stone-400"
                                        >
                                            <span>.{tld}</span>
                                            <span class="text-xs">already added</span>
                                        </li>
                                    {/each}

                                    {#each tldMatches as entry, i (entry[0])}
                                        <li>
                                            <button
                                                type="button"
                                                role="option"
                                                aria-selected={i === tldIndex}
                                                onmousedown={(e) => {
                                                    e.preventDefault();
                                                    addTld(entry[0]);
                                                }}
                                                onmouseenter={() => (tldIndex = i)}
                                                class="flex w-full items-baseline gap-2 px-3 py-1.5 text-left text-sm
                                                       {i === tldIndex
                                                    ? 'bg-stone-100 dark:bg-stone-800'
                                                    : ''}"
                                            >
                                                <span>.{entry[0]}</span>
                                                {#if entry[1]}
                                                    <span class="text-xs text-stone-500"
                                                        >.{entry[1]}</span
                                                    >
                                                {/if}
                                            </button>
                                        </li>
                                    {/each}

                                    {#if tldMatches.length === 0 && tldAlready.length === 0}
                                        <li class="px-3 py-2 text-sm text-stone-500">
                                            No top-level domain matches “{tldQuery.trim()}”.
                                        </li>
                                    {/if}
                                </ul>
                                {#if tldMatches.length > 0}
                                    <p
                                        class="border-t border-stone-200 px-3 py-1.5 text-xs text-stone-500
                                               dark:border-stone-800 dark:text-stone-400"
                                    >
                                        ↑↓ to move · ↵ to add · ⌫ removes the last
                                    </p>
                                {/if}
                            </div>
                        {/if}
                    </div>

                    <!--
                        Each pill is two controls: the label toggles whether
                        that domain is a requirement, the cross stops checking
                        it altogether. Two questions about one domain, kept
                        together rather than in two lists to reconcile by eye.
                    -->
                    {#if tlds.length > 0}
                        <div class="mt-2 flex flex-wrap items-center gap-2">
                            {#each tlds as tld (tld)}
                                {@const isRequired = requiredTlds.includes(tld)}
                                <span
                                    class="flex items-center rounded-lg border text-sm transition-colors
                                           duration-150
                                           {isRequired
                                        ? 'border-stone-900 bg-stone-50 dark:border-stone-100 dark:bg-stone-800/50'
                                        : 'border-stone-200 dark:border-stone-800'}"
                                >
                                    <button
                                        type="button"
                                        onclick={() => {
                                            toggleRequiredTld(tld);
                                        }}
                                        aria-pressed={isRequired}
                                        aria-label={isRequired
                                            ? `.${tld} is required`
                                            : `.${tld} is reported but not required`}
                                        title={isRequired
                                            ? `A name taken on .${tld} is dropped. Click to only report it.`
                                            : `.${tld} is reported but never drops a name. Click to require it.`}
                                        class="py-2 pl-3 pr-1.5"
                                    >
                                        .{tld}<span
                                            class="ml-1.5 text-xs text-stone-500
                                                   dark:text-stone-400"
                                            >{isRequired ? 'required' : 'report only'}</span
                                        >
                                    </button>
                                    <button
                                        type="button"
                                        onclick={() => {
                                            removeTld(tld);
                                        }}
                                        aria-label="Stop checking .{tld}"
                                        class="px-2 py-2 text-stone-400 transition-colors duration-100
                                               hover:text-rose-700 dark:hover:text-rose-400"
                                        >×</button
                                    >
                                </span>
                            {/each}
                            <span class="text-xs text-stone-500 dark:text-stone-400">
                                {tlds.length} of {TLD_MAX}
                            </span>
                        </div>
                    {/if}
                    {#if problemFor('tlds')}
                        <p id="tlds-error" class="mt-1 text-xs text-rose-700 dark:text-rose-400">
                            {problemFor('tlds')}
                        </p>
                    {/if}
                </div>
            </div>

            <div class={ROW}>
                <div>
                    <span class="flex items-center gap-2 text-sm font-medium">
                        <FieldIcon paths={ICONS.stores} />Must be available on
                    </span>
                    <p class="mt-1 text-xs text-stone-500">
                        A required check drops a name the moment it fails. The others still run and
                        are reported.
                    </p>
                </div>
                <!--
                    All three on one row. They needed 402px and never had it in
                    the two-column layout; the control column is more than
                    twice that.
                -->
                <div class="flex flex-wrap gap-2">
                    {#each storeRequirements as r (r.key)}
                        <label
                            class="flex cursor-pointer items-center gap-2 rounded-lg border px-3 py-2 text-sm
                                   transition-colors duration-150
                                   {requiredStores[r.key]
                                ? 'border-stone-900 bg-stone-50 dark:border-stone-100 dark:bg-stone-800/50'
                                : 'border-stone-200 hover:border-stone-400 dark:border-stone-800 dark:hover:border-stone-600'}"
                        >
                            <input
                                type="checkbox"
                                class="accent-stone-900 dark:accent-stone-100"
                                checked={requiredStores[r.key]}
                                onchange={(e) => (requiredStores[r.key] = e.currentTarget.checked)}
                            />
                            {r.label}
                        </label>
                    {/each}
                </div>
            </div>

            <!--
                How much, where to, go — one row, at the end of the form.

                One thought, so one row. The four rows above describe the names:
                what to make them from, what to screen them against. These three
                are a different question — how many, where the answer goes, and
                start — and the address you are asked for belongs beside the
                sentence explaining why anyone wants it.

                The button is not alone down here the way it once was: it is the
                last third of the row it belongs to rather than an orphan under
                five fields.
            -->
            <div class={ROW}>
                <div>
                    <span id="dispatch-label" class="flex items-center gap-2 text-sm font-medium">
                        <FieldIcon paths={ICONS.count} />Run it
                    </span>
                    <p class="mt-1 text-xs text-stone-500">
                        How many names to generate, and where to send them. Results are emailed when
                        the run finishes — it takes a while, so you can close this.
                    </p>
                </div>
                <div class="flex flex-wrap items-center gap-x-3 gap-y-2">
                    <div class="flex items-center gap-2">
                        <label for="count" class="sr-only">How many names to generate</label>
                        <input
                            id="count"
                            bind:value={targetCount}
                            type="number"
                            min={COUNT_MIN}
                            max={COUNT_MAX}
                            step="50"
                            aria-invalid={problemFor('count') ? 'true' : undefined}
                            aria-describedby={problemFor('count') ? 'count-error' : undefined}
                            class="w-24 rounded-lg border bg-white px-3 py-2 text-sm tabular-nums
                                   focus:outline-none focus:ring-2 dark:bg-stone-950
                                   {problemFor('count')
                                ? 'border-rose-400 focus:border-rose-500 focus:ring-rose-500/20 dark:border-rose-800'
                                : 'border-stone-300 focus:border-stone-500 focus:ring-stone-900/10 dark:border-stone-700 dark:focus:ring-white/10'}"
                        />
                        <span class="text-sm text-stone-600 dark:text-stone-400"
                            >names, emailed to</span
                        >
                    </div>

                    <label for="email" class="sr-only">Email the results to</label>
                    <input
                        id="email"
                        bind:value={email}
                        type="email"
                        placeholder="you@example.com"
                        aria-invalid={problemFor('email') ? 'true' : undefined}
                        aria-describedby={problemFor('email') ? 'email-error' : undefined}
                        class="w-56 rounded-lg border bg-white px-3 py-2 text-sm
                               placeholder:text-stone-400 focus:outline-none focus:ring-2
                               dark:bg-stone-950 dark:placeholder:text-stone-600
                               {problemFor('email')
                            ? 'border-rose-400 focus:border-rose-500 focus:ring-rose-500/20 dark:border-rose-800'
                            : 'border-stone-300 focus:border-stone-500 focus:ring-stone-900/10 dark:border-stone-700 dark:focus:ring-white/10'}"
                    />

                    <!--
                        Only disabled while the request is in flight. Disabling
                        it for an incomplete form was the original problem here:
                        the button knew exactly what was missing and had no way
                        to say so.
                    -->
                    <button
                        onclick={pendingRunId ? askForCode : execute}
                        disabled={submitting}
                        class="rounded-lg bg-stone-900 px-5 py-2 text-sm font-medium text-white
                               transition-opacity duration-150 hover:opacity-90 disabled:opacity-40
                               dark:bg-white dark:text-stone-900"
                    >
                        {#if submitting}Starting…{:else if pendingRunId}Enter code{:else}Execute{/if}
                    </button>

                    <!-- w-full so a message takes its own line rather than
                         pushing the button off the end of the row. -->
                    {#if problemFor('count')}
                        <p id="count-error" class="w-full text-xs text-rose-700 dark:text-rose-400">
                            {problemFor('count')}
                        </p>
                    {/if}
                    {#if problemFor('email')}
                        <p id="email-error" class="w-full text-xs text-rose-700 dark:text-rose-400">
                            {problemFor('email')}
                        </p>
                    {/if}
                </div>
            </div>
        </div>

        <!--
            Always mounted, never open until asked. A <dialog> does nothing
            until showModal(), and one created at the moment it is needed would
            not yet be bound to the variable that opens it.
        -->
        <dialog
            bind:this={verifyDialog}
            aria-labelledby="verify-title"
            class="m-auto max-w-md rounded-xl border border-stone-200 bg-white p-6 text-stone-900
                   shadow-xl backdrop:bg-stone-900/40 dark:border-stone-800
                   dark:bg-stone-900 dark:text-stone-100"
        >
            <h2 id="verify-title" class="text-base font-semibold">Confirm your email</h2>
            {#if emailProblem}
                <p class="mt-2 text-sm text-rose-700 dark:text-rose-400">
                    The code could not be sent to {email}.
                </p>
                <p class="mt-1 text-xs text-rose-700/80 dark:text-rose-400/80">{emailProblem}</p>
            {:else}
                <p class="mt-2 text-sm text-stone-600 dark:text-stone-400">
                    We sent a six-digit code to <b class="text-stone-900 dark:text-stone-100"
                        >{email}</b
                    >. The run is queued and starts the moment it is confirmed.
                </p>
            {/if}
            <!--
                The code box is first, so showModal() puts the caret in it -
                there is exactly one thing to do here and it should not need a
                click first.
            -->
            <div class="mt-4 flex gap-2">
                <label for="code" class="sr-only">Six-digit code</label>
                <input
                    id="code"
                    bind:value={code}
                    inputmode="numeric"
                    maxlength="6"
                    autocomplete="one-time-code"
                    placeholder="000000"
                    class="w-32 rounded-lg border border-stone-300 px-3 py-2 text-sm tracking-[0.3em]
                           focus:border-stone-500 focus:outline-none focus:ring-2
                           focus:ring-stone-900/10 dark:border-stone-700 dark:bg-stone-950
                           dark:focus:ring-white/10"
                />
                <button
                    onclick={verify}
                    disabled={submitting || code.length < 6}
                    class="rounded-lg bg-stone-900 px-4 py-2 text-sm font-medium text-white
                           transition-opacity duration-150 enabled:hover:opacity-90
                           disabled:opacity-40 dark:bg-white dark:text-stone-900"
                >
                    {submitting ? 'Verifying…' : 'Verify and run'}
                </button>
            </div>
            {#if verifyProblem}
                <p class="mt-2 text-sm text-rose-700 dark:text-rose-400">{verifyProblem}</p>
            {/if}
            <!--
                Closing is not cancelling. The run exists and is waiting on this
                code; the header button becomes 'Enter code' and brings the
                dialog back, rather than starting a second run beside the first.
            -->
            <div class="mt-5 flex items-center justify-between gap-4">
                <p class="text-xs text-stone-500">
                    Close this and the run waits. Reopen it from Enter code.
                </p>
                <button
                    onclick={() => verifyDialog?.close()}
                    class="rounded-lg px-3 py-2 text-sm font-medium transition-colors duration-100
                           hover:bg-stone-100 dark:hover:bg-stone-800">Close</button
                >
            </div>
        </dialog>
    </section>
{:else if run}
    {@const watched = run}
    <!-- Watch: the brief collapses to a recap so the results get the room. -->
    <section
        class="mt-6 rounded-xl border border-stone-200 bg-white px-5 py-4
                  dark:border-stone-800 dark:bg-stone-900"
    >
        <p class="text-sm leading-relaxed text-stone-800 dark:text-stone-200">{run.brief}</p>
        <!--
            The row lightens its own text in dark mode. stone-500 on stone-800
            measures 3.2:1 at 12px; the same token passes comfortably on the
            light ground, which is how it survived unnoticed.
        -->
        <div
            class="mt-3 flex flex-wrap items-center gap-x-2 gap-y-1.5 text-xs text-stone-500
                   dark:text-stone-300"
        >
            {#each run.strategies ?? [] as s (s)}
                <span class="rounded bg-stone-100 px-1.5 py-0.5 dark:bg-stone-800">
                    {STRATEGIES.find((x) => x.id === s)?.label ?? s}
                </span>
            {/each}
            <span aria-hidden="true" class="hidden text-stone-400 sm:inline dark:text-stone-600"
                >·</span
            >
            <span>requires</span>
            {#each watched.checks.required as kind (kind)}
                <span class="rounded bg-stone-100 px-1.5 py-0.5 dark:bg-stone-800"
                    >{checkLabel(kind)}</span
                >
            {:else}
                <span class="italic">nothing - every name is reported</span>
            {/each}
            <span aria-hidden="true" class="hidden text-stone-400 sm:inline dark:text-stone-600"
                >·</span
            >
            <span>{run.email}</span>
        </div>
    </section>

    <!-- Progress reads left to right in the order the funnel actually runs. -->
    <section
        class="mt-4 flex flex-wrap items-center gap-x-8 gap-y-3 rounded-xl border
                  border-stone-200 bg-white px-5 py-4 dark:border-stone-800 dark:bg-stone-900"
    >
        <div class="flex items-center gap-2.5">
            <span class="relative flex h-2 w-2">
                {#if !finished}
                    <span
                        class="absolute inline-flex h-full w-full animate-ping rounded-full
                       bg-emerald-500 opacity-60"
                    ></span>
                {/if}
                <span
                    class="relative inline-flex h-2 w-2 rounded-full
                     {run.status === 'failed'
                        ? 'bg-rose-500'
                        : run.status === 'stopped'
                          ? 'bg-amber-500'
                          : finished
                            ? 'bg-stone-400'
                            : 'bg-emerald-500'}"
                ></span>
            </span>
            <span class="text-sm font-medium">{STATUS_LABEL[run.status] ?? run.status}</span>

            {#if stoppable}
                <button
                    onclick={() => stopDialog?.showModal()}
                    class="ml-2 rounded border border-stone-300 px-2 py-0.5 text-xs
                           transition-colors duration-100 hover:bg-stone-200
                           dark:border-stone-700 dark:hover:bg-stone-800">Stop</button
                >
            {/if}
        </div>
        {#each progress as stat (stat.label)}
            <div class="flex items-baseline gap-1.5">
                <!--
                    A null value is 'not established yet', and prints as a dash.
                    Zero is a finding, and this strip must not claim one it has
                    not made.
                -->
                <span
                    class="text-lg font-semibold tabular-nums
                    {stat.label === 'unverified' ? 'text-amber-700 dark:text-amber-400' : ''}"
                    >{stat.value ?? '—'}</span
                >
                {#if stat.of}<span class="text-sm text-stone-400 tabular-nums">/ {stat.of}</span
                    >{/if}
                <span
                    class="text-sm {stat.label === 'unverified'
                        ? 'text-amber-700/80 dark:text-amber-400/80'
                        : 'text-stone-500'}">{stat.label}</span
                >
            </div>
        {/each}
    </section>

    <!--
        Rendered whenever the run is stoppable, not only while confirming: a
        <dialog> is inert until showModal(), and mounting it on demand would
        mean opening it before the browser had it.

        m-auto because Tailwind's preflight zeroes the `margin: auto` that a
        <dialog> is centred by, which leaves it in the top-left corner - far
        enough from the button that started it to read as a different page.

        No backdrop click-to-close. The whole point of this dialog is that the
        dangerous answer takes a deliberate act, and a stray click on a page
        this dense is exactly what it exists to catch. Escape and 'Keep going'
        are both one action away, and Escape is handled in onKeydown rather
        than left to the browser.
    -->
    {#if stoppable}
        <dialog
            bind:this={stopDialog}
            aria-labelledby="stop-title"
            class="m-auto max-w-md rounded-xl border border-stone-200 bg-white p-6
                   text-stone-900 shadow-xl backdrop:bg-stone-900/40 dark:border-stone-800
                   dark:bg-stone-900 dark:text-stone-100"
        >
            <h2 id="stop-title" class="text-base font-semibold">Stop this run?</h2>
            <!--
                What survives and what does not, in that order. The count is
                read from the run rather than described in the abstract,
                because 'names already found are kept' means nothing until it
                says how many.
            -->
            <p class="mt-2 text-sm text-stone-600 dark:text-stone-400">
                The {run.generatedCount} name{run.generatedCount === 1 ? '' : 's'} generated so far and
                every verdict against them are kept, and stay readable at this link.
            </p>
            <p class="mt-2 text-sm text-stone-600 dark:text-stone-400">
                Nothing further is generated or checked, the remaining {Math.max(
                    0,
                    run.targetCount - run.generatedCount
                )} of {run.targetCount} are not attempted, and no results email is sent. A stopped run
                cannot be resumed.
            </p>
            <p class="mt-2 text-sm text-stone-600 dark:text-stone-400">
                This stops this run only. The worker stays running and takes the next queued run.
            </p>
            <div class="mt-5 flex items-center justify-end gap-2">
                <button
                    onclick={() => stopDialog?.close()}
                    class="rounded-lg px-3 py-2 text-sm font-medium transition-colors duration-100
                           hover:bg-stone-100 dark:hover:bg-stone-800">Keep going</button
                >
                <button
                    onclick={stopRun}
                    disabled={stopping}
                    class="rounded-lg bg-rose-700 px-3 py-2 text-sm font-medium text-white
                           transition-opacity duration-150 enabled:hover:opacity-90
                           disabled:opacity-60 dark:bg-rose-600"
                >
                    {stopping ? 'Stopping…' : 'Stop run'}
                </button>
            </div>
        </dialog>
    {/if}

    {#if run.error}
        <p
            class="mt-4 rounded-lg bg-rose-50 px-4 py-3 text-sm text-rose-800
              dark:bg-rose-950/50 dark:text-rose-200"
        >
            {run.error}
        </p>
    {/if}

    <!-- Table and console side by side: you read results while watching progress. -->
    <div class="mt-4 grid gap-4 lg:grid-cols-[minmax(0,1fr)_23rem]">
        <section class="min-w-0">
            <div class="mb-2 flex flex-wrap items-center justify-between gap-2">
                <label class="flex cursor-pointer items-center gap-2 text-sm">
                    <input
                        type="checkbox"
                        bind:checked={onlyPassed}
                        class="accent-stone-900 dark:accent-stone-100"
                    />
                    Only names that passed
                </label>
                {#if nearMisses.length > 0}
                    <!--
                        The list the product implies and never offered: names
                        held up only by a check that could not answer. They are
                        neither passes nor failures, and assembling them by
                        hand meant reading every amber cell in the table.
                    -->
                    <label
                        class="flex cursor-pointer items-center gap-2 text-sm text-amber-800
                               dark:text-amber-300"
                    >
                        <input
                            type="checkbox"
                            bind:checked={onlyNearMisses}
                            class="accent-amber-600"
                        />
                        Only near misses ({nearMisses.length})
                    </label>
                {/if}
                <button
                    onclick={copyCsv}
                    class="rounded-lg border border-stone-300 px-3 py-1.5 text-sm transition-colors
                 duration-150 hover:bg-stone-100 dark:border-stone-700 dark:hover:bg-stone-800"
                >
                    {copied ? 'Copied' : 'Copy CSV'}
                </button>
            </div>

            {#if byStrategy.length > 0}
                <div
                    class="mb-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-stone-500"
                >
                    <span>{totalNames} names</span>
                    {#each byStrategy as s (s.id)}
                        <!--
                            Short form, matching the cells directly below. The
                            long names live in the compose form, where their
                            examples explain them; two names for one thing
                            within 100px made the tally unreadable against the
                            column it describes.
                        -->
                        <span title={s.label}>
                            {strategyLabel(s.id)}
                            <b class="font-medium">{s.passed}</b>/{s.checked}
                            {#if s.checked !== s.total}
                                <!-- Only when they differ: on a completed run the
                                     third number is the second one again. -->
                                <span class="text-amber-700/80 dark:text-amber-500/70"
                                    >of {s.total}</span
                                >
                            {/if}
                        </span>
                    {/each}
                    {#if unattributed > 0}
                        <span>{unattributed} without a recorded approach</span>
                    {/if}
                </div>
            {/if}

            <div class="mb-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-stone-500">
                {#each LEGEND as l (l.status)}
                    <span class="whitespace-nowrap">
                        <span class="font-medium {CELL[l.status].class}"
                            >{CELL[l.status].icon} {CELL[l.status].text}</span
                        >
                        <span class="ml-1">{l.note}</span>
                    </span>
                {/each}
            </div>

            <!--
        The table scrolls inside its own panel rather than lengthening the page.
        A thousand rows on a page scroll takes the header away with it, and
        leaves the console stranded beside an endless column.
      -->
            <div
                class="h-[32rem] overflow-auto rounded-xl border border-stone-200
                  lg:h-[calc(100vh-19rem)] dark:border-stone-800"
            >
                <!--
          Fixed layout, and every column given a width.
          
          With automatic layout the browser sizes columns from their contents,
          so one cell changing from 'waiting' to 'taken' re-measures all 1052
          rows and repaints the whole table. That is the flashing: the DOM
          barely changes, but the layout is recomputed wholesale. Fixed layout
          takes widths from the first row alone, so a changed cell repaints
          itself and nothing else.
        -->
                <!--
                    w-max, not w-full.
                    
                    A run can ask for a dozen domains, and a table told to fit
                    its container obliges by crushing them: with seven checks
                    the last four columns were squeezed to 35px and their
                    headings overlapped, while the panel had a working
                    horizontal scrollbar it never used. Sized to its content
                    instead, the table overflows and the panel scrolls — which
                    is what the sticky name column was built for. min-w-full
                    keeps a short run filling the panel rather than trailing
                    off halfway.
                -->
                <table class="w-max min-w-full table-fixed text-sm">
                    <!--
            Only the action column flexes, so every other width is fixed.
            They previously summed to more than the panel and left the name
            fourteen pixels wide. One column per check, generated: which
            checks there are is the run's own business.
          -->
                    <colgroup>
                        <col style="width: 2.25rem" />
                        <col style="width: 10rem" />
                        <col style="width: 7rem" />
                        {#each columns as k (k)}
                            <col style="width: 6.25rem" />
                        {/each}
                        <col style="width: 6.5rem" />
                    </colgroup>
                    <!--
                        The heading is the label and its filter together. A
                        filtered column shows it: the control takes the accent
                        border and a clear button appears, so the reason a
                        table looks short is visible from the table.
                    -->
                    <thead class="sticky top-0 z-10 text-left">
                        <tr class="bg-stone-100 dark:bg-stone-900">
                            <th class="px-3 py-2.5 align-bottom {HEADER_EDGE}"></th>

                            <th
                                class="sticky left-0 z-20 bg-stone-100 px-3 py-2.5 align-bottom
                                after:absolute after:inset-y-0 after:-right-px after:w-px
                                after:bg-stone-200 dark:bg-stone-900 dark:after:bg-stone-800
                                {HEADER_EDGE}"
                                aria-sort={nameSort === 'asc'
                                    ? 'ascending'
                                    : nameSort === 'desc'
                                      ? 'descending'
                                      : 'none'}
                            >
                                <!--
                                    The button is named for the column, not for
                                    what clicking does: it is the header's
                                    accessible name, and aria-sort above already
                                    carries the state. The hint goes in a title,
                                    where it helps without renaming the column.
                                -->
                                <button
                                    onclick={() => (nameSort = NEXT_SORT[nameSort])}
                                    title={SORT_HINT[nameSort]}
                                    class="group flex items-center gap-1 pb-1 text-xs font-medium
                                           text-stone-500 transition-colors duration-100
                                           hover:text-stone-900 dark:hover:text-stone-100"
                                >
                                    Name
                                    <span
                                        aria-hidden="true"
                                        class={nameSort === 'none'
                                            ? 'opacity-0 transition-opacity group-hover:opacity-60'
                                            : ''}>{nameSort === 'desc' ? '↓' : '↑'}</span
                                    >
                                </button>
                                <div class="relative">
                                    <input
                                        bind:value={nameFilter}
                                        type="text"
                                        placeholder="contains…"
                                        aria-label="Filter names"
                                        class="{FILTER_INPUT} {nameFilter
                                            ? FILTER_ACTIVE
                                            : FILTER_IDLE} pr-6"
                                    />
                                    {#if nameFilter}
                                        <button
                                            onclick={() => (nameFilter = '')}
                                            aria-label="Clear the name filter"
                                            class={CLEAR_BUTTON}>×</button
                                        >
                                    {/if}
                                </div>
                            </th>

                            <th class="px-3 py-2.5 align-bottom whitespace-nowrap {HEADER_EDGE}">
                                <span class="block pb-1 text-xs font-medium text-stone-500">
                                    Approach
                                </span>
                                <div class="relative">
                                    <select
                                        bind:value={approachFilter}
                                        aria-label="Filter by approach"
                                        class="{FILTER_INPUT} {approachFilter
                                            ? FILTER_ACTIVE
                                            : FILTER_IDLE} pr-6"
                                    >
                                        <option value="">Any</option>
                                        {#each byStrategy as s (s.id)}
                                            <option value={s.id}>{strategyLabel(s.id)}</option>
                                        {/each}
                                    </select>
                                    {#if approachFilter}
                                        <button
                                            onclick={() => (approachFilter = '')}
                                            aria-label="Clear the approach filter"
                                            class={CLEAR_BUTTON}>×</button
                                        >
                                    {/if}
                                </div>
                            </th>

                            {#each columns as k (k)}
                                <th
                                    class="px-3 py-2.5 align-bottom whitespace-nowrap {HEADER_EDGE}"
                                >
                                    <span class="block pb-1 text-xs font-medium text-stone-500">
                                        {checkLabel(k)}
                                    </span>
                                    <div class="relative">
                                        <select
                                            bind:value={checkFilter[k]}
                                            aria-label="Filter by {checkLabel(k)}"
                                            class="{FILTER_INPUT} {checkFilter[k]
                                                ? FILTER_ACTIVE
                                                : FILTER_IDLE} pr-6"
                                        >
                                            <option value="">Any</option>
                                            {#each LEGEND as l (l.status)}
                                                <option value={l.status}
                                                    >{CELL[l.status].text}</option
                                                >
                                            {/each}
                                        </select>
                                        {#if checkFilter[k]}
                                            <button
                                                onclick={() => (checkFilter[k] = '')}
                                                aria-label="Clear the {checkLabel(k)} filter"
                                                class={CLEAR_BUTTON}>×</button
                                            >
                                        {/if}
                                    </div>
                                </th>
                            {/each}

                            <th
                                class="px-3 py-2.5 text-right align-bottom whitespace-nowrap {HEADER_EDGE}"
                            >
                                <span class="block pb-1 text-xs font-medium text-stone-500">
                                    Action
                                </span>
                                <button
                                    onclick={clearFilters}
                                    disabled={!anyFilter}
                                    class="w-full rounded border border-stone-300 px-2 py-1 text-xs
                                           transition-colors duration-100 enabled:hover:bg-stone-200
                                           disabled:opacity-0 dark:border-stone-700
                                           dark:enabled:hover:bg-stone-800"
                                >
                                    Clear all
                                    <kbd class="ml-0.5 opacity-60">esc</kbd>
                                </button>
                            </th>
                        </tr>
                    </thead>
                    <tbody>
                        {#each shown as c (c.id)}
                            <tr
                                class="border-t border-stone-100 bg-white transition-colors
                         duration-100 hover:bg-stone-50 dark:border-stone-800/70
                         dark:bg-stone-950 dark:hover:bg-stone-900"
                            >
                                <td class="px-3 py-1.5">
                                    <input
                                        type="checkbox"
                                        class="accent-stone-900 dark:accent-stone-100"
                                        checked={selected[c.id] ?? true}
                                        onchange={(e) => (selected[c.id] = e.currentTarget.checked)}
                                    />
                                </td>
                                <!--
                    Pinned, because the results are read on a phone.
                    The table is 819px of content in a 340px panel, so
                    scrolling to the verdicts used to take the names with it
                    and leave anonymous rows of ticks. bg-inherit keeps the
                    row's hover tint on the pinned cell.
                  -->
                                <td
                                    class="sticky left-0 z-10 bg-inherit px-3 py-1.5 font-medium
                                    after:absolute after:inset-y-0 after:-right-px after:w-px
                                    after:bg-stone-200 dark:after:bg-stone-800 {c.passed
                                        ? ''
                                        : 'text-stone-500 dark:text-stone-400'}"
                                >
                                    <!--
                    A button, because it is reachable by keyboard and a span
                    with a tabindex is not something a screen reader can
                    describe. The reason also stays in the title attribute, so
                    it survives without JavaScript and on touch.
                  -->
                                    <button
                                        type="button"
                                        title={c.rationale ?? ''}
                                        class="cursor-help text-left decoration-stone-300 decoration-dotted
                                 underline-offset-4 hover:underline dark:decoration-stone-600"
                                        onmouseenter={(e) => {
                                            showHint(e, c.rationale);
                                        }}
                                        onmouseleave={() => (hint = null)}
                                        onfocus={(e) => {
                                            showHint(e as unknown as MouseEvent, c.rationale);
                                        }}
                                        onblur={() => (hint = null)}>{c.name}</button
                                    >
                                </td>
                                <td
                                    class="px-3 py-1.5 whitespace-nowrap text-stone-500 dark:text-stone-400"
                                >
                                    {strategyLabel(c.strategy)}
                                </td>
                                {#each columns as k (k)}
                                    <td
                                        class="relative px-3 py-1.5 whitespace-nowrap {CELL[
                                            statusOf(c.statuses, k)
                                        ].class}"
                                        title={c.detail?.[k] || CELL[statusOf(c.statuses, k)].text}
                                    >
                                        {#if c.detail?.[k]}
                                            <!-- A verdict that found something links to what it found. -->
                                            <a
                                                href={checkSearch(k, c.name)}
                                                target="_blank"
                                                rel="external noopener noreferrer"
                                                aria-label="{c.name} — {checkLabel(k)}: {CELL[
                                                    statusOf(c.statuses, k)
                                                ].text}"
                                                class="underline decoration-dotted underline-offset-2 hover:decoration-solid"
                                                ><span aria-hidden="true"
                                                    >{CELL[statusOf(c.statuses, k)].icon}</span
                                                ></a
                                            >
                                        {:else}
                                            <span aria-hidden="true"
                                                >{CELL[statusOf(c.statuses, k)].icon}</span
                                            >
                                            <!--
                                                The cell is positioned so this cannot escape it.
                                                sr-only is position:absolute, and an absolutely
                                                positioned box is only clipped by an ancestor that
                                                is its containing block. Against a static cell it
                                                resolved against the page instead, landing at the
                                                table's full unscrolled height and leaving a
                                                thousand pixels of empty scroll below the layout.
                                            -->
                                            <span class="sr-only"
                                                >{c.name} — {checkLabel(k)}: {CELL[
                                                    statusOf(c.statuses, k)
                                                ].text}</span
                                            >
                                        {/if}
                                    </td>
                                {/each}
                                <!--
                  One button for the ordinary case - run whatever this run
                  requires - and a menu for the one check you actually doubt.
                -->
                                <td class="px-3 py-1.5 text-right whitespace-nowrap">
                                    <span
                                        class="inline-flex overflow-hidden rounded border border-stone-300
                               dark:border-stone-700"
                                    >
                                        <!--
                                            Both labels occupy one grid cell, so
                                            the button is as wide as the longer
                                            of them and does not resize when the
                                            state changes. A row that shifts
                                            width mid-click makes the whole
                                            column look unstable.
                                        -->
                                        <button
                                            onclick={() => recheck(c)}
                                            disabled={rechecking[c.id]}
                                            title="Re-run the checks this run requires"
                                            class="grid px-2 py-0.5 text-xs transition-colors
                                                   duration-100 hover:bg-stone-100
                                                   disabled:opacity-50 dark:hover:bg-stone-800"
                                        >
                                            <span
                                                class="col-start-1 row-start-1"
                                                class:invisible={rechecking[c.id]}>Check</span
                                            >
                                            <span
                                                class="col-start-1 row-start-1"
                                                class:invisible={!rechecking[c.id]}>Checking…</span
                                            >
                                        </button>
                                        <button
                                            onclick={(e) => {
                                                const r = (
                                                    e.currentTarget as HTMLElement
                                                ).getBoundingClientRect();
                                                menu =
                                                    menu?.id === c.id
                                                        ? null
                                                        : {
                                                              id: c.id,
                                                              x: r.right,
                                                              y: r.bottom + 4,
                                                              anchorTop: r.top
                                                          };
                                            }}
                                            disabled={rechecking[c.id]}
                                            id="row-menu-{c.id}"
                                            aria-haspopup="menu"
                                            aria-expanded={menu?.id === c.id}
                                            aria-label="Check one thing for {c.name}"
                                            class="border-l border-stone-300 px-1.5 py-0.5 text-xs transition-colors
                             duration-100 hover:bg-stone-100 disabled:opacity-50
                             dark:border-stone-700 dark:hover:bg-stone-800">▾</button
                                        >
                                    </span>
                                </td>
                            </tr>
                        {:else}
                            <tr
                                ><td
                                    colspan="8"
                                    class="px-4 py-12 text-center text-sm text-stone-500"
                                >
                                    {#if run.status === 'stopped'}
                                        Stopped before any name was generated.
                                    {:else if run.status === 'queued'}
                                        Queued. Waiting for the worker to pick this up.
                                    {:else if run.status === 'generating'}
                                        Generating {run.targetCount} names. They appear here in batches
                                        as they are written - the first arrives in a few minutes.
                                    {:else if anyFilter}
                                        No name matches these filters.
                                    {:else if onlyPassed}
                                        Nothing has cleared every requirement yet. Untick “only
                                        names that passed” to watch the checks land.
                                    {:else}
                                        Nothing yet.
                                    {/if}
                                </td></tr
                            >
                        {/each}
                    </tbody>
                </table>
            </div>
        </section>

        <!-- The worker runs on another machine, so its console is piped here. -->
        <section class="lg:sticky lg:top-6 lg:self-start">
            <button
                onclick={() => (consoleOpen = !consoleOpen)}
                class="mb-2 flex w-full items-center justify-between text-sm"
            >
                <span class="font-medium">Console</span>
                <span class="text-xs text-stone-500"
                    >{consoleOpen ? 'Hide' : `Show (${events.length})`}</span
                >
            </button>
            {#if consoleOpen}
                <div
                    bind:this={logEl}
                    class="h-72 overflow-y-auto rounded-xl border border-stone-200 bg-stone-50 p-3
                 font-mono text-xs leading-relaxed lg:h-[calc(100vh-19rem)]
                 dark:border-stone-800 dark:bg-stone-950"
                >
                    {#each events as e (e.id)}
                        <div class="flex gap-2 py-px">
                            <span class="shrink-0 text-stone-400 tabular-nums dark:text-stone-600"
                                >{time(e.at)}</span
                            >
                            <span class="{LEVEL[e.level] ?? LEVEL.info} break-words"
                                >{e.message}</span
                            >
                        </div>
                    {:else}
                        <p class="text-stone-500">
                            {#if run.status === 'queued'}
                                Waiting for a worker to pick this run up.
                            {:else if finished}
                                This run recorded no console output.
                            {:else}
                                No console output. The run is working - see the counters above - but
                                the worker process handling it started before console recording
                                existed, so it has no way to report its progress here.
                            {/if}
                        </p>
                    {/each}
                </div>
            {/if}
        </section>
    </div>

    {#if hint}
        <div
            class="pointer-events-none fixed z-50 max-w-xs rounded-lg border border-stone-200
                bg-white px-3 py-2 text-sm shadow-lg shadow-stone-900/10
                dark:border-stone-700 dark:bg-stone-900 dark:shadow-black/40"
            style="left: {hint.x}px; top: {hint.y}px"
        >
            {hint.text}
        </div>
    {/if}

    {#if menu}
        {@const openFor = menu.id}
        {@const row = candidates.find((c) => c.id === openFor)}
        <!--
      Fixed, not absolute. The table scrolls inside its own panel, so a menu
      anchored to the row would be clipped by that container's overflow.
    -->
        <div class="fixed inset-0 z-40" onclick={() => (menu = null)} role="presentation"></div>
        <div
            use:placed={{ x: menu.x, y: menu.y, anchorTop: menu.anchorTop }}
            role="menu"
            aria-label="Actions for this name"
            class="fixed z-50 min-w-44 -translate-x-full rounded-lg border border-stone-200
                bg-white py-1 shadow-lg shadow-stone-900/10 dark:border-stone-700
                dark:bg-stone-900 dark:shadow-black/40"
        >
            <p class="px-3 py-1 text-xs text-stone-500">Check one thing</p>
            {#each columns as k (k)}
                <button
                    onclick={() => row && recheck(row, k)}
                    class="flex w-full items-center justify-between gap-4 px-3 py-1.5 text-left text-sm
                 transition-colors duration-100 hover:bg-stone-100 dark:hover:bg-stone-800"
                >
                    <span>{checkLabel(k)}</span>
                    {#if row}
                        <span class="text-xs {CELL[statusOf(row.statuses, k)].class}">
                            <span aria-hidden="true">{CELL[statusOf(row.statuses, k)].icon}</span>
                            {CELL[statusOf(row.statuses, k)].text}
                        </span>
                    {/if}
                </button>
            {/each}
            {#if row}
                <div class="my-1 border-t border-stone-200 dark:border-stone-800"></div>
                <p class="px-3 py-1 text-xs text-stone-500">Look for yourself</p>
                {#each columns as k (k)}
                    <a
                        href={checkSearch(k, row.name)}
                        target="_blank"
                        rel="external noopener noreferrer"
                        onclick={() => (menu = null)}
                        class="block px-3 py-1.5 text-sm transition-colors duration-100
                    hover:bg-stone-100 dark:hover:bg-stone-800"
                    >
                        {checkLabel(k)} search ↗
                    </a>
                {/each}
            {/if}
        </div>
    {/if}
{/if}
