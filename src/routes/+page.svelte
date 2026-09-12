<script lang="ts">
    import {
        Button,
        ButtonGroup,
        Checkbox,
        Input,
        Select,
        Textarea,
        Table,
        TableBody,
        TableBodyCell,
        TableBodyRow,
        TableHead,
        TableHeadCell
    } from 'flowbite-svelte';
    import AppHeader from '$lib/AppHeader.svelte';
    import FieldIcon from '$lib/FieldIcon.svelte';
    import { DEFAULT_PLATFORMS, PLATFORMS, isPlatform } from '$lib/handles';
    import { LANGUAGE_GROUPS, LANGUAGES, isLanguage } from '$lib/languages';
    import { SEARCH_KEYS } from '$lib/search';
    import { ALL_TLDS, isTld, type TldEntry } from '$lib/tlds';
    import TokenSearch from '$lib/TokenSearch.svelte';
    import {
        checkLabel,
        checkSearch,
        handleKind,
        OWN_NAMES_MAX,
        parseOwnNames,
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

    /**
     * A finished run's settings, when this form was opened from one.
     *
     * Every field below reads it before its own default, so ?from= lands you
     * on the form you would have filled in — with one thing changed being the
     * point, rather than all of it retyped.
     */
    const seed = data.prefill ?? null;

    let brief = $state(data.run?.brief ?? seed?.brief ?? '');

    /**
     * Names the person already has, checked alongside the generated ones.
     *
     * Held as the raw text they typed rather than the parsed list, so the box
     * still reads back what they wrote — a field that silently rewrites itself
     * while somebody is mid-line is worse than one that waits until they stop.
     */
    let ownText = $state((data.run?.ownNames ?? seed?.ownNames ?? []).join('\n'));
    const own = $derived(parseOwnNames(ownText));

    let strategies = $state<string[]>(
        data.run?.strategies ?? seed?.strategies ?? ['compound', 'invented']
    );

    /**
     * Which languages 'Other languages' may draw on. Empty means any.
     *
     * Empty is the default and stays a real answer rather than an unset one:
     * unconstrained is what the approach meant before it could be narrowed,
     * and it is still right for somebody with no preference.
     */
    let languages = $state<string[]>(seed?.languages ?? []);
    let languageQuery = $state('');

    /**
     * Matches, best first.
     *
     * The last tier is what makes a families-only list usable. Somebody who
     * wants Japanese types 'japanese', which is not the name of anything on
     * offer — it is a language East Asian covers, and matching against
     * `covers` is the only reason that search finds anything at all.
     *
     * The tiers above it keep a name somebody typed ahead of one that merely
     * contains it, which is what the ranking was written for.
     */
    const languageMatches = $derived.by(() => {
        const q = languageQuery.trim().toLowerCase();
        const chosen = new Set(languages);
        const available = LANGUAGE_GROUPS.filter((l) => !chosen.has(l.id));
        if (!q) {
            return available.slice(0, 40);
        }

        // Four tiers: typed exactly, then starts the same way, then merely
        // contains it — and last, a family reached through a language it
        // covers, which is how 'japanese' arrives at East Asian.
        const exact: typeof available = [];
        const starts: typeof available = [];
        const contains: typeof available = [];
        const covered: typeof available = [];
        for (const l of available) {
            const label = l.label.toLowerCase();
            if (label === q) {
                exact.push(l);
            } else if (label.startsWith(q)) {
                starts.push(l);
            } else if (label.includes(q)) {
                contains.push(l);
            } else if (l.covers.some((c) => c.toLowerCase().includes(q))) {
                covered.push(l);
            }
        }
        return [...exact, ...starts, ...contains, ...covered].slice(0, 40);
    });

    function addLanguage(id: string) {
        if (!isLanguage(id) || languages.includes(id)) {
            return;
        }
        languages = [...languages, id];
        languageQuery = '';
    }

    const removeLanguage = (id: string): void => {
        languages = languages.filter((l) => l !== id);
    };

    /**
     * Chosen languages the query matches, named rather than silently hidden.
     *
     * Chosen entries are kept out of the results, so searching for one you
     * already have looks exactly like searching for one that does not exist.
     * The domain search learned this; the other two only inherited it when
     * they started sharing a control.
     */
    const languageAlready = $derived(
        languageQuery.trim()
            ? LANGUAGE_GROUPS.filter(
                  (l) =>
                      languages.includes(l.id) &&
                      l.label.toLowerCase().startsWith(languageQuery.trim().toLowerCase())
              )
            : []
    );

    /**
     * Chosen languages in the list's own order, not the order they were picked.
     *
     * Otherwise the pills read as a pick history rather than a selection, and
     * adding one later drops it at the end regardless of how common it is.
     */
    const chosenLanguages = $derived(LANGUAGES.filter((l) => languages.includes(l.id)));

    /**
     * The one approach that takes a setting, kept out of the card grid.
     *
     * Its picker used to be a row of the form in its own right, which said
     * nothing about which checkbox it answered to. It lives inside the card
     * now, so the ownership is the layout.
     */
    const FOREIGN_STRATEGY = STRATEGIES.find((s) => s.id === 'foreign') ?? STRATEGIES[0];
    const onForeign = $derived(strategies.includes('foreign'));

    /**
     * The domains to look for, and which of them a name must actually be free on.
     *
     * Two lists rather than one with a flag, because they are two questions
     * asked in two places: which columns the table has, and which of those can
     * end a name. Everything picked is checked and reported; only the required
     * ones drop anything.
     */
    let tlds = $state<string[]>(seed?.tlds ?? ['com']);
    let requiredTlds = $state<string[]>(seed?.requiredTlds ?? ['com']);

    /**
     * Social handles, the same two questions as the domains.
     *
     * Chips rather than a search, because there are three of them and there
     * will not be many more — a platform earns a place here by answering 404
     * for a free handle, and most do not. Off by default: a name can be a good
     * name without a matching GitHub org.
     */
    let handles = $state<string[]>(seed?.handles ?? [...DEFAULT_PLATFORMS]);
    let requiredHandles = $state<string[]>(seed?.requiredHandles ?? []);

    let handleQuery = $state('');

    /** Chosen platforms in the list's own order, which is most used first. */
    const chosenHandles = $derived(PLATFORMS.filter((p) => handles.includes(p.id)));

    const handleMatches = $derived.by(() => {
        const q = handleQuery.trim().toLowerCase().replace(/^@/, '');
        const chosen = new Set(handles);
        return PLATFORMS.filter(
            (p) =>
                !chosen.has(p.id) && (!q || p.id.includes(q) || p.label.toLowerCase().includes(q))
        );
    });

    const handleAlready = $derived(
        handleQuery.trim()
            ? PLATFORMS.filter(
                  (p) =>
                      handles.includes(p.id) &&
                      p.label.toLowerCase().startsWith(handleQuery.trim().toLowerCase())
              )
            : []
    );

    function addHandle(id: string) {
        if (!isPlatform(id) || handles.includes(id)) {
            return;
        }
        handles = [...handles, id];
        handleQuery = '';
    }

    function removeHandle(id: string) {
        handles = handles.filter((h) => h !== id);
        requiredHandles = requiredHandles.filter((h) => h !== id);
    }

    const toggleRequiredHandle = (id: string): void => {
        requiredHandles = requiredHandles.includes(id)
            ? requiredHandles.filter((h) => h !== id)
            : [...requiredHandles, id];
    };

    /**
     * What the run must clear, for the checks that are not domains.
     *
     * Still a record of booleans: there are three of them and there always
     * will be, which is exactly what stopped being true of the domains.
     */
    /**
     * The stores, on the same footing as the domains and the handles.
     *
     * They used to be three checkboxes that meant 'required' and nothing else:
     * all three always ran, and the box only decided whether one could drop a
     * name. There was no way to say 'do not ask Apple about this at all', even
     * though Apple is the slowest thing in the run.
     *
     * Two lists like the others — but three chips rather than a search box,
     * because searching a list of three is a worse control than looking at it.
     * Clicking cycles: not checked, checked, required.
     */
    let stores = $state<string[]>(
        // The web check is only offered where something can answer it.
        seed?.stores ?? (data.search ? [...STORE_ORDER] : STORE_ORDER.filter((k) => k !== 'google'))
    );
    let requiredStores = $state<string[]>(seed?.requiredStores ?? ['appStore', 'playStore']);

    /**
     * A Web column of search links, in place of a web check.
     *
     * Without a search provider the check can only be answered by driving a
     * browser at about a name a minute — sixteen hours for a thousand names —
     * so the form does not offer it. This is what remains that is useful: the
     * column, with a link on every row, and no verdict attached to it.
     */
    // let, not const: bind:checked writes to it, which prefer-const cannot see.

    let webLinks = $state(seed?.webLinks ?? false);

    /**
     * What goes after the nth item of a spoken list: ', ' between, ' or ' last.
     *
     * Five env vars rendered one per <code> cannot be joined into a string, so
     * the punctuation has to be placed rather than interleaved — and 'A, B, C,
     * D, E' reads as a set you need all of, which is the opposite of the rule.
     */
    const listSeparator = (index: number, length: number): string =>
        index === length - 1 ? '' : index === length - 2 ? ' or ' : ', ';

    function cycleStore(id: string) {
        if (!stores.includes(id)) {
            stores = [...stores, id];
            return;
        }
        if (!requiredStores.includes(id)) {
            requiredStores = [...requiredStores, id];
            return;
        }
        stores = stores.filter((s) => s !== id);
        requiredStores = requiredStores.filter((s) => s !== id);
    }
    /**
     * The domain search: query, whether the list is showing, and the highlight.
     *
     * A thousand options cannot be a row of chips, and a native <select multiple>
     * of a thousand is worse. This is the search-and-pick control people expect
     * for a list this size — type to narrow, arrows to move, Enter to take.
     */
    let tldQuery = $state('');

    /** Enough to scroll, few enough to render on every keystroke. */
    const TLD_SHOWN = 40;

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
        const starts: TldEntry[] = [];
        const contains: TldEntry[] = [];

        for (const entry of ALL_TLDS) {
            if (chosen.has(entry.tld)) {
                continue;
            }
            if (!q) {
                starts.push(entry);
            } else if (entry.tld.startsWith(q) || entry.label?.startsWith(q)) {
                starts.push(entry);
            } else if (entry.tld.includes(q) || entry.label?.includes(q)) {
                contains.push(entry);
            }
            if (starts.length >= TLD_SHOWN) {
                break;
            }
        }
        return [...starts, ...contains].slice(0, TLD_SHOWN);
    });

    function addTld(tld: string) {
        if (!isTld(tld) || tlds.includes(tld)) {
            return;
        }
        tlds = [...tlds, tld];
        tldQuery = '';
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

    let email = $state(data.run?.email ?? '');
    let targetCount = $state(data.run?.targetCount ?? seed?.targetCount ?? 1000);

    /**
     * What this selection will cost, in requests.
     *
     * There was a cap here — twelve, then twenty-five — and both were numbers
     * I picked rather than measured. A domain check is DNS and one call to a
     * host nobody else is calling, with no shared quota behind it, so there is
     * nothing to ration on anybody else's behalf; the only thing being spent
     * is the person's own afternoon, and that is theirs to spend.
     *
     * So the number is shown rather than enforced. Somebody asking for four
     * hundred domains can see what they have asked for before they start it.
     */
    const requestCount = $derived(Number.isInteger(targetCount) ? tlds.length * targetCount : 0);

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

        /*
         * Only where there is somewhere to send them.
         *
         * The field is already hidden without a Resend key — the server skips
         * the address entirely in that case and starts the run — but this list
         * asked for one anyway, so Execute refused with 'Add the address the
         * results should go to' and pointed at a field that was not on the
         * page. focusField then had nothing to focus, so the message named a
         * problem with no way to fix it.
         */
        if (data.mail) {
            const address = email.trim();
            if (address.length === 0) {
                out.push({ field: 'email', message: 'Add the address the results should go to.' });
            } else if (!EMAIL_SHAPE.test(address)) {
                out.push({
                    field: 'email',
                    message: `${address} does not look like an email address.`
                });
            }
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
        own: ['M4 7h10', 'M4 12h7', 'M4 17h10', 'M17 9.5l2.5 2.5L17 14.5'],
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
        email: ['M3.5 5.5h17v13h-17z', 'M3.5 6.5l8.5 6 8.5-6'],
        handle: [
            'M12 3.5a8.5 8.5 0 100 17 8.5 8.5 0 000-17z',
            'M15.5 12a3.5 3.5 0 10-7 0 3.5 3.5 0 007 0z',
            'M15.5 12v1.8a2.2 2.2 0 004.4 0V12'
        ],
        play: ['M8 5.5l11 6.5-11 6.5z'],
        /*
         * An asterisk for a requirement and an eye for a witness.
         *
         * The pills said 'required' and 'report only' in words, which is
         * unambiguous and, repeated across a dozen of them, most of what the
         * row was made of. The words are still there for a screen reader, in
         * the aria-label these buttons have always carried.
         *
         * The asterisk because that is what a required field has been marked
         * with for as long as there have been forms. A padlock was the first
         * attempt and reads as 'locked' or 'secure', which is a different
         * claim about a different thing.
         *
         * Three strokes rather than a typed '*', so it sits at the same size
         * and weight as the eye beside it — a glyph and an icon in one row
         * never line up.
         */
        required: ['M12 4.5v15', 'M5.5 8.25l13 7.5', 'M18.5 8.25l-13 7.5'],
        /*
         * A magnifier for a column you read yourself.
         *
         * Not the eye, which means 'checked and reported' — this column
         * establishes nothing, and borrowing the mark for a verdict would say
         * it had. Not the asterisk either: nothing here can be required.
         */
        search: ['M11 4.5a6.5 6.5 0 100 13 6.5 6.5 0 000-13z', 'M15.7 15.7L20 20'],
        report: [
            'M2.5 12s3.6-6.2 9.5-6.2 9.5 6.2 9.5 6.2-3.6 6.2-9.5 6.2S2.5 12 2.5 12z',
            'M14.4 12a2.4 2.4 0 10-4.8 0 2.4 2.4 0 004.8 0z'
        ]
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

    /**
     * What came of the last request for another code.
     *
     * Its own line rather than `verifyProblem`, which describes the code that
     * was typed. 'Give it 40 more seconds' is not a verdict on six digits, and
     * putting it where a wrong-code message goes reads as one.
     */
    let resendNote = $state('');
    let resendOk = $state(false);
    let resending = $state(false);

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
    let sourceFilter = $state('');
    // Keyed by check, and the checks are the run's own — so it starts empty
    // and gains a key the first time somebody filters on a column.
    let checkFilter = $state<Record<string, string>>({});

    const anyFilter = $derived(
        Boolean(
            nameFilter || approachFilter || sourceFilter || Object.values(checkFilter).some(Boolean)
        )
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
        sourceFilter = '';
        checkFilter = {};
    }
    // Open while there is something to watch, closed once there is not: a
    // finished run spent 23rem of the results area on historical chatter.
    /**
     * Shut, always.
     *
     * It used to open itself for a run still going, which is the run whose
     * results you are least able to read around a panel. The collapsed row
     * carries the worker's latest line instead, so a live run still shows a
     * pulse without taking the width to do it.
     */
    let consoleOpen = $state(false);

    /** The worker's most recent line, for the row that stands in for the panel. */
    const latest = $derived(events.at(-1));
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
        run
            ? run.checks.kinds
            : [
                  ...tlds.map(tldKind),
                  ...handles.map(handleKind),
                  ...STORE_ORDER.filter((k) => stores.includes(k))
              ]
    );

    /**
     * The Web column exists without being a check.
     *
     * Kept out of `columns` and handled separately everywhere it matters: it
     * has no verdict, so it must not reach a filter, a CSV cell, or
     * computePassed — the moment 'we did not look' can be counted, it starts
     * counting as 'nothing found'.
     */
    const linkColumn = $derived<CheckKind | null>(
        (run ? run.webLinks : webLinks) && !columns.includes('google') ? 'google' : null
    );

    /** Which checks the run treats as gates, as opposed to merely reporting. */
    const requiredKinds = $derived<CheckKind[]>(
        run
            ? run.checks.required
            : [
                  ...tlds.filter((t) => requiredTlds.includes(t)).map(tldKind),
                  ...handles.filter((h) => requiredHandles.includes(h)).map(handleKind),
                  ...STORE_ORDER.filter((k) => stores.includes(k) && requiredStores.includes(k))
              ]
    );

    const storeRequirements = STORE_ORDER.map((key) => ({ key, label: checkLabel(key) }));

    /**
     * The web check with no provider behind it.
     *
     * The chip stays, because leaving a hole in a row of three is its own kind
     * of confusion. What changes is what it can be: two states rather than
     * three — a column of links, or nothing — because there is no verdict to
     * report and so nothing that could be required.
     */
    const webIsLinkOnly = $derived(!data.search);

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
        skipped: { text: 'skipped', icon: '⊘', class: 'text-stone-500 dark:text-stone-400' },
        pending: { text: 'waiting', icon: '…', class: 'text-stone-500 dark:text-stone-400' }
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
        short: 'Abstract',
        respell: 'Respelled'
    };

    /** What a field with a problem looks like, in one place. */
    const FIELD_ERROR = 'border-rose-400 focus:border-rose-500 dark:border-rose-800';

    /** One look for the recap's chips, so the two groups differ by label and not by style. */
    const RECAP_CHIP =
        'rounded bg-stone-100 px-1.5 py-0.5 text-stone-600 dark:bg-stone-800 dark:text-stone-400';

    /** The hairline under a sticky header, which a border would scroll away from. */
    const FILTER_INPUT =
        'w-full rounded border bg-white px-1.5 py-1 text-xs font-normal ' +
        'placeholder:text-stone-500 dark:placeholder:text-stone-400 focus:ring-2 focus:ring-stone-900/10 ' +
        'dark:bg-stone-950 dark:placeholder:text-stone-400 dark:focus:ring-white/10';
    const FILTER_IDLE = 'border-stone-500';
    const FILTER_ACTIVE = 'border-stone-900 bg-stone-50 dark:border-stone-100 dark:bg-stone-800/60';
    const CLEAR_BUTTON =
        'absolute inset-y-0 right-0 flex w-5 items-center justify-center text-sm ' +
        'leading-none text-stone-500 dark:text-stone-400 hover:text-stone-900 dark:hover:text-stone-100';

    /**
     * The rule under the header, as a shadow rather than a border.
     *
     * A border on a sticky <thead> scrolls away from it — the cells stay put
     * and the line does not. It is heavier than it was, because the rows below
     * are striped now and a hairline was getting lost among them.
     */
    const HEADER_EDGE =
        'shadow-[inset_0_-2px_0_rgb(0_0_0/0.18)] dark:shadow-[inset_0_-2px_0_rgb(255_255_255/0.18)]';

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
        /*
         * Everything that does not depend on the row, hoisted out of the loop.
         *
         * This runs over as many as two thousand rows on every keystroke and
         * again on every poll. It was lowercasing the query once per row —
         * two thousand allocations to answer one question — and walking all
         * thirteen columns per row to find the one filter that was usually
         * set, or the none that usually were.
         */
        const needle = nameFilter.toLowerCase();
        const active = columns
            .filter((k) => checkFilter[k])
            .map((k) => [k, checkFilter[k]] as const);

        const matching = candidates.filter((c) => {
            if (needle && !c.name.toLowerCase().includes(needle)) {
                return false;
            }
            if (approachFilter && c.strategy !== approachFilter) {
                return false;
            }
            if (sourceFilter && (c.source ?? '') !== sourceFilter) {
                return false;
            }
            return active.every(([k, want]) => statusOf(c.statuses, k) === want);
        });
        if (nameSort === 'none') {
            return matching;
        }
        // filter() has already allocated, so sorting in place cannot disturb
        // the candidates array the rest of the page reads.
        const direction = nameSort === 'asc' ? 1 : -1;
        return matching.sort((a, b) => direction * a.name.localeCompare(b.name));
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

    /**
     * The generators that actually wrote something in this run.
     *
     * From the rows rather than from a fixed list: which sources a run used
     * depends on what was configured on the machine that ran it, and a run
     * loaded a month later should offer the labels it really has. Rows from
     * before the column existed carry no source and are grouped under one
     * option rather than left unfilterable.
     */
    const bySource = $derived([...new Set(candidates.map((c) => c.source ?? ''))].sort());

    const totalNames = $derived(tallies.reduce((sum, t) => sum + t.total, 0));
    const unattributed = $derived(tallies.find((t) => !t.strategy)?.total ?? 0);

    const passedCount = $derived(candidates.filter((c) => c.passed === true).length);

    /**
     * Blocked only by something we could not find out.
     *
     * The whole product turns on 'unverified' not being 'free', and every
     * number above the table used to drop the distinction: a name held up by
     * a bot-blocked domain counted the same as one that is genuinely taken.
     * These are the names that would pass if the checks could be completed, and
     * the strip counts them so 'passing' is never read as 'all that survived'.
     *
     * It backed a filter too — 'Only near misses' beside 'Only names that
     * passed'. Two lenses over one table is a control somebody has to learn
     * before the table means anything, and the unverified mark in the cell
     * says the same thing where the reading happens. The count stayed; the
     * lens went.
     */
    const nearMisses = $derived(
        candidates.filter(
            (c) =>
                requiredKinds.length > 0 &&
                requiredKinds.some((k) => statusOf(c.statuses, k) === 'unknown') &&
                requiredKinds.every((k) => ['clear', 'unknown'].includes(statusOf(c.statuses, k)))
        )
    );

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

    /**
     * How many more to look for, beside the button that asks.
     *
     * It used to double the target with nothing to say so, which is the right
     * guess and the wrong amount as often as not — a run that found three good
     * names out of fifty wants another fifty, one that found forty wants five.
     * Seeded from the run's own target, because a person who asked for fifty
     * thinks in fifties, and editable because that is the point.
     *
     * undefined rather than 0 for an empty box: Svelte binds a number input to
     * a number, and clearing it to retype gives undefined rather than ''. A
     * field that cannot be emptied cannot be retyped.
     */
    let more = $state<number | undefined>(data.run?.targetCount);
    const moreUsable = $derived(
        more !== undefined && Number.isInteger(more) && more > 0 && more <= 2000
    );

    /*
     * Seeded once, and then left alone.
     *
     * A run reached from the form rather than from a link arrives after this
     * component does, so the first sight of one fills the box — but only the
     * first. Refilling it whenever it is empty would mean a box that cannot be
     * cleared to retype, and refilling it on every poll would mean a box that
     * undoes what you just typed.
     */
    let moreSeeded = $state(data.run !== null);
    $effect(() => {
        if (run && !moreSeeded) {
            more = run.targetCount;
            moreSeeded = true;
        }
    });

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
                    languages,
                    tlds,
                    requiredTlds,
                    handles,
                    requiredHandles,
                    stores,
                    requiredStores,
                    /*
                     * Sent, which it never was.
                     *
                     * The schema defaults it to false, so leaving it out of
                     * the body was indistinguishable from choosing it off:
                     * the chip turned on, said 'Web shows a column of search
                     * links', and the run stored webLinks false and rendered
                     * no column. The one feature a deployment without a search
                     * provider has, and it could not be switched on.
                     */
                    webLinks,
                    requireAppStore: requiredStores.includes('appStore'),
                    requirePlayStore: requiredStores.includes('playStore'),
                    requireGoogle: requiredStores.includes('google'),
                    ownNames: own.names,
                    // null, not '': an untouched field is not an address.
                    email: email.trim() || null,
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
     * Which rerun is in flight, so its own button says so and both are held.
     *
     * Empty when nothing is running, which is also what the buttons read to
     * decide whether they are disabled.
     */
    let rerunning = $state<'' | 'fresh' | 'continue'>('');
    /**
     * Bumped to restart polling.
     *
     * The poll loop returns for good when a run reaches a terminal status,
     * which is right — and wrong the moment a finished run is asked for more
     * names, because the page is then watching something that has started
     * moving again. Reading this inside the effect is what lets that happen
     * without a reload.
     */
    let pollEpoch = $state(0);

    /**
     * Run these settings again.
     *
     * 'fresh' is a new run beside this one: the settings copied, the names
     * gone. 'continue' is this run asked for as many again, keeping every
     * name and every verdict already paid for.
     *
     * Changing something first is neither of these — that is `?from=`, which
     * is this run's settings loaded into the compose form.
     */
    async function rerun(mode: 'fresh' | 'continue', more?: number) {
        const current = run;
        if (!current || rerunning) {
            return;
        }
        rerunning = mode;
        problem = '';
        try {
            const response = await fetch(`/api/runs/${current.id}/rerun`, {
                method: 'POST',
                headers: { 'content-type': 'application/json' },
                body: JSON.stringify({ mode, more })
            });
            const body = (await response.json()) as { id?: string; message?: string };
            if (!response.ok || !body.id) {
                throw new Error(body.message ?? 'Could not start it again');
            }
            if (mode === 'fresh') {
                await openRun(body.id);
                return;
            }
            /*
             * Same run, same URL, so there is nothing to navigate to — but the
             * poll stopped when this run finished and has to be told the run
             * is moving again. Optimistic on the status so the strip does not
             * sit on 'Done' for a tick and a half.
             */
            run = { ...current, status: 'queued' };
            pollEpoch += 1;
        } catch (e) {
            problem = (e as Error).message;
        } finally {
            rerunning = '';
        }
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
        resendNote = '';
        /*
         * The box starts empty, because the digits in it are known to be wrong.
         *
         * Reopening kept whatever was rejected last time — so the caret landed
         * at the end of six wrong digits and the first thing to do was clear
         * them.
         */
        code = '';
        verifyDialog?.showModal();
    }

    /**
     * Ask for another code.
     *
     * The reason this exists: a code lasts twenty minutes and tolerates six
     * wrong guesses, and past either the run was stranded in a status nothing
     * could move it out of. The only way on was to compose it all again.
     */
    async function resendCode() {
        resending = true;
        resendNote = '';
        try {
            const response = await fetch(`/api/runs/${pendingRunId}/resend`, { method: 'POST' });
            const body = (await response.json()) as {
                sent?: boolean;
                problem?: string;
                message?: string;
                minutes?: number;
            };
            if (!response.ok) {
                throw new Error(body.message ?? 'Could not send another code');
            }
            resendOk = body.sent === true;
            resendNote = body.sent
                ? `A new code is on its way to ${email}. It is good for ${body.minutes} minutes.`
                : (body.problem ?? 'The code could not be sent.');
            if (body.sent) {
                // The old digits are dead the moment a newer code exists, so
                // leaving them in the box invites one more wrong attempt.
                code = '';
                verifyProblem = '';
                emailProblem = '';
            }
        } catch (e) {
            resendOk = false;
            resendNote = (e as Error).message;
        } finally {
            resending = false;
        }
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
        // Read, not used: this is what a rerun bumps to bring the loop back
        // after it retired on a terminal status.
        void pollEpoch;
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

    /**
     * Copy takes what the table is showing.
     *
     * There was a checkbox on every row on top of this, which is a second
     * selection mechanism over a table that already has five — the name
     * filter, the approach, a status per check, and 'only names that passed'.
     * Those say what a row is; ticking says only that somebody ticked it, and
     * the pair of them together meant a filtered table could still copy rows
     * that were not on screen.
     */
    async function copyCsv() {
        const header = ['Name', 'Approach', 'Source', ...columns.map(checkLabel)].join(',');
        const rows = shown.map((c) =>
            [
                c.name,
                strategyLabel(c.strategy),
                c.source ?? '',
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

<!--
    Which run this tab is, not which app.

    Every run page said 'Inoa', so several open at once were indistinguishable
    in the tab strip and in history — while /runs, one click away, has said
    'Runs · Inoa' all along. The brief is the only thing that tells them apart.
-->
<svelte:head>
    <title
        >{run
            ? `${run.brief.slice(0, 60)}${run.brief.length > 60 ? '…' : ''} · Inoa`
            : 'Inoa'}</title
    >
</svelte:head>

<svelte:window onkeydown={onKeydown} />

<AppHeader>
    <!--
        The way back to work already done.

        A run's id was its only handle: an hour of it reachable through one
        link in one email, and gone the moment that link was. On a deployment
        with no mail configured there was no link at all.
    -->
    <a
        href={resolve('/runs')}
        class="text-stone-600 underline underline-offset-4 hover:text-stone-900
               dark:text-stone-400 dark:hover:text-stone-100">Runs</a
    >
    {#if watching}
        <a
            href={resolve('/')}
            class="text-stone-600 underline underline-offset-4 hover:text-stone-900
                   dark:text-stone-400 dark:hover:text-stone-100">Start another</a
        >
    {/if}
</AppHeader>

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
                    <p id="brief-help" class="mt-1 text-xs text-stone-500 dark:text-stone-400">
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
                    <!--
                        One token, not the library's `color="red"`.

                        Two reasons. Textarea has no `color` prop at all, so
                        passing one lands a stray attribute and changes
                        nothing; and Input's red variant paints a rose-200
                        border where this app has always shown rose-400, so
                        using it on the fields that do accept it would have
                        left two fields disagreeing about what a problem looks
                        like — the exact thing the library is here to stop.
                    -->
                    <Textarea
                        id="brief"
                        bind:value={brief}
                        rows={2}
                        placeholder="A marketplace connecting local farms to restaurant kitchens."
                        aria-invalid={problemFor('brief') ? 'true' : undefined}
                        aria-describedby={problemFor('brief')
                            ? 'brief-help brief-error'
                            : 'brief-help'}
                        class="h-full w-full flex-1 text-sm {problemFor('brief')
                            ? FIELD_ERROR
                            : ''}"
                    />
                    {#if problemFor('brief')}
                        <p id="brief-error" class="mt-1 text-xs text-rose-700 dark:text-rose-400">
                            {problemFor('brief')}
                        </p>
                    {/if}
                </div>
            </div>

            <!--
                Names somebody already has, checked with the rest — and read.

                Under the brief because that is the order the thinking happens
                in: here is the business, and here is what I had already come up
                with. A brief says what the business does and nothing about what
                its owner likes the sound of; this says exactly that, so it
                shapes the generated names as well as being checked beside them.
                The count below still asks how many to make, and a shortlist you
                brought is not a substitute for those.
            -->
            <div class={ROW}>
                <div>
                    <label for="own" class="flex items-center gap-2 text-sm font-medium">
                        <FieldIcon paths={ICONS.own} />Your own names
                    </label>
                    <p id="own-help" class="mt-1 text-xs text-stone-500 dark:text-stone-400">
                        Optional. Names you already have, one per line. They are checked alongside
                        the generated ones, and the rest are written to match what you like about
                        them. They do not count towards the number below.
                    </p>
                </div>
                <div class="flex h-full flex-col">
                    <Textarea
                        id="own"
                        bind:value={ownText}
                        rows={2}
                        aria-describedby="own-help own-count"
                        class="h-full w-full flex-1 text-sm"
                    />
                    <!--
                        Said while they are still looking at the box.

                        A name dropped for a stray digit is otherwise only
                        noticed when the results come back without it, which is
                        an hour later and on a different screen.
                    -->
                    <p id="own-count" class="mt-1 text-xs text-stone-500 dark:text-stone-400">
                        {#if own.names.length > 0}
                            {own.names.length} name{own.names.length === 1 ? '' : 's'} to check
                        {:else if ownText.trim() === ''}
                            Leave empty if you have none.
                        {/if}
                        {#if own.rejected.length > 0}
                            <span class="text-amber-700 dark:text-amber-400">
                                — skipping {own.rejected.slice(0, 3).join(', ')}{own.rejected
                                    .length > 3
                                    ? ` and ${own.rejected.length - 3} more`
                                    : ''}: letters only, 3 to 16 of them.
                            </span>
                        {/if}
                        {#if own.names.length > OWN_NAMES_MAX}
                            <span class="text-rose-700 dark:text-rose-400">
                                — only the first {OWN_NAMES_MAX} will be kept.
                            </span>
                        {/if}
                    </p>
                </div>
            </div>

            <div class={ROW}>
                <div>
                    <h2 id="strategy-label" class="flex items-center gap-2 text-sm font-medium">
                        <FieldIcon paths={ICONS.strategy} />Naming strategy
                    </h2>
                    <p id="strategy-help" class="mt-1 text-xs text-stone-500 dark:text-stone-400">
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
                    <!--
                        Focused by name when the form is submitted with no strategy
                        chosen, and it used to suppress its own outline — so the page
                        scrolled somewhere and gave no sign of where. `focus:` rather
                        than `focus-visible:`, because this focus is only ever
                        programmatic and the heuristic reads that as not worth showing.
                    -->
                    <div
                        id="strategy"
                        tabindex="-1"
                        role="group"
                        aria-labelledby="strategy-label"
                        aria-describedby={problemFor('strategy')
                            ? 'strategy-help strategy-error'
                            : 'strategy-help'}
                        class="rounded-lg focus:outline-2 focus:outline-offset-4
                               focus:outline-stone-900 dark:focus:outline-stone-100"
                    >
                        <div class="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
                            {#each STRATEGIES.filter((s) => s.id !== 'foreign') as s (s.id)}
                                <label
                                    class="flex cursor-pointer items-start gap-2.5 rounded-lg border p-3 text-sm
                                       transition-colors duration-150
                                       {strategies.includes(s.id)
                                        ? 'border-stone-900 bg-stone-50 dark:border-stone-100 dark:bg-stone-800/50'
                                        : 'border-stone-500 hover:border-stone-900 dark:hover:border-stone-100'}"
                                >
                                    <Checkbox
                                        class="mt-0.5"
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
                                        <span
                                            class="block text-xs text-stone-500 dark:text-stone-400"
                                            >{s.hint}</span
                                        >
                                    </span>
                                </label>
                            {/each}
                        </div>
                        <!--
                            Other languages, out of the grid and full width,
                            because it is the only approach that takes a
                            setting.

                            The picker used to be a row of the form in its own
                            right, a sibling of Domains and Handles — so
                            nothing said it belonged to this checkbox rather
                            than to the form. Inside the card, revealed by the
                            box that enables it and indented under it, the
                            ownership is the layout rather than a sentence
                            asking you to infer it.
                        -->
                        <div
                            class="mt-2 rounded-lg border transition-colors duration-150
                                   {onForeign
                                ? 'border-stone-900 bg-stone-50 dark:border-stone-100 dark:bg-stone-800/50'
                                : 'border-stone-500 hover:border-stone-900 dark:hover:border-stone-100'}"
                        >
                            <label class="flex cursor-pointer items-start gap-2.5 p-3 text-sm">
                                <Checkbox
                                    class="mt-0.5"
                                    checked={onForeign}
                                    onchange={(e) => {
                                        const on = e.currentTarget.checked;
                                        strategies = on
                                            ? [...strategies, 'foreign']
                                            : strategies.filter((x) => x !== 'foreign');
                                    }}
                                />
                                <span>
                                    <span class="font-medium">{FOREIGN_STRATEGY.label}</span>
                                    <span class="block text-xs text-stone-500 dark:text-stone-400"
                                        >{FOREIGN_STRATEGY.hint}</span
                                    >
                                </span>
                            </label>

                            {#if onForeign}
                                <!--
                                    Indented behind a rule that starts where
                                    the label above it does, so the eye reads
                                    it as belonging to that checkbox and not to
                                    the card's edge.
                                -->
                                <div
                                    class="mb-3 ml-8 mr-3 border-l border-stone-300 pl-3
                                           dark:border-stone-700"
                                >
                                    <span
                                        id="languages-label"
                                        class="text-xs text-stone-500 dark:text-stone-400"
                                    >
                                        Which languages to draw on. Twelve families, each covering
                                        several — search a language and you get the family it
                                        belongs to. Leave it empty for any.
                                    </span>
                                    <TokenSearch
                                        id="languages"
                                        labelledBy="languages-label"
                                        placeholder="Search families — Nordic, Bantu, Japanese…"
                                        matches={languageMatches.map((l) => ({
                                            id: l.id,
                                            label: l.label,
                                            // Every option is a family now, and what
                                            // it covers is the only way to tell which
                                            // one you want. Trailing '…' where the
                                            // list goes on, so four never reads as all.
                                            note:
                                                l.covers.slice(0, 4).join(', ') +
                                                (l.covers.length > 4 ? '…' : '')
                                        }))}
                                        already={languageAlready.map((l) => ({
                                            id: l.id,
                                            label: l.label
                                        }))}
                                        bind:query={languageQuery}
                                        onpick={addLanguage}
                                        onremovelast={() => {
                                            removeLanguage(
                                                languages[languages.length - 1] as string
                                            );
                                        }}
                                    />

                                    {#if chosenLanguages.length > 0}
                                        <div class="mt-2 flex flex-wrap items-start gap-2">
                                            {#each chosenLanguages as l (l.id)}
                                                <span
                                                    class="flex items-center rounded-lg border
                                                           border-stone-500 bg-white text-sm
                                                           dark:bg-stone-950"
                                                >
                                                    <span class="py-2 pl-3 pr-1.5">{l.label}</span>
                                                    <button
                                                        type="button"
                                                        onclick={() => {
                                                            removeLanguage(l.id);
                                                        }}
                                                        aria-label="Stop using {l.label}"
                                                        class="px-2 py-2 text-stone-500 dark:text-stone-400
                                                               transition-colors duration-100
                                                               hover:text-rose-700
                                                               dark:hover:text-rose-400">×</button
                                                    >
                                                </span>
                                            {/each}
                                            <span
                                                class="self-center text-xs text-stone-500 dark:text-stone-400"
                                            >
                                                {languages.length}
                                                {languages.length === 1 ? 'family' : 'families'}
                                            </span>
                                        </div>
                                    {:else}
                                        <p class="mt-2 text-xs text-stone-500 dark:text-stone-400">
                                            any language
                                        </p>
                                    {/if}
                                </div>
                            {/if}
                        </div>
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
                    <h2 id="tlds-label" class="flex items-center gap-2 text-sm font-medium">
                        <FieldIcon paths={ICONS.domain} />Domains to check
                    </h2>
                    <p id="tlds-help" class="mt-1 text-xs text-stone-500 dark:text-stone-400">
                        Each one gets a column of its own. Click a domain to make it a requirement:
                        a required domain drops the name the moment it is taken, the rest are
                        checked and reported either way.
                    </p>
                    <p class="mt-1 text-xs text-stone-500 dark:text-stone-400">
                        Every domain is one request per name — {requestCount.toLocaleString()} for this
                        run as it stands. There is no limit but your patience; nobody's quota is spent
                        on these. Prices are indicative first-year registration.
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
                    <TokenSearch
                        id="tlds"
                        labelledBy="tlds-label"
                        placeholder="Search top-level domains — .com, .io, .ai…"
                        matches={tldMatches.map((t) => ({
                            id: t.tld,
                            label: `.${t.tld}`,
                            note: t.label ? `.${t.label}` : undefined,
                            meta: `$${t.usd.toFixed(2)}`
                        }))}
                        already={tldAlready.map((tld) => ({ id: tld, label: `.${tld}` }))}
                        bind:query={tldQuery}
                        onpick={addTld}
                        onremovelast={() => {
                            removeTld(tlds[tlds.length - 1] as string);
                        }}
                    />

                    <!--
                        Each pill is two controls: the label toggles whether
                        that domain is a requirement, the cross stops checking
                        it altogether. Two questions about one domain, kept
                        together rather than in two lists to reconcile by eye.
                    -->
                    {#if tlds.length > 0}
                        <div class="mt-2 flex flex-wrap items-start gap-2">
                            {#each tlds as tld (tld)}
                                {@const isRequired = requiredTlds.includes(tld)}
                                <span
                                    class="flex items-center rounded-lg border text-sm transition-colors
                                           duration-150
                                           {isRequired
                                        ? 'border-stone-900 bg-stone-50 dark:border-stone-100 dark:bg-stone-800/50'
                                        : 'border-stone-500'}"
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
                                        class="flex items-center gap-1.5 py-2 pl-3 pr-1.5"
                                    >
                                        .{tld}
                                        <FieldIcon
                                            paths={isRequired ? ICONS.required : ICONS.report}
                                            class="size-3.5 text-stone-500 dark:text-stone-400"
                                        />
                                    </button>
                                    <button
                                        type="button"
                                        onclick={() => {
                                            removeTld(tld);
                                        }}
                                        aria-label="Stop checking .{tld}"
                                        class="px-2 py-2 text-stone-500 dark:text-stone-400 transition-colors duration-100
                                               hover:text-rose-700 dark:hover:text-rose-400"
                                        >×</button
                                    >
                                </span>
                            {/each}
                            <span class="self-center text-xs text-stone-500 dark:text-stone-400">
                                {tlds.length}
                                {tlds.length === 1 ? 'domain' : 'domains'}
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
                    <h2 id="handles-label" class="flex items-center gap-2 text-sm font-medium">
                        <FieldIcon paths={ICONS.handle} />Social handles
                    </h2>
                    <p class="mt-1 text-xs text-stone-500 dark:text-stone-400">
                        Each one gets a column of its own. Click a platform to make it a
                        requirement: a required platform drops the name the moment the handle is
                        taken, the rest are checked and reported either way.
                    </p>
                    <p class="mt-1 text-xs text-stone-500 dark:text-stone-400">
                        Only platforms that answer definitively are listed. Reddit, Medium and
                        LinkedIn refuse the question outright, and a check that could only guess is
                        worse than no check at all.
                    </p>
                </div>
                <!--
                    The domains' control, because it is the same problem.

                    This was three chips when three platforms could be checked
                    at all. There are ten now, and a row of ten is a wall — so
                    it searches and shows what has been picked, exactly as the
                    domains do. One control learned once.
                -->
                <div>
                    <TokenSearch
                        id="handles"
                        labelledBy="handles-label"
                        placeholder="Search platforms — Instagram, TikTok, X…"
                        matches={handleMatches.map((p) => ({ id: p.id, label: `@${p.label}` }))}
                        already={handleAlready.map((p) => ({ id: p.id, label: `@${p.label}` }))}
                        bind:query={handleQuery}
                        onpick={addHandle}
                        onremovelast={() => {
                            removeHandle(handles[handles.length - 1] as string);
                        }}
                    />

                    {#if handles.length > 0}
                        <div class="mt-2 flex flex-wrap items-start gap-2">
                            {#each chosenHandles as site (site.id)}
                                {@const id = site.id}
                                {@const must = requiredHandles.includes(id)}
                                <span
                                    class="flex items-center rounded-lg border text-sm transition-colors
                                           duration-150
                                           {must
                                        ? 'border-stone-900 bg-stone-50 dark:border-stone-100 dark:bg-stone-800/50'
                                        : 'border-stone-500'}"
                                >
                                    <button
                                        type="button"
                                        onclick={() => {
                                            toggleRequiredHandle(id);
                                        }}
                                        aria-pressed={must}
                                        aria-label={must
                                            ? `@${site.label} is required`
                                            : `@${site.label} is reported but not required`}
                                        title={must
                                            ? `A name taken on ${site.label} is dropped. Click to only report it.`
                                            : `${site.label} is reported but never drops a name. Click to require it.`}
                                        class="flex items-center gap-1.5 py-2 pl-3 pr-1.5"
                                    >
                                        @{site.label}
                                        <FieldIcon
                                            paths={must ? ICONS.required : ICONS.report}
                                            class="size-3.5 text-stone-500 dark:text-stone-400"
                                        />
                                    </button>
                                    <button
                                        type="button"
                                        onclick={() => {
                                            removeHandle(id);
                                        }}
                                        aria-label="Stop checking {site.label}"
                                        class="px-2 py-2 text-stone-500 dark:text-stone-400 transition-colors duration-100
                                               hover:text-rose-700 dark:hover:text-rose-400"
                                        >×</button
                                    >
                                </span>
                            {/each}
                            <span class="self-center text-xs text-stone-500 dark:text-stone-400">
                                {handles.length}
                                {handles.length === 1 ? 'platform' : 'platforms'}
                            </span>
                        </div>
                    {/if}
                </div>
            </div>

            <div class={ROW}>
                <div>
                    <!--
                        'Must be available on' was accurate when these three
                        were checkboxes meaning required-or-not. They are three
                        states now, two of which are not 'must', so the heading
                        names the things rather than the rule — like the two
                        rows above it.
                    -->
                    <h2 class="flex items-center gap-2 text-sm font-medium">
                        <FieldIcon paths={ICONS.stores} />Stores and the web
                    </h2>
                    <p class="mt-1 text-xs text-stone-500 dark:text-stone-400">
                        Click to check one, click again to require it, once more to leave it out
                        altogether. The App Store is the slowest thing in a run, so leaving it out
                        is worth having.
                    </p>
                </div>
                <!--
                    Three chips rather than the search the domains and handles
                    use. Same two questions and the same two marks, but there
                    are three of these and there always will be — searching a
                    list of three is a worse control than looking at it.

                    Off, checked, required, in that order, because that is the
                    order of increasing commitment and a click should mean
                    'more'.
                -->
                <!--
                    items-start, or they stretch.

                    A flex row defaults to items-stretch, and this one is a
                    grid cell as tall as the rail beside it — so each chip grew
                    to 88px against the 38px pills two rows above. The same
                    control at two heights on one form is most of what makes a
                    page look like several.
                -->
                <!--
                    Wrapped, so the flex row is as tall as its own content.

                    Left as the grid cell itself it was 76px tall — the height
                    of the rail beside it — and the count centred against that
                    rather than against the chips, sitting 25px below them
                    while the same count two rows up sat level. The other rows
                    have this wrapper; this one had grown without it.
                -->
                <div>
                    <div class="flex flex-wrap items-start gap-2">
                        <!--
                            The Web chip is only offered when something can
                            answer it. Otherwise the only honest choices are
                            'do not look' and the link column below.
                        -->
                        {#each storeRequirements as r (r.key)}
                            {@const linkOnly = r.key === 'google' && webIsLinkOnly}
                            {@const on = linkOnly ? webLinks : stores.includes(r.key)}
                            {@const must = !linkOnly && requiredStores.includes(r.key)}
                            <!--
                                A Button, but still a tri-state control.

                                Off, checked, required — three states, and the
                                library has two. `outline` carries off-versus-on
                                and the class carries required, which is the
                                only part it cannot express; everything else
                                about the chip is now the same button the rest
                                of the app uses.
                            -->
                            <Button
                                type="button"
                                size="sm"
                                color="alternative"
                                onclick={() => {
                                    if (linkOnly) {
                                        webLinks = !webLinks;
                                    } else {
                                        cycleStore(r.key);
                                    }
                                }}
                                aria-pressed={on}
                                aria-label={linkOnly
                                    ? on
                                        ? 'Web shows a column of search links'
                                        : 'Web is not shown'
                                    : on
                                      ? `${r.label} is ${must ? 'required' : 'reported but not required'}`
                                      : `${r.label} is not being checked`}
                                title={linkOnly
                                    ? on
                                        ? 'A column of search links, one per name. Click to remove it.'
                                        : 'No search provider is configured, so this cannot be checked. Click to add a column of search links instead.'
                                    : on
                                      ? must
                                          ? `A name taken on ${r.label} is dropped. Click to leave it out.`
                                          : `${r.label} is reported but never drops a name. Click to require it.`
                                      : `${r.label} is not checked at all. Click to check it.`}
                                class="flex items-center gap-1.5 {must
                                    ? 'border-stone-900 bg-stone-50 dark:border-stone-100 dark:bg-stone-800/50'
                                    : on
                                      ? ''
                                      : 'text-stone-500 dark:text-stone-400'}"
                            >
                                {r.label}
                                {#if on}
                                    <FieldIcon
                                        paths={linkOnly
                                            ? ICONS.search
                                            : must
                                              ? ICONS.required
                                              : ICONS.report}
                                        class="size-3.5 text-stone-500 dark:text-stone-400"
                                    />
                                {/if}
                            </Button>
                        {/each}
                        <!-- The same count the other two rows carry. -->
                        <span class="self-center text-xs text-stone-500 dark:text-stone-400">
                            {stores.length}
                            {stores.length === 1 ? 'check' : 'checks'}
                        </span>
                    </div>
                    <!--
                        Under the control it is about, not in the rail.

                        The rail is 18rem, so five env vars set in it wrapped to
                        five lines and made this row the tallest on the form to
                        explain the third of three chips. Out here it has the
                        width of the column and costs a line or two.

                        Shown only once Web is on, because that is when it
                        stops being background and starts being the next thing
                        to do — the chip's own tooltip already answers why it
                        behaves differently before then.
                    -->
                    {#if webIsLinkOnly && webLinks}
                        <p class="mt-3 max-w-3xl text-xs text-stone-500 dark:text-stone-400">
                            No search provider is configured, so the web cannot be checked. Web adds
                            a column of links to search yourself — never a verdict. Set any one of
                            {#each SEARCH_KEYS as key, i (key)}<code
                                    class="rounded bg-stone-100 px-1 py-px font-mono text-[0.7rem]
                                           text-stone-600 dark:bg-stone-800 dark:text-stone-300"
                                    >{key}</code
                                >{listSeparator(i, SEARCH_KEYS.length)}{/each} and it becomes a real check.
                            Set several and a run spreads across every allowance rather than draining
                            one.
                        </p>
                    {/if}
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
                    <h2 id="dispatch-label" class="flex items-center gap-2 text-sm font-medium">
                        <FieldIcon paths={ICONS.count} />Run it
                    </h2>
                    <p class="mt-1 text-xs text-stone-500 dark:text-stone-400">
                        {#if data.mail}
                            How many names to generate, and where to send them. Results are emailed
                            when the run finishes — it takes a while, so you can close this.
                        {:else}
                            How many names to generate. Results appear here as they arrive; with no
                            Resend key configured there is nowhere to email them, so keep the link.
                        {/if}
                    </p>
                </div>
                <div class="flex flex-wrap items-center gap-x-3 gap-y-2">
                    <div class="flex items-center gap-2">
                        <label for="count" class="sr-only">How many names to generate</label>
                        <Input
                            id="count"
                            bind:value={targetCount}
                            type="number"
                            min={COUNT_MIN}
                            max={COUNT_MAX}
                            step="50"
                            aria-invalid={problemFor('count') ? 'true' : undefined}
                            aria-describedby={problemFor('count') ? 'count-error' : undefined}
                            class="w-24 text-sm tabular-nums {problemFor('count')
                                ? FIELD_ERROR
                                : ''}"
                        />
                        <span class="text-sm text-stone-600 dark:text-stone-400"
                            >{data.mail ? 'names, emailed to' : 'names'}</span
                        >
                    </div>

                    <!--
                        Only where it can be used.

                        With no Resend key there is no way to send a code, so
                        no way to prove an address belongs to whoever typed it,
                        and nowhere to send a result — asking would collect a
                        detail nothing can do anything with. The run starts
                        immediately instead, and its page is where the results
                        live.
                    -->
                    {#if data.mail}
                        <label for="email" class="sr-only">Email the results to</label>
                        <Input
                            id="email"
                            bind:value={email}
                            type="email"
                            placeholder="you@example.com"
                            aria-invalid={problemFor('email') ? 'true' : undefined}
                            aria-describedby={problemFor('email') ? 'email-error' : undefined}
                            class="w-56 text-sm {problemFor('email') ? FIELD_ERROR : ''}"
                        />
                    {/if}

                    <!--
                        Only disabled while the request is in flight. Disabling
                        it for an incomplete form was the original problem here:
                        the button knew exactly what was missing and had no way
                        to say so.
                    -->
                    <!--
                        ml-auto: the row reads left to right as a sentence —
                        how many, where to — and the thing that acts on it
                        belongs at the end of the line rather than tucked
                        against the address.

                        The icon takes the button's own colour rather than the
                        rail's muted grey, which is what the empty class is for.
                    -->
                    <Button
                        onclick={pendingRunId ? askForCode : execute}
                        disabled={submitting}
                        color="primary"
                        class="ml-auto flex items-center gap-2"
                    >
                        <FieldIcon paths={ICONS.play} class="size-4" />
                        {#if submitting}Starting…{:else if pendingRunId}Enter code{:else}Execute{/if}
                    </Button>

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

            <!--
                What the marks in the pills above mean.
                
                A key at the foot of the form rather than a word inside every
                pill: the distinction is binary and repeated a dozen times, so
                saying it once where a form's key is always looked for costs a
                line and buys back a row.

                Both marks, not just the asterisk. A legend that explains one
                of two symbols leaves the other looking like decoration.
            -->
            <div
                class="flex flex-wrap items-center gap-x-6 gap-y-1 pt-4 text-xs text-stone-500 dark:text-stone-400"
            >
                <span class="flex items-center gap-1.5">
                    <FieldIcon
                        paths={ICONS.required}
                        class="size-3.5 text-stone-500 dark:text-stone-400"
                    />
                    required — a name taken here is dropped
                </span>
                <span class="flex items-center gap-1.5">
                    <FieldIcon
                        paths={ICONS.report}
                        class="size-3.5 text-stone-500 dark:text-stone-400"
                    />
                    reported — checked, but never drops a name
                </span>
                {#if webIsLinkOnly}
                    <span class="flex items-center gap-1.5">
                        <FieldIcon
                            paths={ICONS.search}
                            class="size-3.5 text-stone-500 dark:text-stone-400"
                        />
                        a link to search yourself — nothing is checked
                    </span>
                {/if}
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
                <Input
                    id="code"
                    bind:value={code}
                    inputmode="numeric"
                    maxlength={6}
                    autocomplete="one-time-code"
                    placeholder="000000"
                    class="w-32 text-sm tracking-[0.3em]"
                />
                <Button onclick={verify} disabled={submitting || code.length < 6} color="primary">
                    {submitting ? 'Verifying…' : 'Verify and run'}
                </Button>
            </div>
            {#if verifyProblem}
                <p class="mt-2 text-sm text-rose-700 dark:text-rose-400">{verifyProblem}</p>
            {/if}
            {#if resendNote}
                <p
                    class="mt-2 text-sm {resendOk
                        ? 'text-stone-600 dark:text-stone-400'
                        : 'text-rose-700 dark:text-rose-400'}"
                >
                    {resendNote}
                </p>
            {/if}
            <!--
                Closing is not cancelling. The run exists and is waiting on this
                code; the header button becomes 'Enter code' and brings the
                dialog back, rather than starting a second run beside the first.
            -->
            <div class="mt-5 flex items-center justify-between gap-4">
                <p class="text-xs text-stone-500 dark:text-stone-400">
                    Close this and the run waits. Reopen it from Enter code.
                </p>
                <div class="flex items-center gap-1">
                    <!--
                        Quiet, but present. A code that never arrived or has
                        since expired used to leave the run stranded, and the
                        only route on was to fill the form in again.
                    -->
                    <Button onclick={resendCode} disabled={resending} color="alternative"
                        >{resending ? 'Sending…' : 'Send another code'}</Button
                    >
                    <Button onclick={() => verifyDialog?.close()} color="alternative">Close</Button>
                </div>
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
            A labelled list, because the chips were ambiguous without one.

            The approaches and the requirements were two runs of identically
            styled chips with the bare word 'requires' floating between them —
            so which group a chip belonged to depended on noticing a preposition
            mid-row. Naming both groups costs one column and settles it.
        -->
        <dl class="mt-3 grid gap-x-4 gap-y-1.5 text-xs sm:grid-cols-[auto_minmax(0,1fr)]">
            <dt class="text-stone-500 dark:text-stone-400">Approaches</dt>
            <dd class="flex flex-wrap items-center gap-1.5">
                {#each run.strategies ?? [] as approach (approach)}
                    <span class={RECAP_CHIP}
                        >{STRATEGIES.find((x) => x.id === approach)?.label ?? approach}</span
                    >
                {/each}
            </dd>

            <dt class="text-stone-500 dark:text-stone-400">Requires</dt>
            <dd class="flex flex-wrap items-center gap-1.5">
                {#each watched.checks.required as kind (kind)}
                    <span class={RECAP_CHIP}>{checkLabel(kind)}</span>
                {:else}
                    <span class="text-stone-500 italic dark:text-stone-400"
                        >nothing — every name is reported</span
                    >
                {/each}
            </dd>

            {#if run.email}
                <dt class="text-stone-500 dark:text-stone-400">Results to</dt>
                <dd class="text-stone-600 dark:text-stone-400">{run.email}</dd>
            {/if}
        </dl>

        <!--
            How it is going, and what to do next — inside the same card.

            These were a second panel below this one, which put 640px of
            chrome between the header and the first control. They describe the
            same run; a rule is enough to separate them.
        -->
        <div
            class="mt-4 flex flex-wrap items-center gap-x-6 gap-y-3 border-t border-stone-200 pt-3.5
                   dark:border-stone-800"
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
                               {stat.label === 'unverified'
                            ? 'text-amber-700 dark:text-amber-400'
                            : ''}">{stat.value ?? '—'}</span
                    >
                    {#if stat.of}<span
                            class="text-sm text-stone-500 tabular-nums dark:text-stone-400"
                            >/ {stat.of}</span
                        >{/if}
                    <span
                        class="text-sm {stat.label === 'unverified'
                            ? 'text-amber-700/80 dark:text-amber-400/80'
                            : 'text-stone-500 dark:text-stone-400'}">{stat.label}</span
                    >
                </div>
            {/each}

            <!--
                Everything you can do to this run, in one place.

                Stop used to sit against the status pill at the far left while
                the three ways of running it again sat at the far right, which
                made the row's own two halves disagree about where a control
                lives. They are one group now, and the first button is whichever
                one the run's state admits: Stop while it is working, Continue
                once it has been stopped, nothing when it is done.

                'Again' means two different things and the difference is the
                whole decision: a brief that produced nothing usable wants a
                clean sheet, one that produced four good names wants a fifth —
                and restarting would throw those four away along with every
                check paid for.

                Changing something first is the third, and it is a link rather
                than a button: it goes to the compose form with these settings
                in it, which is the screen for editing settings.
            -->
            <div class="ml-auto flex flex-wrap items-center gap-2">
                {#if stoppable}
                    <Button
                        onclick={() => stopDialog?.showModal()}
                        color="alternative"
                        size="sm"
                        title="Keep everything found so far and stop looking.">Stop</Button
                    >
                {:else if run.status === 'stopped'}
                    <!--
                        Not 'find more': this run has a target it never reached,
                        so carrying on asks for nothing new — which is `more: 0`
                        and the reason that endpoint takes a number at all.
                    -->
                    <Button
                        onclick={() => rerun('continue', 0)}
                        disabled={rerunning !== ''}
                        color="alternative"
                        size="sm"
                        title="Pick this up where it stopped, keeping every name and verdict."
                        >{rerunning === 'continue' ? 'Asking…' : 'Continue'}</Button
                    >
                {/if}

                {#if finished}
                    <!--
                        The number belongs to the button, so they are one
                        control: 'find more' with nothing saying how many was a
                        button that silently doubled the target.
                    -->
                    <div class="flex items-center">
                        <input
                            type="number"
                            min="1"
                            max="2000"
                            step="1"
                            bind:value={more}
                            aria-label="How many more names to look for"
                            class="w-16 rounded-l-lg border border-r-0 border-stone-500 bg-transparent
                                   px-2 py-1 text-sm tabular-nums
                                   focus:border-stone-900 focus:outline-none
                                   dark:focus:border-stone-100 {moreUsable ? '' : FIELD_ERROR}"
                        />
                        <Button
                            onclick={() => rerun('continue', more)}
                            disabled={rerunning !== '' || !moreUsable}
                            color="alternative"
                            size="sm"
                            class="rounded-l-none"
                            title="Keep every name and verdict here, and look for this many more."
                            >{rerunning === 'continue' ? 'Asking…' : 'Find more'}</Button
                        >
                    </div>
                    <Button
                        onclick={() => rerun('fresh')}
                        disabled={rerunning !== ''}
                        color="alternative"
                        size="sm"
                        title="A new run beside this one: same settings, no names carried over."
                        >{rerunning === 'fresh' ? 'Starting…' : 'Restart'}</Button
                    >
                    <!-- Still an <a>: it navigates, so it must behave like a link. -->
                    <Button
                        href="{resolve('/')}?from={run.id}"
                        color="alternative"
                        size="sm"
                        title="The compose form, with these settings already in it."
                        >Edit and run</Button
                    >
                {/if}
            </div>
        </div>
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
                <Button onclick={() => stopDialog?.close()} color="alternative">Keep going</Button>
                <Button onclick={stopRun} disabled={stopping} color="red">
                    {stopping ? 'Stopping…' : 'Stop run'}
                </Button>
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

    <!--
        The console, above the table and shut.

        The worker runs on another machine, so its console is piped here — and
        it is watched during a run and ignored for the rest of a run's life.
        Open by default it was a permanent 23rem column; closed it is a line,
        and that line carries the latest thing the worker said, so a run still
        shows a pulse without the panel being open.
    -->
    <section class="mt-4">
        <button
            onclick={() => (consoleOpen = !consoleOpen)}
            aria-expanded={consoleOpen}
            aria-controls="console"
            class="flex w-full items-center gap-3 rounded-lg border border-stone-200 px-3 py-2
                   text-left transition-colors duration-100 hover:bg-stone-100
                   dark:border-stone-800 dark:hover:bg-stone-900"
        >
            <span
                aria-hidden="true"
                class="text-stone-500 transition-transform duration-150 dark:text-stone-400
                       {consoleOpen ? 'rotate-90' : ''}">▸</span
            >
            <h2 class="text-sm font-medium">Console</h2>
            <!--
                The last line, where the panel used to be.

                Shut, this row is the only sign the worker is alive, and 'Show
                (214)' is a number rather than a sign of life. Hidden once the
                panel is open, because it would then be saying the same thing
                twice.
            -->
            {#if !consoleOpen && latest}
                <span
                    class="min-w-0 flex-1 truncate font-mono text-xs text-stone-500
                           dark:text-stone-400">{latest.message}</span
                >
            {/if}
            <span class="ml-auto shrink-0 text-xs text-stone-500 dark:text-stone-400"
                >{consoleOpen ? 'Hide' : `${events.length} lines`}</span
            >
        </button>
        {#if consoleOpen}
            <div
                id="console"
                bind:this={logEl}
                class="mt-2 h-64 overflow-y-auto rounded-xl border border-stone-200 bg-stone-50 p-3
                       font-mono text-xs leading-relaxed dark:border-stone-800 dark:bg-stone-950"
            >
                {#each events as e (e.id)}
                    <div class="flex gap-2 py-px">
                        <span class="shrink-0 text-stone-500 dark:text-stone-400 tabular-nums"
                            >{time(e.at)}</span
                        >
                        <span class="{LEVEL[e.level] ?? LEVEL.info} break-words">{e.message}</span>
                    </div>
                {:else}
                    <p class="text-stone-500 dark:text-stone-400">
                        {#if run.status === 'queued'}
                            Waiting for a worker to pick this run up.
                        {:else if finished}
                            This run recorded no console output.
                        {:else}
                            No console output. The run is working — see the counters above — but the
                            worker process handling it started before console recording existed, so
                            it has no way to report its progress here.
                        {/if}
                    </p>
                {/each}
            </div>
        {/if}
    </section>

    <!--
        The table gets the whole width.

        It was two thirds of a two-column grid with the console holding the
        rest, which cost the results 23rem for a panel that is watched during a
        run and ignored afterwards. A dozen domains is a dozen columns, and
        every one of them was being squeezed to pay that rent.
    -->
    <section class="mt-4 min-w-0">
        <div class="mb-2 flex flex-wrap items-center justify-between gap-2">
            <Checkbox bind:checked={onlyPassed} class="text-sm">Only names that passed</Checkbox>
            <Button onclick={copyCsv} color="alternative" size="sm">
                {copied ? 'Copied' : `Copy ${shown.length} ${shown.length === 1 ? 'row' : 'rows'}`}
            </Button>
        </div>

        {#if byStrategy.length > 0}
            <!--
                    Passing out of generated, and nothing else.

                    Every entry carried a third number — 'Combination 0/2 of 6'
                    — the checked count, in amber, on six approaches at once.
                    Three unlabelled numbers per approach across three wrapped
                    lines is not a tally anybody reads, and the run's own
                    'checked' figure is in the card above, once, where it means
                    the same thing.
                -->
            <div
                class="mb-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-stone-500 dark:text-stone-400"
            >
                <span class="text-stone-600 dark:text-stone-300"
                    >{totalNames} names, passing by approach</span
                >
                {#each byStrategy as s (s.id)}
                    <!--
                            Short form, matching the cells directly below. The
                            long names live in the compose form, where their
                            examples explain them; two names for one thing
                            within 100px made the tally unreadable against the
                            column it describes.
                        -->
                    <span title="{s.label} — {s.passed} passing of {s.total} generated">
                        {strategyLabel(s.id)}
                        <b class="font-medium text-stone-700 dark:text-stone-300">{s.passed}</b
                        >/{s.total}
                    </span>
                {/each}
                {#if unattributed > 0}
                    <span>{unattributed} without a recorded approach</span>
                {/if}
            </div>
        {/if}

        <!--
        The table scrolls inside its own panel rather than lengthening the page.
        A thousand rows on a page scroll takes the header away with it, and
        leaves the console stranded beside an endless column.
      -->
        <!--
            A cap, not a height.

            It carried `lg:h-[calc(100vh-19rem)]` so it would match the console
            standing beside it — and the console does not stand beside it any
            more, so all that height bought was an empty box under a short run.
            It grows with its rows now, and scrolls once there are more than
            fit.
        -->
        <Table
            striped
            hoverable
            classes={{
                div: 'max-h-[40rem] overflow-auto rounded-xl border border-stone-200 dark:border-stone-800'
            }}
            class="w-max min-w-full table-fixed text-sm text-stone-900 dark:text-stone-100"
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

            <!--
            Only the action column flexes, so every other width is fixed.
            They previously summed to more than the panel and left the name
            fourteen pixels wide. One column per check, generated: which
            checks there are is the run's own business.
          -->
            <colgroup>
                <!--
                        Widest of the fixed columns, because it is the one
                        being read.

                        Left width-less it took its size from the longest name
                        in the table, which put the total eight pixels past the
                        panel and hung a scrollbar under a table that otherwise
                        fitted. Fixed, the sum is knowable: the slack is shared
                        out by min-w-full and nothing overflows until the
                        checks genuinely need more room than there is.
                    -->
                <col style="width: 12rem" />
                <col style="width: 7rem" />
                {#each columns as k (k)}
                    <col style="width: 5.75rem" />
                {/each}
                {#if linkColumn}
                    <col style="width: 5.75rem" />
                {/if}
                <!--
                        Wide enough for what is in it.

                        6.5rem was a guess the browser overrode: w-max sizes to
                        content, so the Check button and its menu took 124px
                        whatever this said, and the nine pixels of difference
                        hung a scrollbar under a table that otherwise fitted.
                    -->
                <col style="width: 7.75rem" />
            </colgroup>
            <!--
                        The heading is the label and its filter together. A
                        filtered column shows it: the control takes the accent
                        border and a clear button appears, so the reason a
                        table looks short is visible from the table.
                    -->
            <!--
                    The header sits on the table's own ground.

                    It was bg-stone-100 against white rows — a grey band across
                    the top that read as a separate widget bolted above the
                    results. The hairline under it is what separates a header
                    from its rows; the fill was doing the job twice, and louder.
                -->
            <!--
                z-20, above the pinned name column's z-10.

                Both were z-10, and equal z-index is settled by document order —
                so the body's sticky cells, which come later, painted over the
                header. Scrolling slid every name straight through 'NAME'. The
                corner cell is z-30 because it is both.
            -->
            <TableHead class="sticky top-0 z-20 bg-white text-left normal-case dark:bg-stone-950">
                <TableHeadCell
                    scope="col"
                    class="sticky left-0 z-30 bg-white px-4 py-3 align-bottom
                                after:absolute after:inset-y-0 after:-right-px after:w-px
                                after:bg-stone-200 dark:bg-stone-950 dark:after:bg-stone-800
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
                        class="group flex items-center gap-1 pb-1.5 text-[0.6875rem]
                                       font-semibold tracking-wide uppercase text-stone-600
                                       transition-colors duration-100 hover:text-stone-900
                                       dark:text-stone-400 dark:hover:text-stone-100"
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
                        <Input
                            bind:value={nameFilter}
                            type="text"
                            size="sm"
                            placeholder="contains…"
                            aria-label="Filter names"
                            class="{FILTER_INPUT} {nameFilter ? FILTER_ACTIVE : FILTER_IDLE} pr-6"
                        />
                        {#if nameFilter}
                            <button
                                onclick={() => (nameFilter = '')}
                                aria-label="Clear the name filter"
                                class={CLEAR_BUTTON}>×</button
                            >
                        {/if}
                    </div>
                </TableHeadCell>

                <TableHeadCell
                    scope="col"
                    class="px-4 py-3 align-bottom whitespace-nowrap {HEADER_EDGE}"
                >
                    <span
                        class="block pb-1.5 text-[0.6875rem] font-semibold tracking-wide uppercase text-stone-600 dark:text-stone-400"
                    >
                        Approach
                    </span>
                    <div class="relative">
                        <!--
                            classes.select, not class.

                            Select puts `class` on its wrapper div and keeps a
                            slot for the element — so the filter styling was
                            landing on a box around the control while the
                            control kept the library's own defaults. A bordered
                            select inside a bordered div, 48px tall beside a
                            26px input, which is what made this row look like
                            two different controls.

                            placeholder="" on purpose: Flowbite prepends a
                            disabled placeholder option when it has one, and
                            'Any' here is a real choice — it is how a filter is
                            cleared, so it has to stay selectable.
                        -->
                        <Select
                            bind:value={approachFilter}
                            placeholder=""
                            aria-label="Filter by approach"
                            class="w-full"
                            classes={{
                                select: `${FILTER_INPUT} ${approachFilter ? FILTER_ACTIVE : FILTER_IDLE} pr-6`
                            }}
                        >
                            <option value="">Any</option>
                            {#each byStrategy as s (s.id)}
                                <option value={s.id}>{strategyLabel(s.id)}</option>
                            {/each}
                        </Select>
                        {#if approachFilter}
                            <button
                                onclick={() => (approachFilter = '')}
                                aria-label="Clear the approach filter"
                                class={CLEAR_BUTTON}>×</button
                            >
                        {/if}
                    </div>
                </TableHeadCell>

                <!--
                    Which model wrote the name, filterable like the approach.

                    Worth a column of its own rather than a line in the console:
                    a run rotates between whatever generators are configured, and
                    when one of them stops answering the shortlist just gets
                    narrower with nothing saying so. Filtering to a source is how
                    you see that a source contributed nothing.
                -->
                <TableHeadCell
                    scope="col"
                    class="px-4 py-3 align-bottom whitespace-nowrap {HEADER_EDGE}"
                >
                    <span
                        class="block pb-1.5 text-[0.6875rem] font-semibold tracking-wide uppercase text-stone-600 dark:text-stone-400"
                    >
                        Source
                    </span>
                    <div class="relative">
                        <Select
                            bind:value={sourceFilter}
                            placeholder=""
                            aria-label="Filter by source"
                            class="w-full"
                            classes={{
                                select: `${FILTER_INPUT} ${sourceFilter ? FILTER_ACTIVE : FILTER_IDLE} pr-6`
                            }}
                        >
                            <option value="">Any</option>
                            {#each bySource as label (label)}
                                <option value={label}>{label || 'unrecorded'}</option>
                            {/each}
                        </Select>
                        {#if sourceFilter}
                            <button
                                onclick={() => (sourceFilter = '')}
                                aria-label="Clear the source filter"
                                class={CLEAR_BUTTON}>×</button
                            >
                        {/if}
                    </div>
                </TableHeadCell>

                <!--
                            Centred, header and cell alike.

                            Every one of these holds a single glyph in a
                            five-and-a-half-rem column, and left-aligned that
                            put a tick hard against the left edge with forty
                            pixels of nothing after it — five columns of ragged
                            marks that read as a mistake rather than a matrix.
                        -->
                {#each columns as k (k)}
                    <TableHeadCell
                        scope="col"
                        class="px-3 py-3 text-center align-bottom whitespace-nowrap
                                       {HEADER_EDGE}"
                    >
                        <span
                            class="block pb-1.5 text-[0.6875rem] font-semibold tracking-wide uppercase text-stone-600 dark:text-stone-400"
                        >
                            {checkLabel(k)}
                        </span>
                        <div class="relative">
                            <!--
                                        pr-6 only when there is a × to make
                                        room for. Reserved unconditionally in a
                                        five-and-a-half-rem column it left
                                        about thirty pixels for the word, so
                                        every idle filter read 'Ar'.
                                    -->
                            <Select
                                bind:value={checkFilter[k]}
                                placeholder=""
                                aria-label="Filter by {checkLabel(k)}"
                                class="w-full"
                                classes={{
                                    select: `${FILTER_INPUT} ${
                                        checkFilter[k] ? `${FILTER_ACTIVE} pr-6` : FILTER_IDLE
                                    }`
                                }}
                            >
                                <option value="">Any</option>
                                {#each LEGEND as l (l.status)}
                                    <option value={l.status}>{CELL[l.status].text}</option>
                                {/each}
                            </Select>
                            {#if checkFilter[k]}
                                <button
                                    onclick={() => (checkFilter[k] = '')}
                                    aria-label="Clear the {checkLabel(k)} filter"
                                    class={CLEAR_BUTTON}>×</button
                                >
                            {/if}
                        </div>
                    </TableHeadCell>
                {/each}

                {#if linkColumn}
                    <!--
                                    No filter on this one. There is nothing to
                                    filter by: every cell is the same link, and
                                    a dropdown offering 'free' and 'taken' over
                                    a column that establishes neither would be
                                    the exact confusion this column avoids.
                                -->
                    <TableHeadCell
                        scope="col"
                        class="px-3 py-3 text-center align-bottom whitespace-nowrap
                                       {HEADER_EDGE}"
                    >
                        <span
                            class="block pb-1.5 text-[0.6875rem] font-semibold tracking-wide uppercase text-stone-600 dark:text-stone-400"
                        >
                            {checkLabel(linkColumn)}
                        </span>
                        <!--
                            As tall as a filter, because it stands where one
                            stands.

                            Every other header is label-over-control and bottom
                            aligned, so this one — label over a bare line of
                            text — sat its label ten pixels below all the rest,
                            and the header row read as ragged. Matching the
                            control's height puts the labels back on one line.
                        -->
                        <span
                            class="flex h-[26px] items-center justify-center text-xs text-stone-500
                                   dark:text-stone-400">look yourself</span
                        >
                    </TableHeadCell>
                {/if}

                <TableHeadCell
                    scope="col"
                    class="px-4 py-3 text-right align-bottom whitespace-nowrap {HEADER_EDGE}"
                >
                    <span
                        class="block pb-1.5 text-[0.6875rem] font-semibold tracking-wide uppercase text-stone-600 dark:text-stone-400"
                    >
                        Action
                    </span>
                    <button
                        onclick={clearFilters}
                        disabled={!anyFilter}
                        class="w-full rounded border border-stone-500 px-2 py-1 text-xs
                                           transition-colors duration-100 enabled:hover:bg-stone-200
                                           disabled:opacity-0 dark:border-stone-700
                                           dark:enabled:hover:bg-stone-800"
                    >
                        Clear all
                        <kbd class="ml-0.5 opacity-60">esc</kbd>
                    </button>
                </TableHeadCell>
            </TableHead>
            <TableBody>
                {#each shown as c (c.id)}
                    <TableBodyRow
                        class="odd:bg-white even:bg-stone-50 dark:odd:bg-stone-950
                                   dark:even:bg-stone-900/60 transition-colors duration-100
                                   hover:bg-stone-100 dark:hover:bg-stone-800/70"
                    >
                        <!--
                    Pinned, because the results are read on a phone.
                    The table is 819px of content in a 340px panel, so
                    scrolling to the verdicts used to take the names with it
                    and leave anonymous rows of ticks. bg-inherit keeps the
                    row's hover tint on the pinned cell.
                  -->
                        <TableBodyCell
                            class="sticky left-0 z-10 bg-inherit px-3 py-2 font-medium
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
                        </TableBodyCell>
                        <TableBodyCell
                            class="px-3 py-2 whitespace-nowrap text-stone-500 dark:text-stone-400"
                        >
                            {strategyLabel(c.strategy)}
                        </TableBodyCell>
                        <TableBodyCell
                            class="px-3 py-2 whitespace-nowrap text-stone-500 dark:text-stone-400"
                        >
                            {c.source ?? '—'}
                        </TableBodyCell>
                        {#each columns as k (k)}
                            <TableBodyCell
                                class="relative px-3 py-2 text-center whitespace-nowrap {CELL[
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
                                        >{c.name} — {checkLabel(k)}: {CELL[statusOf(c.statuses, k)]
                                            .text}</span
                                    >
                                {/if}
                            </TableBodyCell>
                        {/each}
                        {#if linkColumn}
                            <!--
                                        A link, not a verdict. No glyph, because
                                        every glyph in this table is a finding
                                        and this cell has none — it is the
                                        search somebody would have run.
                                    -->
                            <TableBodyCell class="px-3 py-2 text-center whitespace-nowrap">
                                <a
                                    href={checkSearch(linkColumn, c.name)}
                                    target="_blank"
                                    rel="external noopener noreferrer"
                                    aria-label="Search the web for {c.name}"
                                    class="text-stone-500 dark:text-stone-400 underline decoration-dotted underline-offset-2 hover:text-stone-900 hover:decoration-solid dark:hover:text-stone-100"
                                    >search ↗</a
                                >
                            </TableBodyCell>
                        {/if}
                        <!--
                  One button for the ordinary case - run whatever this run
                  requires - and a menu for the one check you actually doubt.
                -->
                        <TableBodyCell class="px-3 py-2 text-right whitespace-nowrap">
                            <!--
                                A ButtonGroup, which is what this always was:
                                two buttons sharing one border with a divider
                                between them, previously assembled by hand out
                                of overflow-hidden and a border-l.
                            -->
                            <ButtonGroup size="sm">
                                <!--
                                            Both labels occupy one grid cell, so
                                            the button is as wide as the longer
                                            of them and does not resize when the
                                            state changes. A row that shifts
                                            width mid-click makes the whole
                                            column look unstable.
                                        -->
                                <Button
                                    onclick={() => recheck(c)}
                                    disabled={rechecking[c.id]}
                                    size="xs"
                                    color="alternative"
                                    title="Re-run the checks this run requires"
                                    class="grid px-2 py-0.5"
                                >
                                    <span
                                        class="col-start-1 row-start-1"
                                        class:invisible={rechecking[c.id]}>Check</span
                                    >
                                    <span
                                        class="col-start-1 row-start-1"
                                        class:invisible={!rechecking[c.id]}>Checking…</span
                                    >
                                </Button>
                                <Button
                                    onclick={(e: MouseEvent) => {
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
                                    size="xs"
                                    color="alternative"
                                    class="px-1.5 py-0.5">▾</Button
                                >
                            </ButtonGroup>
                        </TableBodyCell>
                    </TableBodyRow>
                {:else}
                    <TableBodyRow
                        ><!--
                                Counted, not guessed.

                                It was colspan="8", which stopped being the
                                number of columns the moment which checks a run
                                makes became the run's own business — and the
                                selection column going has moved it again. Name,
                                approach and source, a column per check, the link
                                column when there is one, and the actions.
                            --><TableBodyCell
                            colspan={3 + columns.length + (linkColumn ? 1 : 0) + 1}
                            class="px-4 py-12 text-center text-sm font-normal whitespace-normal text-stone-500 dark:text-stone-400"
                        >
                            {#if run.status === 'stopped'}
                                Stopped before any name was generated.
                            {:else if run.status === 'queued'}
                                Queued. Waiting for the worker to pick this up.
                            {:else if run.status === 'generating'}
                                Generating {run.targetCount} names. They appear here in batches as they
                                are written - the first arrives in a few minutes.
                            {:else if anyFilter}
                                No name matches these filters.
                            {:else if onlyPassed}
                                Nothing has cleared every requirement yet. Untick “only names that
                                passed” to watch the checks land.
                            {:else}
                                Nothing yet.
                            {/if}
                        </TableBodyCell></TableBodyRow
                    >
                {/each}
            </TableBody>
        </Table>
        <!--
                Under the table, not above it.

                It is a reference — consulted the first time a mark is
                unfamiliar — and it was four lines of the densest text on the
                page standing between the filters and the first result. dt/dd
                pairs each mark with its meaning for a screen reader, and the
                wider column gap separates the pairs by more than the term
                separates from its own definition.
            -->
        <dl
            class="mt-2 flex flex-wrap items-center gap-x-6 gap-y-1 text-xs text-stone-500 dark:text-stone-400"
        >
            {#each LEGEND as l (l.status)}
                <div class="flex items-center gap-1.5 whitespace-nowrap">
                    <dt class="font-medium {CELL[l.status].class}">
                        {CELL[l.status].icon}
                        {CELL[l.status].text}
                    </dt>
                    <dd>{l.note}</dd>
                </div>
            {/each}
        </dl>
    </section>

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
            class="fixed z-50 min-w-72 -translate-x-full rounded-lg border border-stone-200
                bg-white py-1 shadow-lg shadow-stone-900/10 dark:border-stone-700
                dark:bg-stone-900 dark:shadow-black/40"
        >
            <!--
                One row per check, not two lists of the same checks.

                It was every check to re-run, then a rule, then every check to
                search — so a run with eight of them opened a sixteen-row menu
                that had said each name twice. The search is an arrow on the
                row it belongs to, which halves the height and puts the two
                things you might do about `.com` next to each other.

                A link cannot live inside a button, so the row is a flex pair
                rather than one control.
            -->
            <p class="px-3 py-1 text-xs text-stone-500 dark:text-stone-400">
                Check one thing, or look for yourself
            </p>
            {#each columns as k (k)}
                <div class="flex items-stretch">
                    <button
                        onclick={() => row && recheck(row, k)}
                        class="flex flex-1 items-center justify-between gap-4 px-3 py-1.5 text-left
                               text-sm transition-colors duration-100 hover:bg-stone-100
                               dark:hover:bg-stone-800"
                    >
                        <span class="whitespace-nowrap">{checkLabel(k)}</span>
                        {#if row}
                            <span
                                class="whitespace-nowrap text-xs {CELL[statusOf(row.statuses, k)]
                                    .class}"
                            >
                                <span aria-hidden="true"
                                    >{CELL[statusOf(row.statuses, k)].icon}</span
                                >
                                {CELL[statusOf(row.statuses, k)].text}
                            </span>
                        {/if}
                    </button>
                    {#if row}
                        <a
                            href={checkSearch(k, row.name)}
                            target="_blank"
                            rel="external noopener noreferrer"
                            onclick={() => (menu = null)}
                            aria-label="Search {checkLabel(k)} for {row.name} yourself"
                            title="Look for yourself"
                            class="flex items-center px-3 text-sm text-stone-500 transition-colors
                                   duration-100 hover:bg-stone-100 hover:text-stone-900
                                   dark:text-stone-400 dark:hover:bg-stone-800
                                   dark:hover:text-stone-100">↗</a
                        >
                    {/if}
                </div>
            {/each}
        </div>
    {/if}
{/if}
