/**
 * The run: submit a brief, stream the discovery, render the specimen sheet.
 *
 * Uses a streaming fetch reader rather than EventSource, because EventSource
 * hides the HTTP status and this endpoint has two failure modes the user needs
 * told apart: a rejected brief (400) and a rate limit (429).
 */

import { profile, syllabify } from '../../core/phonology.ts';
import { DIMENSIONS, TICKS } from '../lib/dimensions.ts';
import type { Candidate, DiscoveryResult, ProgressEvent, Scores } from '../../core/types.ts';

interface ResultPayload {
  result: DiscoveryResult;
  markdown: string;
  elapsedMs: number;
}

const EXAMPLES = [
  "A calm, private assistant that organizes a family's shared life",
  'Developer tooling that makes deploys fast and precise',
  'A marketplace connecting local farms to restaurant kitchens',
  'A savings app that makes putting money away feel effortless',
  'Hardware that measures air quality in classrooms',
];

// --------------------------------------------------------------- DOM helpers

type Child = Node | string | null | undefined | false;

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attrs: Record<string, string | number | boolean | undefined> = {},
  ...children: Child[]
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs)) {
    if (value === undefined || value === false) continue;
    node.setAttribute(key, String(value));
  }
  for (const child of children) {
    if (child === null || child === undefined || child === false) continue;
    node.append(typeof child === 'string' ? document.createTextNode(child) : child);
  }
  return node;
}

function query<T extends Element>(selector: string): T {
  const node = document.querySelector<T>(selector);
  if (!node) throw new Error(`missing element: ${selector}`);
  return node;
}

// ------------------------------------------------------------------ elements

const form = query<HTMLFormElement>('#brief-form');
const briefInput = query<HTMLTextAreaElement>('#brief');
const runButton = query<HTMLButtonElement>('#run');
const exampleButton = query<HTMLButtonElement>('#example');
const costLine = query<HTMLParagraphElement>('#cost');
const notice = query<HTMLDivElement>('#notice');
const capture = query<HTMLElement>('#capture');
const gaugeFill = query<HTMLDivElement>('#gauge-fill');
const gaugeTick = query<HTMLDivElement>('#gauge-tick');
const stageLine = query<HTMLParagraphElement>('#stage');
const elapsedLine = query<HTMLParagraphElement>('#elapsed');
const captureNames = query<HTMLDivElement>('#capture-names');
const results = query<HTMLElement>('#results');

let running = false;
let report: ResultPayload | undefined;

// ------------------------------------------------------------ form ↔ params

function formParams(): URLSearchParams {
  const data = new FormData(form);
  const params = new URLSearchParams();
  params.set('brief', String(data.get('brief') ?? '').trim());

  for (const key of ['industry', 'audience', 'posture', 'avoid', 'syllables', 'cycles', 'validate', 'seed', 'requireTld']) {
    const value = String(data.get(key) ?? '').trim();
    if (value) params.set(key, value);
  }
  const emotions = data.getAll('emotions').map(String);
  if (emotions.length) params.set('emotions', emotions.join(','));
  const tlds = data.getAll('tlds').map(String);
  if (tlds.length) params.set('tlds', tlds.join(','));
  const philosophies = data.getAll('philosophies').map(String);
  if (philosophies.length) params.set('philosophies', philosophies.join(','));
  if (data.get('allowAppCollisions')) params.set('allowAppCollisions', 'true');
  return params;
}

/** Restore a shared run so the same URL reproduces the same sheet. */
function applyParams(params: URLSearchParams): void {
  const brief = params.get('brief');
  if (brief) briefInput.value = brief;

  for (const key of ['industry', 'audience', 'posture', 'avoid', 'syllables', 'cycles', 'validate', 'seed', 'requireTld']) {
    const value = params.get(key);
    if (!value) continue;
    const field = form.elements.namedItem(key);
    if (field instanceof HTMLInputElement || field instanceof HTMLSelectElement) field.value = value;
  }

  const setChecks = (name: string, values: string[] | null | undefined) => {
    if (!values) return;
    for (const box of form.querySelectorAll<HTMLInputElement>(`input[name="${name}"]`)) {
      box.checked = values.includes(box.value);
    }
  };
  setChecks('emotions', params.get('emotions')?.split(','));
  setChecks('tlds', params.get('tlds')?.split(','));
  setChecks('philosophies', params.get('philosophies')?.split(','));

  if (params.get('emotions') || params.get('industry') || params.get('avoid')) {
    query<HTMLDetailsElement>('#advanced').open = true;
  }
}

function updateCost(): void {
  const data = new FormData(form);
  // One cycle per selected strategy — the run's cost is set by that count.
  const cycles = Math.max(1, data.getAll('philosophies').length);
  const validate = Number(data.get('validate') ?? 8);
  const low = Math.max(4, Math.round(cycles * 130 * 0.02 + validate * 0.45));
  const high = Math.round(low + cycles * 1.6 + validate * 0.9);
  const strategy = `${cycles} strateg${cycles === 1 ? 'y' : 'ies'}`;
  costLine.textContent = `${strategy} · about ${low}–${high} seconds · ${validate * 6} registry lookups`;
}

/** At least one strategy has to be selected for a run to mean anything. */
function guardStrategies(): void {
  const boxes = [...form.querySelectorAll<HTMLInputElement>('input[name="philosophies"]')];
  const checked = boxes.filter((b) => b.checked);
  for (const box of boxes) box.disabled = checked.length === 1 && box.checked;
}

// ------------------------------------------------------------------ streaming

function showNotice(message: string): void {
  notice.textContent = message;
  notice.hidden = false;
}

function parseFrames(buffer: string): { frames: string[]; rest: string } {
  const parts = buffer.split('\n\n');
  return { frames: parts.slice(0, -1), rest: parts.at(-1) ?? '' };
}

async function run(): Promise<void> {
  if (running) return;
  const params = formParams();
  if (params.get('brief')!.length < 10) {
    showNotice('Describe what you are naming in at least a few words.');
    briefInput.focus();
    return;
  }

  running = true;
  notice.hidden = true;
  results.replaceChildren();
  captureNames.replaceChildren();
  capture.hidden = false;
  runButton.disabled = true;
  runButton.textContent = 'Running…';
  setGauge(0.02);
  stageLine.textContent = 'Opening the run';
  history.replaceState(null, '', `?${params}`);

  const startedAt = performance.now();
  const ticker = window.setInterval(() => {
    elapsedLine.textContent = `${((performance.now() - startedAt) / 1000).toFixed(1)}s`;
  }, 100);

  try {
    const response = await fetch(`/api/discover?${params}`, { headers: { accept: 'text/event-stream' } });

    if (!response.ok || !response.body) {
      const detail = await response.json().catch(() => ({ error: 'The run could not be started.' }));
      showNotice(String(detail.error ?? 'The run could not be started.'));
      return;
    }

    const reader = response.body.pipeThrough(new TextDecoderStream()).getReader();
    let buffer = '';

    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += value;
      const { frames, rest } = parseFrames(buffer);
      buffer = rest;

      for (const frame of frames) {
        const eventLine = frame.split('\n').find((l) => l.startsWith('event: '));
        const dataLine = frame.split('\n').find((l) => l.startsWith('data: '));
        if (!eventLine || !dataLine) continue;
        const name = eventLine.slice(7).trim();
        const payload = JSON.parse(dataLine.slice(6));

        if (name === 'progress') onProgress(payload as ProgressEvent);
        else if (name === 'result') onResult(payload as ResultPayload);
        else if (name === 'failed') showNotice(`The run failed: ${payload.error}`);
      }
    }
  } catch (error) {
    showNotice(
      `Lost the connection to the run. ${error instanceof Error ? error.message : String(error)}`,
    );
  } finally {
    window.clearInterval(ticker);
    running = false;
    runButton.disabled = false;
    runButton.textContent = 'Run discovery';
  }
}

/** Transform-only, so the travelling tick never triggers layout. */
function setGauge(progress: number): void {
  const clamped = Math.max(0, Math.min(1, progress));
  gaugeFill.style.transform = `scaleX(${clamped})`;
  gaugeTick.style.transform = `translateX(calc(${(clamped * 100).toFixed(2)}cqw - 2px))`;
}

function onProgress(event: ProgressEvent): void {
  setGauge(event.progress);
  stageLine.textContent = event.message;
  if (!event.preview?.length) return;

  captureNames.replaceChildren();
  for (const [index, name] of event.preview.entries()) {
    const span = el('span', { class: 'capture__name' }, name);
    span.style.animationDelay = `${index * 45}ms`;
    captureNames.append(span);
  }
}

function onResult(payload: ResultPayload): void {
  report = payload;
  setGauge(1);
  stageLine.textContent = payload.result.finalists.length
    ? `Done — ${payload.result.generatedTotal} candidates considered`
    : 'Done';
  renderResults(payload);
  // After a 10–30 second wait the sheet is what the user came for, so land on
  // it — but only from the top of the page, never yanking a reader who scrolled.
  if (window.scrollY < results.offsetTop) {
    requestAnimationFrame(() => {
      window.scrollTo({ top: results.offsetTop - 16, behavior: 'smooth' });
    });
  }
}

// ------------------------------------------------------------------ specimens

function syllableSplit(name: string): HTMLElement {
  const parts = syllabify(name);
  const wrapper = el('p', { class: 'syllables' });
  parts.forEach((part, index) => {
    if (index > 0) wrapper.append(el('span', { class: 'syllables__sep' }, '·'));
    wrapper.append(el('span', {}, part.text));
  });
  const shape = profile(name);
  wrapper.append(
    el(
      'span',
      { class: 'syllables__skeleton' },
      `${shape.cvPattern} · ${shape.syllableCount} syllable${shape.syllableCount === 1 ? '' : 's'}`,
    ),
  );
  return wrapper;
}

function densityColumns(scores: Scores, readout: HTMLElement, name: string): HTMLElement {
  const row = el('div', { class: 'density', role: 'group', 'aria-label': `Scores for ${name}` });

  DIMENSIONS.forEach((dimension, index) => {
    const value = Math.round(scores[dimension.key]);
    const filled = Math.round((value / 100) * TICKS);
    const describedById = `d-${name}-${index}`;

    const ticks = el('span', { class: 'density__ticks', 'aria-hidden': 'true' });
    for (let i = 0; i < TICKS; i++) {
      ticks.append(el('span', { class: `density__tick${i < filled ? ' density__tick--on' : ''}` }));
    }

    const column = el(
      'button',
      {
        type: 'button',
        class: 'density__col',
        'aria-label': `${dimension.label}: ${value} out of 100`,
        'aria-describedby': describedById,
      },
      ticks,
      el('span', { class: 'density__value', 'aria-hidden': 'true' }, String(value)),
      el('span', { class: 'density__abbr', 'aria-hidden': 'true' }, dimension.abbr),
      el('span', { class: 'sr-only', id: describedById }, dimension.meaning),
    );

    const explain = () => {
      readout.replaceChildren(
        el('b', {}, `${dimension.label} ${value}. `),
        document.createTextNode(dimension.meaning),
      );
    };
    column.addEventListener('mouseenter', explain);
    column.addEventListener('focus', explain);
    column.addEventListener('click', explain);

    row.append(column);
  });

  return row;
}

function stampFor(status: string): string {
  if (status === 'available') return 'stamp stamp--available';
  // A live business on the domain is the only fatal outcome; 'no-active-site'
  // is obtainable and reads neutral rather than red.
  if (status === 'taken') return 'stamp stamp--taken';
  return 'stamp';
}

/**
 * One availability stamp.
 *
 * When something is actually there — a taken handle, a live site, an app
 * listing — the stamp becomes a link to it. A verdict you cannot go and look at
 * is only half an answer: the useful next move after "github: taken" is seeing
 * who has it.
 */
function stamp(
  className: string,
  what: string,
  status: string,
  options: { url?: string; title?: string } = {},
): HTMLElement {
  const label = el('span', { class: 'stamp__what' }, what);

  if (!options.url) {
    return el('li', { class: className, title: options.title }, label, status);
  }

  return el(
    'li',
    { class: `${className} stamp--link` },
    el(
      'a',
      {
        href: options.url,
        target: '_blank',
        rel: 'noopener noreferrer',
        title: options.title,
        'aria-label': `${what} ${status} — open ${options.url}`,
      },
      label,
      status,
    ),
  );
}

function availability(candidate: Candidate): HTMLElement {
  const list = el('ul', { class: 'stamps' });
  if (!candidate.validation) {
    list.append(el('li', { class: 'stamp' }, 'not verified'));
    return list;
  }

  for (const domain of candidate.validation.domains) {
    // Nothing to open when the domain is unregistered.
    const url = domain.status === 'available' ? undefined : domain.url;
    list.append(
      stamp(stampFor(domain.status), domain.domain, domain.status, {
        url,
        title: domain.detail ?? `verified via ${domain.method}`,
      }),
    );
  }

  for (const handle of candidate.validation.social) {
    list.append(
      stamp(stampFor(handle.status), handle.platform, handle.status, {
        url: handle.status === 'taken' ? handle.url : undefined,
        title: handle.method,
      }),
    );
  }

  for (const store of candidate.validation.appStores ?? []) {
    // 'clear' is the good outcome here, the reverse of a domain being free.
    const cls =
      store.status === 'clear'
        ? 'stamp stamp--available'
        : store.status === 'taken'
          ? 'stamp stamp--taken'
          : 'stamp';
    list.append(
      stamp(cls, store.store.replace('-', ' '), store.status, {
        url: store.status === 'taken' ? store.url : undefined,
        title: store.matches.join(' · ') || store.method,
      }),
    );
  }
  return list;
}

function clearanceLinks(name: string): HTMLElement {
  const q = encodeURIComponent(name);
  const registries: [string, string][] = [
    ['USPTO', `https://tmsearch.uspto.gov/search/search-information?q=${q}`],
    ['EUIPO', `https://www.tmdn.org/tmview/#/tmview/results?basicSearch=${q}`],
    ['WIPO', `https://branddb.wipo.int/en/quicksearch?q=${q}`],
    ['UKIPO', `https://trademarks.ipo.gov.uk/ipo-tmtext?searchTerm=${q}`],
  ];
  const paragraph = el('p', { class: 'clearance' }, el('span', { class: 'notation' }, 'Clear it properly '));
  registries.forEach(([label, href], index) => {
    if (index > 0) paragraph.append(document.createTextNode(' · '));
    paragraph.append(el('a', { href, target: '_blank', rel: 'noopener noreferrer' }, label));
  });
  return paragraph;
}

function specimen(candidate: Candidate, rank: number): HTMLElement {
  const scores = candidate.scores;
  const readout = el(
    'p',
    { class: 'readout' },
    'Hover or focus any column to see what it measures.',
  );

  const left = el(
    'div',
    {},
    el('h3', { class: 'specimen__name' }, candidate.display),
    syllableSplit(candidate.name),
    el('p', { class: 'specimen__rationale' }, candidate.rationale),
  );

  if (candidate.seeds.length) {
    const roots = el('ul', { class: 'roots' });
    for (const seed of candidate.seeds.slice(0, 3)) {
      roots.append(
        el(
          'li',
          {},
          el('b', {}, seed.form),
          ` — ${seed.gloss}${seed.language !== 'english' ? ` (${seed.language})` : ''}`,
        ),
      );
    }
    left.append(roots);
  }

  if (scores) {
    left.append(densityColumns(scores, readout, candidate.name));
    left.append(readout);
  }

  const right = el('div', {});
  if (scores) {
    right.append(
      el(
        'p',
        { class: 'overall' },
        el('span', { class: 'overall__value' }, String(scores.overall)),
        el('span', { class: 'notation' }, 'overall'),
      ),
    );
  }
  right.append(el('p', { class: 'notation' }, 'Availability'), availability(candidate));

  const risks = el('ul', { class: candidate.risks.length ? 'risks' : 'risks risks--clear' });
  if (candidate.risks.length) {
    for (const risk of [...new Set(candidate.risks)]) risks.append(el('li', {}, risk));
  } else {
    risks.append(el('li', {}, 'No risks found by the offline screens.'));
  }
  right.append(risks);

  if (rank <= 3) right.append(clearanceLinks(candidate.display));

  return el(
    'article',
    { class: 'specimen' },
    el('span', { class: 'specimen__rank', 'aria-hidden': 'true' }, String(rank).padStart(2, '0')),
    left,
    right,
  );
}

// -------------------------------------------------------------------- sheets

function slip(index: string, heading: string, note: string | undefined, ...body: Child[]): HTMLElement {
  const head = el('div', { class: 'slip__head' }, el('h2', { class: 'notation notation--ink' }, heading));
  if (note) head.append(el('p', { class: 'notation' }, note));
  return el(
    'section',
    { class: 'slip' },
    el('span', { class: 'slip__index', 'aria-hidden': 'true' }, index),
    head,
    ...body,
  );
}

function dnaTable(result: DiscoveryResult): HTMLElement {
  const dna = result.dna;
  const rows: [string, string][] = [
    ['Emotional target', dna.emotions.join(', ')],
    ['Posture', dna.posture],
    ['Industry today', dna.industryNow],
    ['Concept space', dna.concepts.join(', ')],
    ['Sound targets', dna.soundTargets.join('; ')],
    ['Syllable target', `${dna.syllableRange[0]}–${dna.syllableRange[1]}`],
  ];
  if (dna.avoid.length) rows.push(['Ruled out', dna.avoid.join(', ')]);

  const table = el('table', { class: 'dna' });
  const body = el('tbody');
  for (const [label, value] of rows) {
    body.append(el('tr', {}, el('th', { scope: 'row' }, label), el('td', {}, value)));
  }
  table.append(body);
  return table;
}

function renderResults(payload: ResultPayload): void {
  const { result } = payload;
  results.replaceChildren();

  // 02 — what the engine decided the brief means.
  results.append(
    slip(
      '02',
      'Brand DNA',
      'What the engine read into the brief',
      dnaTable(result),
    ),
  );

  // 03 — the specimen sheet.
  const sheet = slip(
    '03',
    'Specimen sheet',
    `${result.finalists.length} verified from ${result.generatedTotal} candidates`,
  );
  if (result.history && result.history.excluded > 0) {
    sheet.append(
      el(
        'p',
        { class: 'prose' },
        el('b', {}, `${result.history.excluded} candidates skipped`),
        ` because earlier runs already showed them (${result.history.remembered} names remembered).`,
        result.history.exhausted
          ? ' The history now covers most of what this brief produces, so repeats were allowed rather than returning a short sheet.'
          : '',
      ),
    );
  }
  if (result.appStoreScreen && result.appStoreScreen.rejected > 0) {
    sheet.append(
      el(
        'p',
        { class: 'prose' },
        `App stores: `,
        el('b', {}, `${result.appStoreScreen.rejected} names dropped`),
        ` for an existing listing (${result.appStoreScreen.names.join(', ')})`,
        result.appStoreScreen.unresolved > 0
          ? `. ${result.appStoreScreen.unresolved} could not be confirmed on Play, which has no public API.`
          : '.',
      ),
    );
  }
  if (result.prescreen) {
    sheet.append(
      el(
        'p',
        { class: 'prose' },
        `Required .${result.prescreen.tld}: ${result.prescreen.examined} candidates checked for a live site. `,
        el('b', {}, 'Only names with a working business on the domain were dropped'),
        ' — parked, for-sale, squatted and dormant domains were kept, since those are obtainable and registry data cannot tell them apart.',
      ),
    );
  }
  if (result.finalists.length === 0) {
    sheet.append(el('p', { class: 'empty' }, 'Nothing survived the screens. Try a broader brief.'));
  }
  result.finalists.forEach((candidate, index) => sheet.append(specimen(candidate, index + 1)));

  sheet.append(
    el(
      'p',
      { class: 'caveat' },
      el('b', {}, 'Trademark figures are estimates. '),
      'They come from a corpus of well-known marks plus sight, sound and relatedness heuristics — the factors an examiner applies. This is a shortlisting filter, not a clearance search, and not legal advice. Search the registries above before you commit.',
    ),
  );
  results.append(sheet);

  // 04 — how it searched, and where it would look next.
  const method = slip('04', 'How it searched', `${result.cycles.length} naming philosophies`);
  for (const cycle of result.cycles) {
    method.append(
      el(
        'div',
        { class: 'cycle' },
        el('p', { class: 'notation notation--ink' }, `Cycle ${cycle.cycle} — ${cycle.philosophy}`),
        el(
          'p',
          { class: 'prose' },
          `${cycle.generated} generated, ${cycle.survived} scored 75 or better. Best of this cycle: `,
          el('span', { class: 'cycle__names' }, cycle.top.slice(0, 5).map((c) => c.display).join(', ')),
        ),
      ),
    );
  }
  if (result.nextMutations.length) {
    method.append(
      el('div', { class: 'rule-double' }),
      el('p', { class: 'notation' }, 'Where the next run should look'),
      el('p', { class: 'prose' }, result.nextMutations.join(' · ')),
    );
  }

  const download = el('button', { class: 'btn btn--secondary', type: 'button' }, 'Download report (.md)');
  download.addEventListener('click', downloadReport);
  const share = el('button', { class: 'btn btn--secondary', type: 'button' }, 'Copy link to this run');
  share.addEventListener('click', () => {
    // Pin the seed into the shared URL, or the recipient gets a different run.
    const url = new URL(location.href);
    url.searchParams.set('seed', String(result.seedValue));
    history.replaceState(null, '', url);
    void navigator.clipboard.writeText(url.toString()).then(() => {
      share.textContent = 'Link copied';
      window.setTimeout(() => (share.textContent = 'Copy link to this run'), 2000);
    });
  });
  method.append(
    el(
      'div',
      { class: 'actions' },
      download,
      share,
      el(
        'p',
        { class: 'actions__cost' },
        `Run finished in ${(payload.elapsedMs / 1000).toFixed(1)}s · seed ${result.seedValue} — the copied link pins it, so this sheet replays exactly.`,
      ),
    ),
  );
  results.append(method);
}

function downloadReport(): void {
  if (!report) return;
  const blob = new Blob([report.markdown], { type: 'text/markdown;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const link = el('a', { href: url, download: 'brandy-report.md' });
  document.body.append(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

// ---------------------------------------------------------------------- boot

form.addEventListener('submit', (event) => {
  event.preventDefault();
  void run();
});
form.addEventListener('change', () => {
  updateCost();
  guardStrategies();
});
exampleButton.addEventListener('click', () => {
  const current = briefInput.value.trim();
  const next = EXAMPLES.find((e) => e !== current) ?? EXAMPLES[0]!;
  briefInput.value = next;
  briefInput.focus();
});

applyParams(new URLSearchParams(location.search));
updateCost();
guardStrategies();
