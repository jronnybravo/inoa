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
 * Batches run concurrently. Each call is a separate process that spends almost
 * all its life waiting on the network, so the cost of running several is close
 * to the cost of running one; threads would add machinery and no throughput,
 * because there is nothing to compute locally.
 *
 * A fixed pool rather than waves. A wave can only build its exclusion list from
 * the wave before it, so five batches launched together all repeat each other's
 * output. Here a finished batch is folded into the set immediately and its
 * replacement launches knowing everything produced so far — so only the batches
 * genuinely in flight at the same moment are blind to each other.
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

/**
 * One batch, whose failure is reported rather than swallowed.
 *
 * An earlier version returned an empty array on error. Three batches failed in
 * a row, generation stopped at 234 names of 1000, and nothing anywhere said
 * why — the same silence this whole tool exists to eliminate.
 */
async function settledBatch(
  brief: string,
  strategies: StrategyId[],
  count: number,
  avoid: string[],
  onProblem?: (reason: string) => Promise<void> | void
): Promise<GeneratedName[]> {
  try {
    return await generateBatch(brief, strategies, count, avoid);
  } catch (error) {
    const raw = (error as Error & { stderr?: string }).stderr ?? (error as Error).message;
    await onProblem?.(raw.split('\n').filter(Boolean).slice(-1)[0] ?? 'unknown error');
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
  onBatch?: (fresh: GeneratedName[], total: number) => Promise<void> | void,
  onProblem?: (reason: string) => Promise<void> | void
): Promise<GeneratedName[]> {
  const seen = new Set<string>();
  const all: GeneratedName[] = [];

  /** Consecutive finished batches that contributed nothing new. */
  let barren = 0;
  const GIVE_UP_AFTER = 6;

  let nextId = 0;
  const pool = new Map<number, Promise<{ id: number; names: GeneratedName[] }>>();

  const spawn = () => {
    const id = nextId++;
    const want = Math.min(BATCH_SIZE, Math.max(10, target - all.length));
    // The exclusion list is read HERE, at launch, so a batch starting now knows
    // everything every earlier batch has already returned.
    const avoid = [...seen];
    pool.set(
      id,
      settledBatch(brief, strategies, want, avoid, onProblem).then((names) => ({ id, names }))
    );
  };

  const absorb = async (names: GeneratedName[]) => {
    const fresh: GeneratedName[] = [];
    for (const candidate of names) {
      const key = candidate.name.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      fresh.push(candidate);
    }
    barren = fresh.length === 0 ? barren + 1 : 0;
    if (fresh.length) {
      all.push(...fresh);
      await onBatch?.(fresh, all.length);
    }
  };

  while (all.length < target && barren < GIVE_UP_AFTER) {
    while (pool.size < CONCURRENCY && all.length + pool.size * BATCH_SIZE < target + BATCH_SIZE) {
      spawn();
    }
    if (pool.size === 0) break;
    const { id, names } = await Promise.race(pool.values());
    pool.delete(id);
    await absorb(names);
  }

  // Whatever is still in flight has already been paid for; keep its output.
  for (const settled of await Promise.all(pool.values())) await absorb(settled.names);

  /**
   * A final, sequential attempt at the shortfall.
   *
   * The pool stops as soon as the target is met, which usually leaves it a
   * little short once duplicates are removed. This last call knows every name
   * produced and asks only for what is missing.
   */
  if (all.length < target && barren < GIVE_UP_AFTER) {
    const shortfall = target - all.length;
    await onProblem?.(`Topping up the last ${shortfall}`);
    await absorb(await settledBatch(brief, strategies, shortfall, [...seen], onProblem));
  }

  return all.slice(0, target);
}
