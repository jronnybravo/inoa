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
import {
    aiAllowed,
    exhaustedUntil,
    generators,
    isUsageLimit,
    noteUsageLimit,
    saidBy,
    usable
} from './generators.ts';
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

/**
 * How much of a request may be spent listing names not to repeat.
 *
 * Characters rather than a count of names, because characters are what costs.
 * Twelve thousand is roughly three thousand tokens — a small fraction of any
 * model's window, and enough for about fifteen hundred names, which is more
 * than most runs ever hold.
 */
const AVOID_BUDGET = 12_000;

/**
 * Which already-generated names to name, when there are more than fit.
 *
 * The cap used to be `slice(-400)`: the last four hundred, silently. On a run
 * being topped up that is exactly the wrong four hundred — the names it
 * already held are seeded into the set first and so were dropped first, and
 * those are precisely the ones the model has never been told about. It would
 * happily propose them again, and every one it proposed was a name paid for
 * and thrown away by the dedupe on arrival.
 *
 * An even stride keeps a share of every era instead: some of what the run
 * started with, some of what the last batch returned. The prompt says how many
 * of how many, so a partial list is never offered as a complete one.
 *
 * This is a thrift, not a correctness measure. `absorb` is what actually
 * guarantees no duplicate is ever kept; this only makes the model waste less.
 */
export function exclusions(
    avoid: readonly string[],
    budget: number = AVOID_BUDGET
): { names: string[]; complete: boolean } {
    const width = (list: readonly string[]): number =>
        list.reduce((sum, name) => sum + name.length + 2, -2);

    if (avoid.length === 0 || width(avoid) <= budget) {
        return { names: [...avoid], complete: true };
    }

    const average = width(avoid) / avoid.length;
    const fits = Math.max(1, Math.floor(budget / average));
    const stride = avoid.length / fits;
    const names: string[] = [];
    for (let i = 0; i < fits; i++) {
        const pick = avoid[Math.floor(i * stride)];
        if (pick !== undefined) {
            names.push(pick);
        }
    }
    return { names, complete: false };
}

export interface GeneratedName {
    name: string;
    rationale: string;
    /** The approach this batch was asked for. */
    strategy: StrategyId;
    /**
     * Which generator wrote it — 'claude-cli', 'openai', 'composed'.
     *
     * Recorded because a run is a mixture and nothing said so. When every name
     * in a fifty-name run came back the same approach, the table could not
     * distinguish 'the other source produced dull names' from 'the other source
     * produced nothing' — and it was the second. A column of labels answers that
     * at a glance.
     */
    source: string;
}

/** Exported for the tests: what a request actually says is the product. */
export function promptFor(
    brief: string,
    strategy: StrategyId,
    count: number,
    avoid: string[],
    languages: string[] = [],
    /** Names the person brought themselves, as evidence of what they like. */
    liked: string[] = []
): string {
    const chosen = STRATEGIES.find((s) => s.id === strategy);
    const listed = exclusions(avoid);

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
    const spoken = languages.length > 0 ? languages.join(', ') : '';

    /*
     * A blend is allowed, and is often the best name in the batch.
     *
     * This briefly forbade it — no Husay+Board, no Toko+Hub — after a run
     * narrowed to Austronesian returned HusayBoard. The instruction held, and
     * the names got worse: a shortlist of pure Tagalog words is beautiful and
     * almost entirely registered, while the blends were nearly all free. It is
     * also the shape behind Tokopedia, Gojek and PayMaya, so ruling it out was
     * ruling out the pattern with the best record in the market this serves.
     *
     * The language list still narrows where the borrowed half comes from,
     * which is what it was always for.
     */
    const drawnFrom =
        strategy === 'foreign' && spoken ? `- Draw only on these languages: ${spoken}.` : '';

    /*
     * The names the person already had, as a reading of their taste.
     *
     * A brief says what the business does; it says nothing about what its owner
     * likes the sound of. The box under it does — somebody who typed Husaybook
     * and Tandadeck has told you more about the register they want than three
     * sentences of brief ever will, and it was being used only as an exclusion
     * list.
     *
     * Taste, not material. They are in the avoid list as well, so the model is
     * being told to sound like these and not to hand them back — which is the
     * distinction worth spelling out, or it returns a set of near-spellings.
     *
     * Capped, because a person who brought two hundred names has already told
     * us everything this can use and the rest is prompt spent for nothing.
     */
    const TASTE = 24;
    const shown = liked.slice(0, TASTE);
    const taste = shown.length
        ? [
              '',
              `Names the person came up with themselves${
                  liked.length > shown.length ? ` (${shown.length} of ${liked.length})` : ''
              }:`,
              shown.join(', '),
              'Read what they like from these — the sound, the length, the register, the',
              'kind of word they reach for — and let it shape what you write. Do not repeat',
              'them, and do not hand back respellings or near-variants of them.',
              ''
          ].join('\n')
        : '';

    return [
        `Generate exactly ${count} candidate brand names for this brief:`,
        '',
        brief,
        taste,
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
        listed.names.length
            ? `- Do not repeat any of these${
                  listed.complete ? '' : ` ${listed.names.length} of the ${avoid.length}`
              } already-generated names: ${listed.names.join(', ')}`
            : '',
        '',
        'Output format: one name per line, then a tab, then a six-word reason.',
        'No numbering, no preamble, no commentary, no blank lines.'
    ]
        .filter(Boolean)
        .join('\n');
}

function parse(output: string, strategy: StrategyId, source: string): GeneratedName[] {
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
            strategy,
            source
        });
    }
    return out;
}

/**
 * Which source leads batch `turn`, out of `sources` that share the rotation.
 *
 * The batch number used to pick both, and two rotations sharing one counter are
 * not two rotations. With two approaches and two sources, `turn % 2` chose the
 * approach and `turn % 2` chose the source, so batch 0 was compound-on-claude
 * and batch 1 invented-on-codex, every time, for the life of the run. Each
 * approach was welded to one model.
 *
 * That is a quality bug on its own — half the shortlist carries one model's
 * taste and half the other's, when the point of rotating is that they mix — and
 * a much worse one when a source stops answering: the run does not lose a share
 * of its names, it loses a whole approach. A real fifty-name run asking for
 * compounds and invented words came back fifty compounds, because the source
 * holding 'invented' was hanging and nothing else was ever asked.
 *
 * Two things have to be true at once, and picking either alone gets it wrong:
 *
 *   - Every source should get its share from the first batch onwards, so a
 *     short run still has both models in it. Advancing the source once per
 *     cycle of the approaches breaks the weld, but sends the first two batches
 *     to the same model — a fifty-name run is two batches, and would never
 *     reach the second source at all.
 *   - The pairing has to move, or the weld simply comes back on a longer cycle.
 *
 * So: walk the sources in order, and shift the starting point by one every time
 * the list is exhausted. Two approaches and two sources give
 * compound/claude, invented/codex, compound/codex, invented/claude — an even
 * split from the first batch, and all four pairings inside the first four
 * batches, which is a run of two hundred names.
 *
 * The shift is what does the work. Without it the pairing is (turn mod S, turn
 * mod R), which covers everything only when the two counts share no factor, and
 * repeats forever when they do — and 'two approaches, two CLIs' is the most
 * ordinary configuration this has.
 *
 * How many approaches are in play is deliberately not an input. That number is
 * what the approach rotates on, and reading it here is how the two rotations
 * became one in the first place.
 *
 * Exported because it is the fix, and a fix nobody can see is one that comes
 * back.
 */
export function sourceFor(turn: number, sources: number): number {
    if (sources < 1) {
        return 0;
    }
    return (turn + Math.floor(turn / sources)) % sources;
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
 *
 * A source that answers with no usable names is failed over too. It reads as
 * success — no exception, an array, just an empty one — and was counted as one:
 * the batch was recorded as barren, which is the signal meaning 'the brief is
 * exhausted' and ends a run early. Nothing else was tried and nothing was said.
 */
/**
 * When a source comes back, said in as much as the reader needs.
 *
 * A time alone for today, a date as well for anything further out. 'set aside
 * until 5:23:00 PM' was how a reset a MONTH away was reported, which reads as
 * 'back after lunch'.
 */
function whenBack(at: number): string {
    const when = new Date(at);
    const sameDay = when.toDateString() === new Date().toDateString();
    return sameDay ? when.toLocaleTimeString() : when.toLocaleString();
}

async function generateBatch(
    brief: string,
    strategy: StrategyId,
    count: number,
    avoid: string[],
    turn: number,
    palette?: Palette,
    languages: string[] = [],
    liked: string[] = [],
    onProblem?: (reason: string) => Promise<void> | void
): Promise<GeneratedName[]> {
    // Composed rather than generated: decided once for the whole run, in
    // generateNames, so no run is half one thing and half the other.
    if (palette) {
        return composeBatch(palette, strategy, count, avoid, seedFor(brief, turn), languages).map(
            (name) => ({ ...name, source: 'composed' })
        );
    }

    const prompt = promptFor(brief, strategy, count, avoid, languages, liked);
    if (generators().length === 0) {
        throw new Error(
            'No generator is configured. Switch on CLAUDE_CLI or CODEX_CLI with that CLI ' +
                'signed in, set ANTHROPIC_API_KEY or OPENAI_API_KEY, or set INOA_AI=false ' +
                'to compose names without a model.'
        );
    }

    /*
     * What can answer now, which is not what is configured.
     *
     * A source out of quota is set aside until it resets rather than asked
     * again: a usage limit comes back on a clock, and a retry only spends the
     * next window's allowance. The rest of the rotation carries on without it.
     */
    const sources = usable();
    if (sources.length === 0) {
        const until = exhaustedUntil();
        throw new Error(
            'Every generator has reached its usage limit' +
                (until ? ` — the first returns at ${whenBack(until)}` : '')
        );
    }

    const start = sourceFor(turn, sources.length);
    const order = [...sources.slice(start), ...sources.slice(0, start)];

    let failure: unknown;
    for (const source of order) {
        try {
            const names = parse(await source.complete(prompt), strategy, source.label);
            if (names.length === 0) {
                throw new Error(`${source.label} returned nothing this batch could use`);
            }
            return names;
        } catch (error) {
            failure = error;
            /*
             * A quota is not a fault, and must not cost the next batch.
             *
             * Setting the source aside here is what turns 'the run stops' into
             * 'the other one carries it'. Generation used to end the moment any
             * source reported a limit, with a second one sitting idle beside it.
             */
            if (isUsageLimit(error)) {
                const until = noteUsageLimit(source.label, saidBy(error));
                await onProblem?.(
                    `${source.label} has reached its usage limit — set aside until ` +
                        whenBack(until)
                );
                continue;
            }
            await onProblem?.(
                `${source.label} could not do this batch — ${describeFailure(error)}`
            );
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
    liked: string[],
    onProblem?: (reason: string) => Promise<void> | void
): Promise<{ names: GeneratedName[]; failed: boolean }> {
    const ATTEMPTS = 3;
    for (let attempt = 1; attempt <= ATTEMPTS; attempt++) {
        try {
            return {
                names: await generateBatch(
                    brief,
                    strategy,
                    count,
                    avoid,
                    turn,
                    palette,
                    languages,
                    liked,
                    onProblem
                ),
                failed: false
            };
        } catch (error) {
            const reason = describeFailure(error);

            /*
             * Retrying a usage limit only spends the next window's allowance.
             *
             * generateBatch has already set the offending source aside and
             * tried the rest, so reaching here means nothing configured can
             * answer — not that one source is busy.
             */
            if (isUsageLimit(error)) {
                await onProblem?.(
                    `Generation cannot continue until a usage limit resets. ${reason}`
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
    onProblem?: (reason: string) => Promise<void> | void,
    /**
     * Names this run already holds, which the new ones must not repeat.
     *
     * `target` counts what is produced here, not what the run ends up with, so
     * a run topping itself up asks for the shortfall and hands over what it
     * already has. Seeded into the same set the batches build, which is what
     * every request's exclusion list is read from — so a name found an hour
     * ago is avoided exactly as firmly as one found a second ago.
     */
    already: string[] = [],
    /**
     * Names the person brought themselves, read for taste rather than material.
     *
     * A subset of `already` — they are in the exclusion list too — and passed
     * separately because the two say different things to a request: one is
     * 'never these', the other is 'more like these'.
     */
    liked: string[] = []
): Promise<GeneratedName[]> {
    const seen = new Set(already.map((name) => name.toLowerCase()));
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
        const sharing = sources;
        if (sharing.length > 1) {
            await onProblem?.(`Generating with ${sharing.map((s) => s.label).join(', ')}`);
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
    /** Said once, not per batch — every request after the first says the same. */
    let saidSampled = false;

    const spawn = () => {
        const id = nextId++;
        // The list is never empty: a run cannot be created without one.
        const strategy = strategies[turn++ % strategies.length] ?? 'compound';
        const want = Math.min(batchSize, Math.max(10, target - all.length));
        // The exclusion list is read HERE, at launch, so a batch starting now knows
        // everything every earlier batch has already returned.
        const avoid = [...seen];

        /*
         * A list too long to send in full is worth saying out loud.
         *
         * It used to be trimmed to the last four hundred with nothing said, so
         * a long run quietly started proposing names it already had — visible
         * only as batches that returned less than they cost. Duplicates are
         * still dropped on arrival either way; this is the line that explains
         * why there are more of them.
         */
        if (!saidSampled) {
            const listed = exclusions(avoid);
            if (!listed.complete) {
                saidSampled = true;
                void onProblem?.(
                    `Too many names to list in full — each request now names ${listed.names.length} ` +
                        `of ${avoid.length} as ones to avoid. Repeats are still dropped when they arrive.`
                );
            }
        }
        pool.set(
            id,
            settledBatch(
                brief,
                strategy,
                want,
                avoid,
                id,
                palette,
                languages,
                liked,
                onProblem
            ).then((r) => ({ id, ...r }))
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
            liked,
            onProblem
        );
        await absorb(top.names, top.failed);
    }

    return all;
}
