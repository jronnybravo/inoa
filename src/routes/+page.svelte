<script lang="ts">
  import { CHECK_LABEL, CHECK_ORDER, STRATEGIES, type CheckStatus } from '$lib/types';

  let { data } = $props();

  /**
   * One route, two jobs. Without a request id you are composing a brief; with
   * one you are watching it run. They want opposite layouts — a form wants a
   * narrow centred column, a running job wants width for the table and a
   * second column for the console — so they are laid out separately rather
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
  let selected = $state<Record<string, boolean>>({});
  let consoleOpen = $state(true);
  let copied = $state(false);
  let logEl = $state<HTMLDivElement | null>(null);

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
    skipped: { text: '–', class: 'text-stone-400 dark:text-stone-600' },
    pending: { text: '·', class: 'text-stone-300 dark:text-stone-700' }
  };

  const LEVEL: Record<string, string> = {
    info: 'text-stone-600 dark:text-stone-400',
    success: 'text-emerald-700 dark:text-emerald-400',
    warn: 'text-amber-700 dark:text-amber-400',
    error: 'text-rose-700 dark:text-rose-400'
  };

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
          brief, strategies, requireCom, requireAppStore, requirePlayStore, requireGoogle, email
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
      window.location.search = `?requestid=${pendingRunId}`;
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
            candidates = payload.candidates;
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
    return candidates.filter((c) => selected[c.id] ?? true);
  }

  async function copyCsv() {
    const header = ['Name', ...CHECK_ORDER.map((k) => CHECK_LABEL[k])].join(',');
    const rows = visibleRows().map((c) =>
      [c.name, ...CHECK_ORDER.map((k) => CELL[c[k] as CheckStatus].text)]
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
      {#each run.strategies as s}
        <span class="rounded bg-stone-100 px-1.5 py-0.5 dark:bg-stone-800">
          {STRATEGIES.find((x) => x.id === s)?.label ?? s}
        </span>
      {/each}
      <span class="text-stone-300 dark:text-stone-700">·</span>
      <span>requires</span>
      {#each requirements.filter((r) => run[`require${r.key[0].toUpperCase()}${r.key.slice(1)}`]) as r}
        <span class="rounded bg-stone-100 px-1.5 py-0.5 dark:bg-stone-800">{r.label}</span>
      {:else}
        <span class="italic">nothing — every name is reported</span>
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
  <div class="mt-4 grid gap-4 lg:grid-cols-[minmax(0,1fr)_22rem]">
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

      <div class="overflow-x-auto rounded-xl border border-stone-200 dark:border-stone-800">
        <table class="w-full text-sm">
          <thead class="bg-stone-100 text-left dark:bg-stone-900">
            <tr>
              <th class="w-9 px-3 py-2"></th>
              <th class="px-3 py-2 font-medium">Name</th>
              {#each CHECK_ORDER as k}
                <th class="px-3 py-2 font-medium whitespace-nowrap">{CHECK_LABEL[k]}</th>
              {/each}
            </tr>
          </thead>
          <tbody>
            {#each candidates as c (c.id)}
              <tr class="border-t border-stone-100 transition-colors duration-100
                         hover:bg-stone-50 dark:border-stone-800/70 dark:hover:bg-stone-900">
                <td class="px-3 py-1.5">
                  <input type="checkbox" class="accent-stone-900 dark:accent-stone-100"
                    checked={selected[c.id] ?? true}
                    onchange={(e) => (selected[c.id] = (e.currentTarget as HTMLInputElement).checked)} />
                </td>
                <td class="px-3 py-1.5 font-medium {c.passed ? '' : 'text-stone-500 dark:text-stone-400'}"
                    title={c.rationale ?? ''}>{c.name}</td>
                {#each CHECK_ORDER as k}
                  <td class="px-3 py-1.5 whitespace-nowrap {CELL[c[k] as CheckStatus].class}"
                      title={c.detail?.[k] ?? ''}>{CELL[c[k] as CheckStatus].text}</td>
                {/each}
              </tr>
            {:else}
              <tr><td colspan="6" class="px-4 py-12 text-center text-sm text-stone-500">
                {#if run.status === 'queued'}
                  Queued. Waiting for the worker to pick this up.
                {:else if run.status === 'generating'}
                  Generating {run.targetCount} names. They appear here in batches as
                  they are written — the first arrives in a few minutes.
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
                 font-mono text-xs leading-relaxed lg:h-[32rem]
                 dark:border-stone-800 dark:bg-stone-950">
          {#each events as e}
            <div class="flex gap-2 py-px">
              <span class="shrink-0 text-stone-400 tabular-nums dark:text-stone-600">{time(e.at)}</span>
              <span class="{LEVEL[e.level] ?? LEVEL.info} break-words">{e.message}</span>
            </div>
          {:else}
            <p class="text-stone-500">Waiting for the worker…</p>
          {/each}
        </div>
      {/if}
    </section>
  </div>
{/if}
