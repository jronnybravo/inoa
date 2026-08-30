<script lang="ts">
  import { CHECK_LABEL, CHECK_ORDER, STRATEGIES, type CheckStatus } from '$lib/types';

  let { data } = $props();

  const locked = $derived(Boolean(data.run));

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
  let code = $state('');

  let run = $state<any>(data.run ?? null);
  let candidates = $state<any[]>([]);
  let onlyPassed = $state(true);
  let selected = $state<Record<string, boolean>>({});

  const options = [
    { key: 'requireCom', label: 'Require .com', get: () => requireCom, set: (v: boolean) => (requireCom = v) },
    { key: 'requireAppStore', label: 'Require App Store', get: () => requireAppStore, set: (v: boolean) => (requireAppStore = v) },
    { key: 'requirePlayStore', label: 'Require Play Store', get: () => requirePlayStore, set: (v: boolean) => (requirePlayStore = v) },
    { key: 'requireGoogle', label: 'Require Google', get: () => requireGoogle, set: (v: boolean) => (requireGoogle = v) }
  ];

  async function execute() {
    problem = '';
    submitting = true;
    try {
      const response = await fetch('/api/runs', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          brief, strategies, requireCom, requireAppStore,
          requirePlayStore, requireGoogle, email
        })
      });
      if (!response.ok) throw new Error((await response.json()).message ?? 'Could not start');
      pendingRunId = (await response.json()).id;
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
      // Reload into the locked, live-results state.
      window.location.search = `?requestid=${pendingRunId}`;
    } catch (e) {
      problem = (e as Error).message;
    } finally {
      submitting = false;
    }
  }

  /**
   * Polling, not SSE. A streaming response would hold a Vercel function open
   * and hit the duration cap this whole design exists to avoid.
   */
  $effect(() => {
    if (!data.run) return;
    let alive = true;
    const tick = async () => {
      while (alive) {
        try {
          const r = await fetch(`/api/runs/${data.run.id}?passed=${onlyPassed ? 1 : 0}`);
          if (r.ok) {
            const payload = await r.json();
            run = payload.run;
            candidates = payload.candidates;
            if (run.status === 'done' || run.status === 'failed') return;
          }
        } catch { /* transient; keep polling */ }
        await new Promise((r) => setTimeout(r, 2500));
      }
    };
    tick();
    return () => { alive = false; };
  });

  const CELL: Record<CheckStatus, { text: string; class: string }> = {
    clear:   { text: 'free',     class: 'text-emerald-700 dark:text-emerald-400' },
    taken:   { text: 'taken',    class: 'text-rose-700 dark:text-rose-400' },
    unknown: { text: 'unverified', class: 'text-amber-700 dark:text-amber-400' },
    skipped: { text: '—',        class: 'text-stone-400' },
    pending: { text: '·',        class: 'text-stone-300 dark:text-stone-600' }
  };

  function toCsv() {
    const header = ['Name', ...CHECK_ORDER.map((k) => CHECK_LABEL[k])].join(',');
    const rows = candidates
      .filter((c) => selected[c.id] ?? true)
      .map((c) => [c.name, ...CHECK_ORDER.map((k) => CELL[c[k] as CheckStatus].text)]
        .map((v) => `"${v}"`).join(','));
    return [header, ...rows].join('\n');
  }

  async function copyCsv() {
    await navigator.clipboard.writeText(toCsv());
  }
</script>

<h1 class="text-3xl font-semibold tracking-tight">Brandy</h1>
<p class="mt-1 text-stone-600 dark:text-stone-400">
  Generate names from a brief, then screen them against the places a name can already be taken.
</p>

<section class="mt-8 rounded-xl border border-stone-200 bg-white p-6 dark:border-stone-800 dark:bg-stone-900">
  <fieldset disabled={locked} class="space-y-6 disabled:opacity-70">
    <div>
      <label for="brief" class="block text-sm font-medium">Brief</label>
      <textarea id="brief" bind:value={brief} rows="3"
        placeholder="A marketplace connecting local farms to restaurant kitchens."
        class="mt-2 w-full rounded-lg border border-stone-300 bg-white px-3 py-2 text-sm
               dark:border-stone-700 dark:bg-stone-950"></textarea>
    </div>

    <div>
      <span class="block text-sm font-medium">Naming strategy</span>
      <div class="mt-2 grid gap-2 sm:grid-cols-2">
        {#each STRATEGIES as s}
          <label class="flex items-start gap-2 rounded-lg border border-stone-200 p-3 text-sm
                        dark:border-stone-800">
            <input type="checkbox" class="mt-0.5" checked={strategies.includes(s.id)}
              onchange={(e) => {
                const on = (e.currentTarget as HTMLInputElement).checked;
                strategies = on ? [...strategies, s.id] : strategies.filter((x) => x !== s.id);
              }} />
            <span>
              <span class="font-medium">{s.label}</span>
              <span class="block text-xs text-stone-500">{s.hint}</span>
            </span>
          </label>
        {/each}
      </div>
    </div>

    <div>
      <span class="block text-sm font-medium">Requirements</span>
      <p class="mt-1 text-xs text-stone-500">
        A required check drops a name as soon as it fails. Unrequired checks still run and are reported.
      </p>
      <div class="mt-2 flex flex-wrap gap-3">
        {#each options as o}
          <label class="flex items-center gap-2 rounded-lg border border-stone-200 px-3 py-2 text-sm
                        dark:border-stone-800">
            <input type="checkbox" checked={o.get()}
              onchange={(e) => o.set((e.currentTarget as HTMLInputElement).checked)} />
            {o.label}
          </label>
        {/each}
      </div>
    </div>

    <div>
      <label for="email" class="block text-sm font-medium">Email</label>
      <input id="email" bind:value={email} type="email" placeholder="you@example.com"
        class="mt-2 w-full max-w-sm rounded-lg border border-stone-300 px-3 py-2 text-sm
               dark:border-stone-700 dark:bg-stone-950" />
      <p class="mt-1 text-xs text-stone-500">Verified once, then used to send the finished results.</p>
    </div>
  </fieldset>

  {#if problem}
    <p class="mt-4 rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-800
              dark:bg-rose-950 dark:text-rose-200">{problem}</p>
  {/if}

  {#if !locked}
    {#if pendingRunId}
      <div class="mt-6 rounded-lg border border-stone-200 p-4 dark:border-stone-800">
        <p class="text-sm">We sent a six-digit code to <b>{email}</b>. Enter it to start the run.</p>
        <div class="mt-3 flex gap-2">
          <input bind:value={code} inputmode="numeric" maxlength="6" placeholder="000000"
            class="w-32 rounded-lg border border-stone-300 px-3 py-2 text-sm tracking-widest
                   dark:border-stone-700 dark:bg-stone-950" />
          <button onclick={verify} disabled={submitting}
            class="rounded-lg bg-stone-900 px-4 py-2 text-sm font-medium text-white
                   disabled:opacity-50 dark:bg-white dark:text-stone-900">Verify and run</button>
        </div>
      </div>
    {:else}
      <button onclick={execute} disabled={submitting || brief.length < 12 || !email}
        class="mt-6 rounded-lg bg-stone-900 px-5 py-2.5 text-sm font-medium text-white
               disabled:opacity-40 dark:bg-white dark:text-stone-900">
        {submitting ? 'Starting…' : 'Execute'}
      </button>
    {/if}
  {/if}
</section>

{#if locked && run}
  <section class="mt-8">
    <div class="flex flex-wrap items-baseline justify-between gap-3">
      <h2 class="text-lg font-semibold">
        Results
        <span class="ml-2 rounded-full bg-stone-200 px-2 py-0.5 text-xs font-normal
                     dark:bg-stone-800">{run.status}</span>
      </h2>
      <div class="flex items-center gap-3 text-sm">
        <label class="flex items-center gap-2">
          <input type="checkbox" bind:checked={onlyPassed} /> Only names that passed
        </label>
        <button onclick={copyCsv}
          class="rounded-lg border border-stone-300 px-3 py-1.5 dark:border-stone-700">Copy CSV</button>
      </div>
    </div>

    <p class="mt-1 text-sm text-stone-500">
      {run.generatedCount} generated · {run.checkedCount} checked
      {#if run.status === 'queued'} · waiting for the worker to pick this up{/if}
    </p>

    {#if run.error}
      <p class="mt-3 rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-800
                dark:bg-rose-950 dark:text-rose-200">{run.error}</p>
    {/if}

    <div class="mt-4 overflow-x-auto rounded-xl border border-stone-200 dark:border-stone-800">
      <table class="w-full text-sm">
        <thead class="bg-stone-100 text-left dark:bg-stone-900">
          <tr>
            <th class="w-10 px-3 py-2"></th>
            <th class="px-3 py-2 font-medium">Name</th>
            {#each CHECK_ORDER as k}
              <th class="px-3 py-2 font-medium">{CHECK_LABEL[k]}</th>
            {/each}
          </tr>
        </thead>
        <tbody>
          {#each candidates as c (c.id)}
            <tr class="border-t border-stone-100 hover:bg-stone-50
                       dark:border-stone-800 dark:hover:bg-stone-900">
              <td class="px-3 py-2">
                <input type="checkbox" checked={selected[c.id] ?? true}
                  onchange={(e) => (selected[c.id] = (e.currentTarget as HTMLInputElement).checked)} />
              </td>
              <td class="px-3 py-2 font-medium">{c.name}</td>
              {#each CHECK_ORDER as k}
                <td class="px-3 py-2 {CELL[c[k] as CheckStatus].class}" title={c.detail?.[k] ?? ''}>
                  {CELL[c[k] as CheckStatus].text}
                </td>
              {/each}
            </tr>
          {:else}
            <tr><td colspan="6" class="px-3 py-8 text-center text-stone-500">
              {run.status === 'queued' ? 'Queued. Results appear here as they are checked.' : 'Nothing yet.'}
            </td></tr>
          {/each}
        </tbody>
      </table>
    </div>
  </section>
{/if}
