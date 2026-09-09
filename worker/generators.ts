/**
 * Where names come from, and what to do when one source cannot answer.
 *
 * Generation started as a single call to the signed-in Claude CLI, which is
 * still the best default: it spends a subscription you already pay for rather
 * than metering tokens. But it is also the only thing standing between a run
 * and nothing at all. A usage limit ends generation dead, and anyone without a
 * Claude subscription cannot run this project.
 *
 * So a source is now one of several, in the same shape the web check already
 * uses for its search providers: whichever are configured are tried in turn,
 * and the first that answers wins. A key set here is an alternative, never a
 * requirement — with the CLI on PATH and no keys at all, nothing changes.
 *
 * The SDKs are imported lazily for the same reason Playwright is in the web
 * check: a worker that never reaches the OpenAI path should not pay to load
 * it, and neither should anything else that imports this module.
 */

import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { promisify } from 'node:util';

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
 * Where a source sits in the order of preference.
 *
 * 'api' is a key written into .env, which is an explicit instruction to spend
 * money and is treated as one. 'cli' is a subscription already signed in on
 * this machine: free at the point of use, but slower — a process per batch —
 * and singular, where keys can be several.
 *
 * The tier decides what a run rotates between, not what it is allowed to
 * reach. Batches are shared out among the leading tier only — rotating a
 * healthy subscription against a metered key would spend money for no reason —
 * while a failure inside a batch walks the whole list, so a usage limit on the
 * subscription still reaches the key rather than ending the run.
 */
export type GeneratorTier = 'api' | 'cli';

/** One way of turning a prompt into text. */
export interface Generator {
    label: string;
    tier: GeneratorTier;
    /**
     * Configured and usable right now.
     *
     * Read at call time rather than captured at import, so a key exported
     * after this module loads is still seen — the same reason the search
     * providers read theirs through a function.
     */
    available: () => boolean;
    /** The model's raw answer. Parsing it into names is somebody else's job. */
    complete: (prompt: string) => Promise<string>;
}

/**
 * Is this binary on PATH?
 *
 * Cheaper than asking the CLI its version, which costs a process spawn per
 * batch, and it answers the only question that matters: would running it find
 * anything. A CLI that exists but is signed out fails on its first call and
 * the next source takes over, which is the behaviour we want anyway.
 */
function onPath(binary: string): boolean {
    return (process.env.PATH ?? '')
        .split(':')
        .some((dir) => dir !== '' && existsSync(join(dir, binary)));
}

/**
 * The signed-in Claude CLI. No key, no per-token billing, and the reason this
 * worker runs on your machine rather than on Vercel.
 */
const claudeCli: Generator = {
    label: 'claude-cli',
    tier: 'cli',
    available: () => onPath('claude'),
    complete: async (prompt) => {
        const args = ['-p', prompt, '--output-format', 'text'];
        const model = process.env.INOA_MODEL;
        if (model) {
            args.push('--model', model);
        }
        const { stdout } = await run('claude', args, CLI_OPTIONS);
        return stdout;
    }
};

/**
 * The Anthropic API, for a deployment with no subscription to spend.
 *
 * Thinking is left on and the effort turned down rather than disabled.
 * Naming is a bulk text task that wants none of the reasoning, but disabling
 * thinking outright on this model family can leak internal tags into the
 * visible answer, and this parser reads every line it is given.
 */
const anthropicApi: Generator = {
    label: 'anthropic',
    tier: 'api',
    available: () => Boolean(process.env.ANTHROPIC_API_KEY),
    complete: async (prompt) => {
        const { default: Anthropic } = await import('@anthropic-ai/sdk');
        const client = new Anthropic();
        const response = await client.messages.create({
            model: process.env.INOA_ANTHROPIC_MODEL ?? 'claude-opus-5',
            max_tokens: 16000,
            output_config: { effort: 'low' },
            messages: [{ role: 'user', content: prompt }]
        });
        return response.content
            .filter((block) => block.type === 'text')
            .map((block) => block.text)
            .join('\n');
    }
};

/**
 * OpenAI, through the Responses API rather than chat completions.
 *
 * gpt-5.6 is an alias rather than a pinned snapshot, so it keeps working as
 * the line moves. Set INOA_OPENAI_MODEL to pin one — gpt-5.6-luna is the
 * cheap end of the family and ample for this, gpt-6-astra the capable end.
 */
const openaiApi: Generator = {
    label: 'openai',
    tier: 'api',
    available: () => Boolean(process.env.OPENAI_API_KEY),
    complete: async (prompt) => {
        const { default: OpenAI } = await import('openai');
        const client = new OpenAI();
        const response = await client.responses.create({
            model: process.env.INOA_OPENAI_MODEL ?? 'gpt-5.6',
            input: prompt
        });
        return response.output_text;
    }
};

/**
 * The OpenAI CLI, driven non-interactively.
 *
 * `codex exec` is the one-shot form; without it the binary opens a session and
 * waits for a terminal that is not there. Like the Claude CLI it spends a
 * subscription rather than metering tokens, which is why both sit in the same
 * tier.
 */
const codexCli: Generator = {
    label: 'codex-cli',
    tier: 'cli',
    available: () => onPath('codex'),
    complete: async (prompt) => {
        const { stdout } = await run('codex', ['exec', prompt], CLI_OPTIONS);
        return stdout;
    }
};

/**
 * Every source this project knows, in the order it prefers them.
 *
 * The CLIs lead because they are the only ones that cannot send you a bill,
 * and the speed argument for putting the keys first does not survive
 * measurement: a batch of fifty names takes about 108 seconds through the CLI,
 * of which the process spawn and auth check are 5.5. Five per cent, against a
 * cost difference of everything versus nothing.
 *
 * Quality is not the tiebreaker either — both reach the same model family for
 * what is a single-turn text prompt. The CLI wraps it in an agent harness with
 * its own system prompt, which is a difference in kind rather than one I can
 * show to be a difference in quality.
 */
export const ALL_GENERATORS: Generator[] = [claudeCli, codexCli, anthropicApi, openaiApi];

/**
 * Has AI generation been switched off outright?
 *
 * INOA_AI=off sends every run down the deterministic path even on a machine
 * with keys and CLIs to spare — for a run that must not cost anything, or must
 * not leave the building.
 */
export function aiAllowed(): boolean {
    const setting = (process.env.INOA_AI ?? '').trim().toLowerCase();
    return !['off', 'no', 'false', '0'].includes(setting);
}

/**
 * The sources that could answer right now, in preference order.
 *
 * INOA_GENERATOR overrides the order and the membership both, so a machine
 * with the CLI installed can still be told to use the API instead. A name it
 * does not recognise is ignored rather than fatal, matching how the scraped
 * search engines read their own list.
 */
export function generators(): Generator[] {
    if (!aiAllowed()) {
        return [];
    }

    const wanted = (process.env.INOA_GENERATOR ?? '')
        .split(',')
        .map((label) => label.trim().toLowerCase())
        .filter(Boolean);

    /*
     * An explicit list is taken at its word, order and all. Naming a CLI and a
     * key together is a deliberate request to rotate between them, and
     * second-guessing it would leave no way to ask for that at all.
     */
    if (wanted.length > 0) {
        return wanted
            .map((label) => ALL_GENERATORS.find((g) => g.label === label))
            .filter((g): g is Generator => g !== undefined)
            .filter((generator) => generator.available());
    }

    return ALL_GENERATORS.filter((generator) => generator.available());
}

/**
 * The sources a healthy run shares its batches between.
 *
 * The leading tier only, which is the whole point: rotation is for spreading
 * load and widening the shortlist between equals, and a subscription and a
 * metered key are not equals. Rotating across both would quietly bill a
 * machine whose CLI was working perfectly well.
 *
 * Everything below this stays in `generators()` as failover — which is what a
 * key was added for in the first place. A subscription that hits its usage
 * limit used to end generation dead; it now moves to the next source, and an
 * earlier version of this tiering had silently taken that away by refusing to
 * cross from one tier to the other at all.
 */
export function rotation(sources: Generator[] = generators()): Generator[] {
    const leading = sources[0]?.tier;
    return leading ? sources.filter((source) => source.tier === leading) : [];
}

/**
 * Whether a model will be asked for the names.
 *
 * Not 'whether names can be produced' any more, which is what this used to
 * mean: false now sends the run to the deterministic composer rather than
 * stopping it. The distinction matters to anything reporting what a run is
 * about to do, and nothing else should be branching on it.
 */
export function hasGenerator(): boolean {
    return generators().length > 0;
}
