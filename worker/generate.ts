/**
 * Candidate generation, through the local Claude Code CLI.
 *
 * Uses the signed-in subscription rather than an API key, which is why this
 * runs on your machine and not on Vercel. If the CLI's session has expired the
 * run fails loudly here rather than producing an empty list — re-authenticate
 * with `claude login`.
 *
 * Asked for a thousand names in one response a model will repeat itself and
 * drift into filler. Batching keeps each request small enough to stay sharp,
 * and every batch is told what has already been produced so the batches do not
 * converge on the same obvious material.
 */

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { STRATEGIES, type StrategyId } from '../src/lib/types.ts';

const run = promisify(execFile);

const BATCH_SIZE = 200;

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
  const { stdout } = await run(
    'claude',
    ['-p', promptFor(brief, strategies, count, avoid), '--output-format', 'text'],
    { maxBuffer: 8 * 1024 * 1024, timeout: 300_000 }
  );
  return parse(stdout);
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
  let emptyRounds = 0;

  while (all.length < target && emptyRounds < 3) {
    const want = Math.min(BATCH_SIZE, target - all.length);
    const batch = await generateBatch(brief, strategies, want, [...seen]);

    const fresh = batch.filter((c) => {
      const key = c.name.toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });

    // A batch that adds nothing new means the model has exhausted what this
    // brief and these strategies can reach; stop rather than spin.
    if (fresh.length === 0) emptyRounds++;
    else emptyRounds = 0;

    all.push(...fresh);
    await onBatch?.(fresh, all.length);
  }

  return all.slice(0, target);
}
