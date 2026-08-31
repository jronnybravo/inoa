<script lang="ts">
  import { goto } from '$app/navigation';
  import { CHECK_LABEL, CHECK_ORDER, CHECK_SEARCH, STRATEGIES, type CheckStatus } from '$lib/types';

  let { data } = $props();

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
  let requireCom = $state(data.run?.requireCom ?? true);
  let requireAppStore = $state(data.run?.requireAppStore ?? true);
  let requirePlayStore = $state(data.run?.requirePlayStore ?? true);
  let requireGoogle = $state(data.run?.requireGoogle ?? false);
  let email = $state(data.run?.email ?? '');
  let targetCount = $state(data.run?.targetCount ?? 1000);

  let submitting = $state(false);
  let problem = $state('');
  let pendingRunId = $state('');
  let emailProblem = $state('');
  let code = $state('');

  let run = $state<any>(data.run ?? null);
  let candidates = $state<any[]>([]);
  let events = $state<{ id: string; at: string; level: string; message: string }[]>([]);
  const seenEvents = new Set<string>();
  let onlyPassed = $state(data.run?.status === 'done');
  /** Empty means every approach; otherwise only these. */
  let strategyFilter = $state<string[]>([]);
  let selected = $state<Record<string, boolean>>({});
  let consoleOpen = $state(true);
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
  let menu = $state<{ id: string; x: number; y: number } | null>(null);

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
    if (!text) return;
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
  function mergeCandidates(current: any[], incoming: any[]): any[] {
    const previous = new Map(current.map((c) => [c.id, c]));
    let changed = incoming.length !== current.length;

    const next = incoming.map((row, i) => {
      const before = previous.get(row.id);
      if (
        before &&
        before.com === row.com &&
        before.appStore === row.appStore &&
        before.playStore === row.playStore &&
        before.google === row.google &&
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
        const updated = await response.json();
        // Patch the row in place rather than waiting for the next poll.
        candidates = candidates.map((c) => (c.id === updated.id ? { ...c, ...updated } : c));
      }
    } catch {
      // The next poll will show the truth either way.
    } finally {
      rechecking = { ...rechecking, [candidate.id]: false };
    }
  }

  const requirements = [
    { key: 'com', label: '.com', get: () => requireCom, set: (v: boolean) => (requireCom = v) },
    { key: 'appStore', label: 'App Store', get: () => requireAppStore, set: (v: boolean) => (requireAppStore = v) },
    { key: 'playStore', label: 'Play Store', get: () => requirePlayStore, set: (v: boolean) => (requirePlayStore = v) },
    { key: 'google', label: 'Google', get: () => requireGoogle, set: (v: boolean) => (requireGoogle = v) }
  ];

  const CELL: Record<CheckStatus, { text: string; class: string }> = {
    clear: { text: 'free', class: 'text-emerald-700 dark:text-emerald-400' },
    taken: { text: 'taken', class: 'text-rose-700/90 dark:text-rose-400/90' },
    unknown: { text: 'unverified', class: 'text-amber-700 dark:text-amber-400' },
    // Words, not symbols. A dash reads as an empty cell, and 'skipped' is a
    // real verdict about the funnel - the name was disqualified before this
    // check was worth spending a request on.
    skipped: { text: 'skipped', class: 'text-stone-400 dark:text-stone-600' },
    pending: { text: 'waiting', class: 'text-stone-300 dark:text-stone-700' }
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
  const STRATEGY_LABEL: Record<string, string> = {
    compound: 'Combination',
    invented: 'Invented',
    metaphor: 'Metaphor',
    portmanteau: 'Blend',
    foreign: 'Language',
    short: 'Abstract'
  };

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
  const shown = $derived(
    strategyFilter.length === 0
      ? candidates
      : candidates.filter((c) => strategyFilter.includes(c.strategy))
  );

  /** Whole-run tallies from the server, so filtering does not distort them. */
  let tallies = $state<{ strategy: string | null; total: number; passed: number }[]>([]);

  const byStrategy = $derived(
    STRATEGIES.map((s) => ({
      ...s,
      total: tallies.find((t) => t.strategy === s.id)?.total ?? 0,
      passed: tallies.find((t) => t.strategy === s.id)?.passed ?? 0
    })).filter((s) => s.total > 0)
  );

  const totalNames = $derived(tallies.reduce((sum, t) => sum + t.total, 0));
  const unattributed = $derived(tallies.find((t) => !t.strategy)?.total ?? 0);

  const passedCount = $derived(candidates.filter((c) => c.passed === true).length);
  const finished = $derived(run?.status === 'done' || run?.status === 'failed');

  async function execute() {
    problem = '';
    submitting = true;
    try {
      const response = await fetch('/api/runs', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          brief, strategies, requireCom, requireAppStore, requirePlayStore, requireGoogle,
          email, targetCount
        })
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.message ?? 'Could not start');
      pendingRunId = payload.id;
      emailProblem = payload.emailSent ? '' : (payload.emailProblem ?? 'The code could not be sent.');
    } catch (e) {
      problem = (e as Error).message;
    } finally {
      submitting = false;
    }
  }

  async function verify() {
    problem = '';
    submitting = true;
    try {
      const response = await fetch('/api/verify', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ runId: pendingRunId, code })
      });
      if (!response.ok) throw new Error((await response.json()).message ?? 'Could not verify');
      // Client-side navigation. Assigning to window.location threw the whole
      // document away and rebuilt it, which reads as the app restarting at the
      // exact moment the run begins.
      await goto(`?requestid=${pendingRunId}`, { keepFocus: true, noScroll: true });
    } catch (e) {
      problem = (e as Error).message;
    } finally {
      submitting = false;
    }
  }

  /**
   * Polling, not SSE. A streaming response holds a Vercel function open and
   * hits the duration cap this whole architecture exists to avoid.
   */
  $effect(() => {
    if (!data.run) return;
    // The component survives a client-side navigation, so state initialised
    // from the first `data` would otherwise stay on the previous run.
    run = data.run;
    let alive = true;
    (async () => {
      let since = '';
      while (alive) {
        try {
          const query = `passed=${onlyPassed ? 1 : 0}${since ? `&since=${encodeURIComponent(since)}` : ''}`;
          const r = await fetch(`/api/runs/${data.run.id}?${query}`);
          if (r.ok) {
            const payload = await r.json();
            run = payload.run;
            candidates = mergeCandidates(candidates, payload.candidates);
            if (payload.tallies) tallies = payload.tallies;
            if (payload.events?.length) {
              const fresh = payload.events.filter((e: { id: string }) => !seenEvents.has(e.id));
              for (const e of fresh) seenEvents.add(e.id);
              if (fresh.length) events = [...events, ...fresh].slice(-800);
              since = payload.events[payload.events.length - 1].at;
            }
            if (run.status === 'done' || run.status === 'failed') return;
          }
        } catch {
          // Transient; the next tick retries.
        }
        await new Promise((r) => setTimeout(r, 2500));
      }
    })();
    return () => { alive = false; };
  });

  // Follow the tail, the way a terminal does.
  $effect(() => {
    events.length;
    if (logEl) logEl.scrollTop = logEl.scrollHeight;
  });

  function visibleRows() {
    return shown.filter((c) => selected[c.id] ?? true);
  }

  async function copyCsv() {
    const header = ['Name', 'Approach', ...CHECK_ORDER.map((k) => CHECK_LABEL[k])].join(',');
    const rows = visibleRows().map((c) =>
      [c.name, STRATEGY_LABEL[c.strategy] ?? c.strategy ?? '',
       ...CHECK_ORDER.map((k) => CELL[c[k] as CheckStatus].text)]
        .map((v) => `"${v}"`).join(',')
    );
    await navigator.clipboard.writeText([header, ...rows].join('\n'));
    copied = true;
    setTimeout(() => (copied = false), 1600);
  }

  const time = (at: string) =>
    new Date(at).toLocaleTimeString('en-GB', { hour12: false });
</script>

<header class="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-2">
  <div>
    <h1 class="text-2xl font-semibold tracking-tight">Naming run</h1>
    <p class="mt-0.5 text-sm text-stone-600 dark:text-stone-400">
      Generate candidates from a brief, then screen each against the places a name can be taken.
    </p>
  </div>
  {#if watching}
    <a href="/" class="text-sm text-stone-600 underline underline-offset-4 hover:text-stone-900
                       dark:text-stone-400 dark:hover:text-stone-100">Start another</a>
  {/if}
</header>

{#if !watching}
  <!-- Compose: a single column, because there is one thing to do. -->
  <section class="mt-8 max-w-2xl">
    <div class="space-y-7 rounded-xl border border-stone-200 bg-white p-6
                dark:border-stone-800 dark:bg-stone-900">
      <div>
        <label for="brief" class="block text-sm font-medium">Brief</label>
        <textarea id="brief" bind:value={brief} rows="3"
          placeholder="A marketplace connecting local farms to restaurant kitchens."
          class="mt-2 w-full rounded-lg border border-stone-300 bg-white px-3 py-2 text-sm
                 placeholder:text-stone-400 focus:border-stone-500 focus:outline-none
                 focus:ring-2 focus:ring-stone-900/10 dark:border-stone-700 dark:bg-stone-950
                 dark:placeholder:text-stone-600 dark:focus:ring-white/10"></textarea>
      </div>

      <div>
        <span class="block text-sm font-medium">Naming strategy</span>
        <div class="mt-2 grid gap-2 sm:grid-cols-2">
          {#each STRATEGIES as s}
            <label class="flex cursor-pointer items-start gap-2.5 rounded-lg border p-3 text-sm
                          transition-colors duration-150
                          {strategies.includes(s.id)
                            ? 'border-stone-900 bg-stone-50 dark:border-stone-100 dark:bg-stone-800/50'
                            : 'border-stone-200 hover:border-stone-400 dark:border-stone-800 dark:hover:border-stone-600'}">
              <input type="checkbox" class="mt-0.5 accent-stone-900 dark:accent-stone-100"
                checked={strategies.includes(s.id)}
                onchange={(e) => {
                  const on = (e.currentTarget as HTMLInputElement).checked;
                  strategies = on ? [...strategies, s.id] : strategies.filter((x) => x !== s.id);
                }} />
              <span>
                <span class="font-medium">{s.label}</span>
                <span class="block text-xs text-stone-500 dark:text-stone-500">{s.hint}</span>
              </span>
            </label>
          {/each}
        </div>
      </div>

      <div>
        <span class="block text-sm font-medium">Must be available on</span>
        <p class="mt-1 text-xs text-stone-500">
          A required check drops a name the moment it fails. The others still run and are reported.
        </p>
        <div class="mt-2 flex flex-wrap gap-2">
          {#each requirements as r}
            <label class="flex cursor-pointer items-center gap-2 rounded-lg border px-3 py-2 text-sm
                          transition-colors duration-150
                          {r.get()
                            ? 'border-stone-900 bg-stone-50 dark:border-stone-100 dark:bg-stone-800/50'
                            : 'border-stone-200 hover:border-stone-400 dark:border-stone-800 dark:hover:border-stone-600'}">
              <input type="checkbox" class="accent-stone-900 dark:accent-stone-100"
                checked={r.get()}
                onchange={(e) => r.set((e.currentTarget as HTMLInputElement).checked)} />
              {r.label}
            </label>
          {/each}
        </div>
      </div>

      <div>
        <label for="count" class="block text-sm font-medium">How many names to generate</label>
        <input id="count" bind:value={targetCount} type="number" min="50" max="2000" step="50"
          class="mt-2 w-32 rounded-lg border border-stone-300 px-3 py-2 text-sm
                 focus:border-stone-500 focus:outline-none focus:ring-2 focus:ring-stone-900/10
                 dark:border-stone-700 dark:bg-stone-950 dark:focus:ring-white/10" />
        <p class="mt-1 text-xs text-stone-500">
          More names means a longer run and a broader shortlist.
        </p>
      </div>

      <div>
        <label for="email" class="block text-sm font-medium">Email</label>
        <input id="email" bind:value={email} type="email" placeholder="you@example.com"
          class="mt-2 w-full max-w-sm rounded-lg border border-stone-300 px-3 py-2 text-sm
                 placeholder:text-stone-400 focus:border-stone-500 focus:outline-none
                 focus:ring-2 focus:ring-stone-900/10 dark:border-stone-700 dark:bg-stone-950
                 dark:placeholder:text-stone-600 dark:focus:ring-white/10" />
        <p class="mt-1 text-xs text-stone-500">
          Verified once. A run takes a while, so the results are emailed when it finishes.
        </p>
      </div>

      {#if problem}
        <p class="rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-800
                  dark:bg-rose-950/50 dark:text-rose-200">{problem}</p>
      {/if}

      {#if pendingRunId}
        <div class="rounded-lg border border-stone-200 p-4 dark:border-stone-800">
          {#if emailProblem}
            <p class="text-sm font-medium text-rose-700 dark:text-rose-400">
              The code could not be sent to {email}.
            </p>
            <p class="mt-1 text-xs text-rose-700/80 dark:text-rose-400/80">{emailProblem}</p>
          {:else}
            <p class="text-sm">We sent a six-digit code to <b>{email}</b>.</p>
          {/if}
          <div class="mt-3 flex gap-2">
            <input bind:value={code} inputmode="numeric" maxlength="6" placeholder="000000"
              class="w-32 rounded-lg border border-stone-300 px-3 py-2 text-sm tracking-[0.3em]
                     focus:border-stone-500 focus:outline-none focus:ring-2 focus:ring-stone-900/10
                     dark:border-stone-700 dark:bg-stone-950 dark:focus:ring-white/10" />
            <button onclick={verify} disabled={submitting || code.length < 6}
              class="rounded-lg bg-stone-900 px-4 py-2 text-sm font-medium text-white
                     transition-opacity duration-150 hover:opacity-90 disabled:opacity-40
                     dark:bg-white dark:text-stone-900">Verify and run</button>
          </div>
        </div>
      {:else}
        <button onclick={execute}
          disabled={submitting || brief.trim().length < 12 || !email || strategies.length === 0}
          class="rounded-lg bg-stone-900 px-5 py-2.5 text-sm font-medium text-white
                 transition-opacity duration-150 hover:opacity-90 disabled:opacity-40
                 dark:bg-white dark:text-stone-900">
          {submitting ? 'Starting…' : 'Execute'}
        </button>
      {/if}
    </div>
  </section>
{:else if run}
  <!-- Watch: the brief collapses to a recap so the results get the room. -->
  <section class="mt-6 rounded-xl border border-stone-200 bg-white px-5 py-4
                  dark:border-stone-800 dark:bg-stone-900">
    <p class="text-sm leading-relaxed text-stone-800 dark:text-stone-200">{run.brief}</p>
    <div class="mt-3 flex flex-wrap items-center gap-x-2 gap-y-1.5 text-xs text-stone-500">
      {#each run.strategies ?? [] as s}
        <span class="rounded bg-stone-100 px-1.5 py-0.5 dark:bg-stone-800">
          {STRATEGIES.find((x) => x.id === s)?.label ?? s}
        </span>
      {/each}
      <span class="text-stone-300 dark:text-stone-700">·</span>
      <span>requires</span>
      {#each requirements.filter((r) => run[`require${r.key[0].toUpperCase()}${r.key.slice(1)}`]) as r}
        <span class="rounded bg-stone-100 px-1.5 py-0.5 dark:bg-stone-800">{r.label}</span>
      {:else}
        <span class="italic">nothing - every name is reported</span>
      {/each}
      <span class="text-stone-300 dark:text-stone-700">·</span>
      <span>{run.email}</span>
    </div>
  </section>

  <!-- Progress reads left to right in the order the funnel actually runs. -->
  <section class="mt-4 flex flex-wrap items-center gap-x-8 gap-y-3 rounded-xl border
                  border-stone-200 bg-white px-5 py-4 dark:border-stone-800 dark:bg-stone-900">
    <div class="flex items-center gap-2.5">
      <span class="relative flex h-2 w-2">
        {#if !finished}
          <span class="absolute inline-flex h-full w-full animate-ping rounded-full
                       bg-emerald-500 opacity-60"></span>
        {/if}
        <span class="relative inline-flex h-2 w-2 rounded-full
                     {run.status === 'failed' ? 'bg-rose-500'
                       : finished ? 'bg-stone-400' : 'bg-emerald-500'}"></span>
      </span>
      <span class="text-sm font-medium capitalize">{run.status}</span>
    </div>
    {#each [
      { label: 'generated', value: run.generatedCount, of: run.targetCount },
      { label: 'checked', value: run.checkedCount, of: run.generatedCount },
      { label: 'passing', value: passedCount, of: null }
    ] as stat}
      <div class="flex items-baseline gap-1.5">
        <span class="text-lg font-semibold tabular-nums">{stat.value}</span>
        {#if stat.of}<span class="text-sm text-stone-400 tabular-nums">/ {stat.of}</span>{/if}
        <span class="text-sm text-stone-500">{stat.label}</span>
      </div>
    {/each}
  </section>

  {#if run.error}
    <p class="mt-4 rounded-lg bg-rose-50 px-4 py-3 text-sm text-rose-800
              dark:bg-rose-950/50 dark:text-rose-200">{run.error}</p>
  {/if}

  <!-- Table and console side by side: you read results while watching progress. -->
  <div class="mt-4 grid gap-4 lg:grid-cols-[minmax(0,1fr)_19rem]">
    <section class="min-w-0">
      <div class="mb-2 flex flex-wrap items-center justify-between gap-2">
        <label class="flex cursor-pointer items-center gap-2 text-sm">
          <input type="checkbox" bind:checked={onlyPassed} class="accent-stone-900 dark:accent-stone-100" />
          Only names that passed
        </label>
        <button onclick={copyCsv}
          class="rounded-lg border border-stone-300 px-3 py-1.5 text-sm transition-colors
                 duration-150 hover:bg-stone-100 dark:border-stone-700 dark:hover:bg-stone-800">
          {copied ? 'Copied' : 'Copy CSV'}
        </button>
      </div>

      {#if byStrategy.length > 1 || unattributed > 0}
        <div class="mb-2 flex flex-wrap items-center gap-1.5">
          <button onclick={() => (strategyFilter = [])}
            class="rounded-lg border px-2.5 py-1 text-xs transition-colors duration-150
                   {strategyFilter.length === 0
                     ? 'border-stone-900 bg-stone-900 text-white dark:border-stone-100 dark:bg-stone-100 dark:text-stone-900'
                     : 'border-stone-300 hover:bg-stone-100 dark:border-stone-700 dark:hover:bg-stone-800'}">
            All {totalNames}
          </button>
          {#each byStrategy as s}
            <button
              onclick={() => {
                strategyFilter = strategyFilter.includes(s.id)
                  ? strategyFilter.filter((x) => x !== s.id)
                  : [...strategyFilter, s.id];
              }}
              title="{s.passed} of {s.total} cleared every requirement"
              class="rounded-lg border px-2.5 py-1 text-xs transition-colors duration-150
                     {strategyFilter.includes(s.id)
                       ? 'border-stone-900 bg-stone-900 text-white dark:border-stone-100 dark:bg-stone-100 dark:text-stone-900'
                       : 'border-stone-300 hover:bg-stone-100 dark:border-stone-700 dark:hover:bg-stone-800'}">
              {s.label}
              <span class="opacity-60">{s.passed}/{s.total}</span>
            </button>
          {/each}
          {#if unattributed > 0}
            <span class="text-xs text-stone-500">
              {unattributed} from before approaches were recorded
            </span>
          {/if}
        </div>
      {/if}

      <div class="mb-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-stone-500">
        {#each LEGEND as l}
          <span class="whitespace-nowrap">
            <span class="font-medium {CELL[l.status].class}">{CELL[l.status].text}</span>
            <span class="ml-1">{l.note}</span>
          </span>
        {/each}
      </div>

      <!--
        The table scrolls inside its own panel rather than lengthening the page.
        A thousand rows on a page scroll takes the header away with it, and
        leaves the console stranded beside an endless column.
      -->
      <div class="h-[32rem] overflow-auto rounded-xl border border-stone-200
                  lg:h-[calc(100vh-19rem)] dark:border-stone-800">
        <!--
          Fixed layout, and every column given a width.
          
          With automatic layout the browser sizes columns from their contents,
          so one cell changing from 'waiting' to 'taken' re-measures all 1052
          rows and repaints the whole table. That is the flashing: the DOM
          barely changes, but the layout is recomputed wholesale. Fixed layout
          takes widths from the first row alone, so a changed cell repaints
          itself and nothing else.
        -->
        <table class="w-full table-fixed text-sm">
          <!--
            Only the name column flexes, so every other width is subtracted
            from it. They previously summed to more than the panel and left it
            fourteen pixels wide.
          -->
          <colgroup>
            <col style="width: 2.25rem" />
            <col style="min-width: 9rem" />
            <col style="width: 6rem" />
            <col style="width: 5.25rem" />
            <col style="width: 5.25rem" />
            <col style="width: 5.25rem" />
            <col style="width: 5.25rem" />
            <col style="width: 7.5rem" />
          </colgroup>
          <thead class="sticky top-0 z-10 text-left">
            <tr class="bg-stone-100 dark:bg-stone-900">
              <th class="w-9 px-3 py-2 shadow-[inset_0_-1px_0_rgb(0_0_0/0.08)]
                         dark:shadow-[inset_0_-1px_0_rgb(255_255_255/0.08)]"></th>
              <th class="px-3 py-2 font-medium shadow-[inset_0_-1px_0_rgb(0_0_0/0.08)]
                         dark:shadow-[inset_0_-1px_0_rgb(255_255_255/0.08)]">Name</th>
              <th class="px-3 py-2 font-medium whitespace-nowrap
                         shadow-[inset_0_-1px_0_rgb(0_0_0/0.08)]
                         dark:shadow-[inset_0_-1px_0_rgb(255_255_255/0.08)]">Approach</th>
              {#each CHECK_ORDER as k}
                <th class="px-3 py-2 font-medium whitespace-nowrap
                           shadow-[inset_0_-1px_0_rgb(0_0_0/0.08)]
                           dark:shadow-[inset_0_-1px_0_rgb(255_255_255/0.08)]">{CHECK_LABEL[k]}</th>
              {/each}
              <th class="px-3 py-2 text-right font-medium whitespace-nowrap
                         shadow-[inset_0_-1px_0_rgb(0_0_0/0.08)]
                         dark:shadow-[inset_0_-1px_0_rgb(255_255_255/0.08)]">Action</th>
            </tr>
          </thead>
          <tbody>
            {#each shown as c (c.id)}
              <tr class="border-t border-stone-100 transition-colors duration-100
                         hover:bg-stone-50 dark:border-stone-800/70 dark:hover:bg-stone-900">
                <td class="px-3 py-1.5">
                  <input type="checkbox" class="accent-stone-900 dark:accent-stone-100"
                    checked={selected[c.id] ?? true}
                    onchange={(e) => (selected[c.id] = (e.currentTarget as HTMLInputElement).checked)} />
                </td>
                <td class="px-3 py-1.5 font-medium {c.passed ? '' : 'text-stone-500 dark:text-stone-400'}">
                  <!--
                    A button, because it is reachable by keyboard and a span
                    with a tabindex is not something a screen reader can
                    describe. The reason also stays in the title attribute, so
                    it survives without JavaScript and on touch.
                  -->
                  <button type="button" title={c.rationale ?? ''}
                          class="cursor-help text-left decoration-stone-300 decoration-dotted
                                 underline-offset-4 hover:underline dark:decoration-stone-600"
                          onmouseenter={(e) => showHint(e, c.rationale)}
                          onmouseleave={() => (hint = null)}
                          onfocus={(e) => showHint(e as unknown as MouseEvent, c.rationale)}
                          onblur={() => (hint = null)}>{c.name}</button>
                </td>
                <td class="px-3 py-1.5 whitespace-nowrap text-stone-500 dark:text-stone-400">
                  {STRATEGY_LABEL[c.strategy] ?? c.strategy ?? '—'}
                </td>
                {#each CHECK_ORDER as k}
                  <td class="px-3 py-1.5 whitespace-nowrap {CELL[c[k] as CheckStatus].class}"
                      title={c.detail?.[k] ?? ''}>
                    {#if c.detail?.[k]}
                      <!-- A verdict that found something links to what it found. -->
                      <a href={CHECK_SEARCH[k](c.name)} target="_blank" rel="noopener noreferrer"
                         class="underline decoration-dotted underline-offset-2 hover:decoration-solid"
                      >{CELL[c[k] as CheckStatus].text}</a>
                    {:else}
                      {CELL[c[k] as CheckStatus].text}
                    {/if}
                  </td>
                {/each}
                <!--
                  One button for the ordinary case - run whatever this run
                  requires - and a menu for the one check you actually doubt.
                -->
                <td class="px-3 py-1.5 text-right whitespace-nowrap">
                  <span class="inline-flex overflow-hidden rounded border border-stone-300
                               dark:border-stone-700">
                    <button onclick={() => recheck(c)} disabled={rechecking[c.id]}
                      title="Re-run the checks this run requires"
                      class="px-2 py-0.5 text-xs transition-colors duration-100
                             hover:bg-stone-100 disabled:opacity-50 dark:hover:bg-stone-800">
                      {rechecking[c.id] ? 'Checking…' : 'Check'}
                    </button>
                    <button
                      onclick={(e) => {
                        const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
                        menu = menu?.id === c.id ? null : { id: c.id, x: r.right, y: r.bottom + 4 };
                      }}
                      disabled={rechecking[c.id]}
                      aria-label="Check one thing for {c.name}"
                      class="border-l border-stone-300 px-1.5 py-0.5 text-xs transition-colors
                             duration-100 hover:bg-stone-100 disabled:opacity-50
                             dark:border-stone-700 dark:hover:bg-stone-800">▾</button>
                  </span>
                </td>
              </tr>
            {:else}
              <tr><td colspan="8" class="px-4 py-12 text-center text-sm text-stone-500">
                {#if run.status === 'queued'}
                  Queued. Waiting for the worker to pick this up.
                {:else if run.status === 'generating'}
                  Generating {run.targetCount} names. They appear here in batches as
                  they are written - the first arrives in a few minutes.
                {:else if onlyPassed}
                  Nothing has cleared every requirement yet.
                  Untick “only names that passed” to watch the checks land.
                {:else}
                  Nothing yet.
                {/if}
              </td></tr>
            {/each}
          </tbody>
        </table>
      </div>
    </section>

    <!-- The worker runs on another machine, so its console is piped here. -->
    <section class="lg:sticky lg:top-6 lg:self-start">
      <button onclick={() => (consoleOpen = !consoleOpen)}
        class="mb-2 flex w-full items-center justify-between text-sm">
        <span class="font-medium">Console</span>
        <span class="text-xs text-stone-500">{consoleOpen ? 'Hide' : `Show (${events.length})`}</span>
      </button>
      {#if consoleOpen}
        <div bind:this={logEl}
          class="h-72 overflow-y-auto rounded-xl border border-stone-200 bg-stone-50 p-3
                 font-mono text-xs leading-relaxed lg:h-[calc(100vh-19rem)]
                 dark:border-stone-800 dark:bg-stone-950">
          {#each events as e (e.id)}
            <div class="flex gap-2 py-px">
              <span class="shrink-0 text-stone-400 tabular-nums dark:text-stone-600">{time(e.at)}</span>
              <span class="{LEVEL[e.level] ?? LEVEL.info} break-words">{e.message}</span>
            </div>
          {:else}
            <p class="text-stone-500">
              {#if run.status === 'queued'}
                Waiting for a worker to pick this run up.
              {:else if finished}
                This run recorded no console output.
              {:else}
                No console output. The run is working - see the counters above -
                but the worker process handling it started before console
                recording existed, so it has no way to report its progress here.
              {/if}
            </p>
          {/each}
        </div>
      {/if}
    </section>
  </div>

  {#if hint}
    <div class="pointer-events-none fixed z-50 max-w-xs rounded-lg border border-stone-200
                bg-white px-3 py-2 text-sm shadow-lg shadow-stone-900/10
                dark:border-stone-700 dark:bg-stone-900 dark:shadow-black/40"
         style="left: {hint.x}px; top: {hint.y}px">
      {hint.text}
    </div>
  {/if}

  {#if menu}
    {@const row = candidates.find((c) => c.id === menu!.id)}
    <!--
      Fixed, not absolute. The table scrolls inside its own panel, so a menu
      anchored to the row would be clipped by that container's overflow.
    -->
    <div class="fixed inset-0 z-40" onclick={() => (menu = null)} role="presentation"></div>
    <div class="fixed z-50 min-w-44 -translate-x-full rounded-lg border border-stone-200
                bg-white py-1 shadow-lg shadow-stone-900/10 dark:border-stone-700
                dark:bg-stone-900 dark:shadow-black/40"
         style="left: {menu.x}px; top: {menu.y}px">
      <p class="px-3 py-1 text-xs text-stone-500">Check one thing</p>
      {#each CHECK_ORDER as k}
        <button onclick={() => row && recheck(row, k)}
          class="flex w-full items-center justify-between gap-4 px-3 py-1.5 text-left text-sm
                 transition-colors duration-100 hover:bg-stone-100 dark:hover:bg-stone-800">
          <span>{CHECK_LABEL[k]}</span>
          {#if row}
            <span class="text-xs {CELL[row[k] as CheckStatus].class}">
              {CELL[row[k] as CheckStatus].text}
            </span>
          {/if}
        </button>
      {/each}
      {#if row}
        <div class="my-1 border-t border-stone-200 dark:border-stone-800"></div>
        <p class="px-3 py-1 text-xs text-stone-500">Look for yourself</p>
        {#each CHECK_ORDER as k}
          <a href={CHECK_SEARCH[k](row.name)} target="_blank" rel="noopener noreferrer"
             onclick={() => (menu = null)}
             class="block px-3 py-1.5 text-sm transition-colors duration-100
                    hover:bg-stone-100 dark:hover:bg-stone-800">
            {CHECK_LABEL[k]} search ↗
          </a>
        {/each}
      {/if}
    </div>
  {/if}
{/if}
