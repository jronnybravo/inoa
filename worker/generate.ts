/**
 * Candidate generation.
 *
 * The default source is the local Claude Code CLI, which spends the signed-in
 * subscription rather than an API key — the reason this runs on your machine
 * and not on Vercel. ANTHROPIC_API_KEY and OPENAI_API_KEY are alternatives for
 * a machine with no subscription to spend, and a fallback when the CLI cannot
 * answer; see generators.ts. If nothing is configured the run fails loudly
 * here rather than producing an empty list.
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

import { STRATEGIES, type StrategyId } from '../src/lib/types.ts';
import { aiAllowed, generators, rotation } from './generators.ts';
import { composeBatch, paletteFor, seedFor, type Palette } from './offline.ts';

const BATCH_SIZE = Number(process.env.INOA_BATCH_SIZE ?? 50);

/**
 * How many generations run at once.
 *
 * Not a CPU question — the work happens on a server and this machine only
 * waits for it. The ceiling is the account's rate limit, so this is a knob to
 * be tuned against reality rather than against core count.
 */
const CONCURRENCY = Number(process.env.INOA_CONCURRENCY ?? 5);

export interface GeneratedName {
    name: string;
    rationale: string;
    /** The approach this batch was asked for. */
    strategy: StrategyId;
}

function promptFor(
    brief: string,
    strategy: StrategyId,
    count: number,
    avoid: string[],
    languages: string[] = []
): string {
    const chosen = STRATEGIES.find((s) => s.id === strategy);

    /*
     * Naming the languages matters more than it sounds.
     *
     * Asked for 'other languages' with nothing narrowed, a model reaches for
     * Japanese and Latin almost every time — they are the two it has seen most
     * of in this context. A brief that wanted Nordic austerity got Kizuna
     * either way. Listed explicitly, the constraint holds.
     *
     * Only for the one approach it applies to: attaching it to a compound or
     * an invented batch would narrow material those approaches never draw on.
     */
    const drawnFrom =
        strategy === 'foreign' && languages.length > 0
            ? `- Draw only on these languages: ${languages.join(', ')}.`
            : '';

    return [
        `Generate exactly ${count} candidate brand names for this brief:`,
        '',
        brief,
        '',
        'Use this naming approach for every name:',
        chosen ? `- ${chosen.label}: ${chosen.hint}` : '- Any approach that fits the brief',
        drawnFrom,
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
        if (!trimmed) {
            continue;
        }
        const [rawName, ...rest] = trimmed.split(/\t|\s+[—–-]\s+/);
        const name = (rawName ?? '').replace(/^[\d.)\-*\s]+/, '').trim();
        // Anything with punctuation or spaces left is commentary, not a name.
        if (!/^[A-Za-z]{3,16}$/.test(name)) {
            continue;
        }

        out.push({
            name,
            rationale: rest.join(' ').trim().slice(0, 160),
            strategy
        });
    }
    return out;
}

/**
 * One batch, from the next source in the rotation.
 *
 * Round-robin across the leading tier, once more than one source is in it.
 * Spreading the batches spreads the rate limits, but the reason that matters
 * most is variety: a thousand names from one model is a thousand names with
 * one model's taste in them, and taste is most of what a naming run is buying.
 * Two models disagreeing is a wider shortlist.
 *
 * Failover then walks everything else, tier or no tier. A source that throws
 * is passed over rather than retried here — the caller already retries the
 * whole batch, and the next source is a better answer to a usage limit than a
 * second attempt at the one that imposed it. This is why a key is worth
 * setting on a machine that already has a subscription: the subscription runs
 * the run, and the key is there for the hour it stops being able to.
 */
async function generateBatch(
    brief: string,
    strategy: StrategyId,
    count: number,
    avoid: string[],
    turn: number,
    palette?: Palette,
    languages: string[] = []
): Promise<GeneratedName[]> {
    // Composed rather than generated: decided once for the whole run, in
    // generateNames, so no run is half one thing and half the other.
    if (palette) {
        return composeBatch(palette, strategy, count, avoid, seedFor(brief, turn), languages);
    }

    const prompt = promptFor(brief, strategy, count, avoid, languages);
    const sources = generators();
    if (sources.length === 0) {
        throw new Error(
            'No generator is configured. Sign in to the Claude CLI with `claude login`, ' +
                'set ANTHROPIC_API_KEY or OPENAI_API_KEY, or set INOA_AI=off to compose ' +
                'names without a model.'
        );
    }

    /*
     * Rotate within the leading tier, then fall back through everything else
     * in preference order. With one CLI and one key that is: the CLI for every
     * batch, and the key only when the CLI cannot answer.
     */
    const rotating = rotation(sources);
    const start = rotating.length > 0 ? turn % rotating.length : 0;
    const order = [
        ...rotating.slice(start),
        ...rotating.slice(0, start),
        ...sources.filter((source) => !rotating.includes(source))
    ];

    let failure: unknown;
    for (const source of order) {
        try {
            return parse(await source.complete(prompt), strategy);
        } catch (error) {
            failure = error;
        }
    }
    throw failure;
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
        `${e.stderr ?? ''} ${e.stdout ?? ''} ${e.message}`
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
interface BatchOutcome {
    id: number;
    names: GeneratedName[];
    failed: boolean;
}

async function settledBatch(
    brief: string,
    strategy: StrategyId,
    count: number,
    avoid: string[],
    turn: number,
    palette: Palette | undefined,
    languages: string[],
    onProblem?: (reason: string) => Promise<void> | void
): Promise<{ names: GeneratedName[]; failed: boolean }> {
    const ATTEMPTS = 3;
    for (let attempt = 1; attempt <= ATTEMPTS; attempt++) {
        try {
            return {
                names: await generateBatch(brief, strategy, count, avoid, turn, palette, languages),
                failed: false
            };
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
    /** Languages the foreign approach is narrowed to. Empty means any. */
    languages: string[] = [],
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

    /**
     * Which mechanism this run uses, settled before the first batch.
     *
     * A palette here means the whole run is composed rather than generated. It
     * is decided once and never revisited, so a table cannot end up half
     * written by a model and half by a rule with nothing recording which name
     * came from where. No model configured, or INOA_AI switched off, and there
     * is nothing to decide.
     */
    const sources = generators();
    const palette = sources.length === 0 ? await paletteFor(brief) : undefined;
    if (palette) {
        await onProblem?.(
            aiAllowed()
                ? 'No model configured — composing names from a thesaurus and word lists instead.'
                : 'INOA_AI is off — composing names from a thesaurus and word lists.'
        );
    } else {
        const sharing = rotation(sources);
        const spare = sources.filter((source) => !sharing.includes(source));
        if (sharing.length > 1 || spare.length > 0) {
            await onProblem?.(
                `Generating with ${sharing.map((s) => s.label).join(', ')}` +
                    (spare.length > 0
                        ? `, falling back to ${spare.map((s) => s.label).join(', ')}`
                        : '')
            );
        }
    }

    /** Consecutive batches that SUCCEEDED but contributed nothing new. */
    let barren = 0;
    const GIVE_UP_AFTER = 6;

    /** Consecutive batches that could not run at all, even after retries. */
    let failures = 0;
    const ABANDON_AFTER = 4;

    /*
     * Batches are small enough that every approach gets one.
     *
     * A batch asks for a single approach, so a target smaller than one batch
     * would spend the whole run on whichever approach happened to go first —
     * asking for thirty names across two approaches produced thirty
     * combinations and no invented words at all.
     */
    const batchSize = Math.min(BATCH_SIZE, Math.max(10, Math.ceil(target / strategies.length)));

    let nextId = 0;
    const pool = new Map<number, Promise<BatchOutcome>>();

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
        // The list is never empty: a run cannot be created without one.
        const strategy = strategies[turn++ % strategies.length] ?? 'compound';
        const want = Math.min(batchSize, Math.max(10, target - all.length));
        // The exclusion list is read HERE, at launch, so a batch starting now knows
        // everything every earlier batch has already returned.
        const avoid = [...seen];
        pool.set(
            id,
            settledBatch(brief, strategy, want, avoid, id, palette, languages, onProblem).then(
                (r) => ({
                    id,
                    ...r
                })
            )
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
            if (seen.has(key)) {
                continue;
            }
            seen.add(key);
            fresh.push(candidate);
        }
        barren = fresh.length === 0 ? barren + 1 : 0;

        /*
         * Never hand back more than was asked for.
         *
         * Batches run concurrently, so the last few land after the target is
         * met. Trimming the returned array was not enough — the caller stores
         * each batch as it arrives, so the extras were already saved and only
         * the count disagreed. The cap belongs here, before anything is
         * handed over.
         */
        const room = target - all.length;
        const kept = fresh.slice(0, Math.max(0, room));
        if (kept.length > 0) {
            all.push(...kept);
            await onBatch?.(kept, all.length);
        }
    };

    while (all.length < target && barren < GIVE_UP_AFTER && failures < ABANDON_AFTER) {
        // Only launch what is still needed: a batch started past the target
        // is generation nobody asked for and its output is thrown away.
        while (pool.size < CONCURRENCY && all.length + pool.size * batchSize < target) {
            spawn();
        }
        if (pool.size === 0) {
            break;
        }
        const { id, names, failed } = await Promise.race(pool.values());
        pool.delete(id);
        await absorb(names, failed);
    }

    // Whatever is still in flight has already been paid for; keep its output.
    for (const settled of await Promise.all(pool.values())) {
        await absorb(settled.names, settled.failed);
    }

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
            strategies[turn++ % strategies.length] ?? 'compound',
            shortfall,
            [...seen],
            nextId++,
            palette,
            languages,
            onProblem
        );
        await absorb(top.names, top.failed);
    }

    return all;
}
