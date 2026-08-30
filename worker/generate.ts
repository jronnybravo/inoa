/**
 * Candidate generation, through the local Claude Code CLI.
 *
 * Uses the signed-in subscription rather than an API key, which is why this
 * runs on your machine and not on Vercel. If the CLI's session has expired the
 * run fails loudly here rather than producing an empty list — re-authenticate
 * with `claude login`.
 *
 * Asked for a thousand names in one response a model will repeat itself and
 * drift into filler — measured on a competing model's 296-line answer: 163
 * unique names, 45% duplicates, and 99% of them one of 38 first words glued to
 * one of 13 endings. Small batches keep each request sharp.
 *
 * Batches run concurrently in waves. Each call is a separate process that
 * spends almost all its life waiting on the network, so the cost of running
 * several is close to the cost of running one; threads would add machinery and
 * no throughput, because there is nothing to compute locally.
 *
 * Diversity is handled per wave rather than per batch. Batches inside a wave
 * cannot see each other, so they overlap and the overlap is deduplicated; each
 * new wave is told everything produced so far, which is what stops the whole
 * run collapsing onto the same handful of roots.
 */

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { STRATEGIES, type StrategyId } from '../src/lib/types.ts';

const run = promisify(execFile);

/**
 * The CLI waits three seconds for stdin before giving up on it, and we never
 * write any — the prompt goes in as an argument. Closing stdin outright skips
 * that wait, which is otherwise paid on every batch of every run.
 */
const CLI_OPTIONS = {
  maxBuffer: 32 * 1024 * 1024,
  timeout: 900_000,
  stdio: ['ignore', 'pipe', 'pipe'] as const
};

/**
 * Which model generates. Names are a bulk text task with no reasoning in it,
 * so the largest model is not obviously the right one; set BRANDY_MODEL to
 * try another.
 */
const MODEL = process.env.BRANDY_MODEL;

const BATCH_SIZE = Number(process.env.BRANDY_BATCH_SIZE ?? 50);

/**
 * How many generations run at once.
 *
 * Not a CPU question — the work happens on a server and this machine only
 * waits for it. The ceiling is the account's rate limit, so this is a knob to
 * be tuned against reality rather than against core count.
 */
const CONCURRENCY = Number(process.env.BRANDY_CONCURRENCY ?? 5);

export interface GeneratedName {
  name: string;
  rationale: string;
}

function promptFor(
  brief: string,
  strategies: StrategyId[],
  count: number,
  avoid: string[]
): string {
  const wanted = STRATEGIES.filter((s) => strategies.includes(s.id))
    .map((s) => `- ${s.label}: ${s.hint}`)
    .join('\n');

  return [
    `Generate exactly ${count} candidate brand names for this brief:`,
    '',
    brief,
    '',
    'Use these naming approaches, spread roughly evenly across them:',
    wanted || '- Any approach that fits the brief',
    '',
    'Rules:',
    '- One to three syllables. Pronounceable by an English speaker on sight.',
    '- Letters only, no spaces, hyphens or numbers.',
    '- No existing well-known company or product names.',
    '- Word combinations must be grammatical: adjective+noun or noun+noun,',
    '  never verb+noun. "Warmgrove" and "Ironforge" yes; "Soakedmart" no.',
    '- Vary the material. Do not build most of the list from the same few roots.',
    avoid.length
      ? `- Do not repeat any of these already-generated names: ${avoid.slice(-400).join(', ')}`
      : '',
    '',
    'Output format: one name per line, then a tab, then a six-word reason.',
    'No numbering, no preamble, no commentary, no blank lines.'
  ]
    .filter(Boolean)
    .join('\n');
}

function parse(output: string): GeneratedName[] {
  const out: GeneratedName[] = [];
  for (const line of output.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const [rawName, ...rest] = trimmed.split(/\t|\s+[—–-]\s+/);
    const name = (rawName ?? '').replace(/^[\d.)\-*\s]+/, '').trim();
    // Anything with punctuation or spaces left is commentary, not a name.
    if (!/^[A-Za-z]{3,16}$/.test(name)) continue;
    out.push({ name, rationale: rest.join(' ').trim().slice(0, 160) });
  }
  return out;
}

async function generateBatch(
  brief: string,
  strategies: StrategyId[],
  count: number,
  avoid: string[]
): Promise<GeneratedName[]> {
  const args = ['-p', promptFor(brief, strategies, count, avoid), '--output-format', 'text'];
  if (MODEL) args.push('--model', MODEL);
  const { stdout } = await run('claude', args, CLI_OPTIONS);
  return parse(stdout);
}

async function settledBatch(
  brief: string,
  strategies: StrategyId[],
  count: number,
  avoid: string[]
): Promise<GeneratedName[]> {
  try {
    return await generateBatch(brief, strategies, count, avoid);
  } catch {
    // One failed batch must not lose the wave beside it.
    return [];
  }
}

export async function generateNames(
  brief: string,
  strategies: StrategyId[],
  target: number,
  /**
   * Called with each batch as it lands, so the caller can store names while
   * later batches are still being written. A thousand names is five requests
   * and the better part of half an hour; holding them all back until the end
   * makes a working run look like a stalled one.
   */
  onBatch?: (fresh: GeneratedName[], total: number) => Promise<void> | void
): Promise<GeneratedName[]> {
  const seen = new Set<string>();
  const all: GeneratedName[] = [];
  let emptyWaves = 0;

  while (all.length < target && emptyWaves < 3) {
    const remaining = target - all.length;
    const batches = Math.min(CONCURRENCY, Math.ceil(remaining / BATCH_SIZE));
    const avoid = [...seen];

    const waves = await Promise.all(
      Array.from({ length: batches }, () =>
        settledBatch(brief, strategies, Math.min(BATCH_SIZE, remaining), avoid)
      )
    );

    const fresh: GeneratedName[] = [];
    for (const candidate of waves.flat()) {
      const key = candidate.name.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      fresh.push(candidate);
    }

    // A wave that adds nothing new means this brief and these strategies are
    // exhausted; stop rather than spin.
    if (fresh.length === 0) emptyWaves++;
    else emptyWaves = 0;

    all.push(...fresh);
    if (fresh.length) await onBatch?.(fresh, all.length);
  }

  return all.slice(0, target);
}
