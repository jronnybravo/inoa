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
    /** The approach this batch was asked for. */
    strategy: StrategyId;
}

function promptFor(brief: string, strategy: StrategyId, count: number, avoid: string[]): string {
    const chosen = STRATEGIES.find((s) => s.id === strategy);

    return [
        `Generate exactly ${count} candidate brand names for this brief:`,
        '',
        brief,
        '',
        'Use this naming approach for every name:',
        chosen ? `- ${chosen.label}: ${chosen.hint}` : '- Any approach that fits the brief',
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

function parse(output: string, strategy: StrategyId): GeneratedName[] {
    const out: GeneratedName[] = [];
    for (const line of output.split('\n')) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        const [rawName, ...rest] = trimmed.split(/\t|\s+[—–-]\s+/);
        const name = (rawName ?? '').replace(/^[\d.)\-*\s]+/, '').trim();
        // Anything with punctuation or spaces left is commentary, not a name.
        if (!/^[A-Za-z]{3,16}$/.test(name)) continue;
        out.push({ name, rationale: rest.join(' ').trim().slice(0, 160), strategy });
    }
    return out;
}

async function generateBatch(
    brief: string,
    strategy: StrategyId,
    count: number,
    avoid: string[]
): Promise<GeneratedName[]> {
    const args = ['-p', promptFor(brief, strategy, count, avoid), '--output-format', 'text'];
    if (MODEL) args.push('--model', MODEL);
    const { stdout } = await run('claude', args, CLI_OPTIONS);
    return parse(stdout, strategy);
}

/**
 * What actually went wrong, rather than the last thing printed.
 *
 * The CLI writes advisory notices to stderr — a warning about stdin among them
 * — so taking the final line reported the notice and hid the failure. Prefer a
 * line that reads like an error, and keep the exit code either way.
 */
/**
 * A usage limit is not a transient hiccup and should not be described as one.
 *
 * It presents as every batch failing at once, which is indistinguishable from
 * an outage unless you read the message. It also resets on a clock rather than
 * on a retry, so a short backoff cannot help — the run has to say so and stop.
 */
function isUsageLimit(error: unknown): boolean {
    const e = error as Error & { stderr?: string; stdout?: string };
    return /usage limit|rate limit|limit reached|too many requests|429|quota exceeded/i.test(
        `${e.stderr ?? ''} ${e.stdout ?? ''} ${e.message ?? ''}`
    );
}

function describeFailure(error: unknown): string {
    const e = error as Error & { stderr?: string; stdout?: string; code?: number };
    const lines = `${e.stderr ?? ''}\n${e.stdout ?? ''}`
        .split('\n')
        .map((l) => l.trim())
        .filter(Boolean)
        .filter((l) => !/^Warning: no stdin data received/.test(l));
    const meaningful = lines.find((l) => /error|limit|denied|refus|unauth|quota|overload/i.test(l));
    return `${meaningful ?? lines.at(-1) ?? e.message} (exit ${e.code ?? '?'})`;
}

/**
 * One batch, retried before it is given up on.
 *
 * Batch failures are usually transient — a rate limit, a hiccup under
 * concurrency. An earlier version returned an empty array on the first error
 * and counted it as exhaustion, so a passing squall stopped a whole run: ten
 * batches failed at once and generation produced nothing at all.
 *
 * Distinguishing the two cases matters. A batch that FAILED should be tried
 * again; a batch that succeeded and returned only duplicates means the brief is
 * exhausted, and only that should end the run.
 */
async function settledBatch(
    brief: string,
    strategy: StrategyId,
    count: number,
    avoid: string[],
    onProblem?: (reason: string) => Promise<void> | void
): Promise<{ names: GeneratedName[]; failed: boolean }> {
    const ATTEMPTS = 3;
    for (let attempt = 1; attempt <= ATTEMPTS; attempt++) {
        try {
            return { names: await generateBatch(brief, strategy, count, avoid), failed: false };
        } catch (error) {
            const reason = describeFailure(error);

            // Retrying a usage limit only spends the next window's allowance.
            if (isUsageLimit(error)) {
                await onProblem?.(
                    `Claude usage limit reached — generation cannot continue until it resets. ${reason}`
                );
                return { names: [], failed: true };
            }

            if (attempt === ATTEMPTS) {
                await onProblem?.(`batch failed after ${ATTEMPTS} attempts — ${reason}`);
                return { names: [], failed: true };
            }
            await onProblem?.(`batch failed, retrying in ${attempt * 15}s — ${reason}`);
            await new Promise((r) => setTimeout(r, attempt * 15_000));
        }
    }
    return { names: [], failed: true };
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

    /** Consecutive batches that SUCCEEDED but contributed nothing new. */
    let barren = 0;
    const GIVE_UP_AFTER = 6;

    /** Consecutive batches that could not run at all, even after retries. */
    let failures = 0;
    const ABANDON_AFTER = 4;

    let nextId = 0;
    const pool = new Map<number, Promise<{ id: number; names: GeneratedName[] }>>();

    /**
     * One approach per batch, taken in turn.
     *
     * Asking a single batch to spread itself across several approaches leaves no
     * way to tell afterwards which name came from which — and leaves the balance
     * to the model, which favours whichever approach the brief suggests most
     * readily. Round-robin gives an even spread and records the origin.
     */
    let turn = 0;

    const spawn = () => {
        const id = nextId++;
        const strategy = strategies[turn++ % strategies.length]!;
        const want = Math.min(BATCH_SIZE, Math.max(10, target - all.length));
        // The exclusion list is read HERE, at launch, so a batch starting now knows
        // everything every earlier batch has already returned.
        const avoid = [...seen];
        pool.set(
            id,
            settledBatch(brief, strategy, want, avoid, onProblem).then((r) => ({ id, ...r }))
        );
    };

    const absorb = async (names: GeneratedName[], failed: boolean) => {
        if (failed) {
            failures++;
            return;
        }
        failures = 0;

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

    while (all.length < target && barren < GIVE_UP_AFTER && failures < ABANDON_AFTER) {
        while (
            pool.size < CONCURRENCY &&
            all.length + pool.size * BATCH_SIZE < target + BATCH_SIZE
        ) {
            spawn();
        }
        if (pool.size === 0) break;
        const { id, names, failed } = await Promise.race(pool.values());
        pool.delete(id);
        await absorb(names, failed);
    }

    // Whatever is still in flight has already been paid for; keep its output.
    for (const settled of await Promise.all(pool.values()))
        await absorb(settled.names, settled.failed);

    /**
     * A final, sequential attempt at the shortfall.
     *
     * The pool stops as soon as the target is met, which usually leaves it a
     * little short once duplicates are removed. This last call knows every name
     * produced and asks only for what is missing.
     */
    if (all.length < target && barren < GIVE_UP_AFTER && failures < ABANDON_AFTER) {
        const shortfall = target - all.length;
        await onProblem?.(`Topping up the last ${shortfall}`);
        const top = await settledBatch(
            brief,
            strategies[turn++ % strategies.length]!,
            shortfall,
            [...seen],
            onProblem
        );
        await absorb(top.names, top.failed);
    }

    /*
     * Everything generated is returned, including any overshoot.
     *
     * Batches run concurrently, so the last wave lands after the target is met
     * and a run finishes slightly over. Trimming to the target discarded names
     * already paid for — and because batches are now one approach each, it
     * discarded them by approach: a 20-name target that produced 20 invented
     * and 20 compound kept only the invented ones. The target is a floor.
     */
    return all;
}
