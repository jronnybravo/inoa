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

/** One way of turning a prompt into text. */
export interface Generator {
    label: string;
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
 * Every source this project knows, in the order it prefers them.
 *
 * The CLI leads because it is the only one that cannot send you a bill.
 */
export const ALL_GENERATORS: Generator[] = [claudeCli, anthropicApi, openaiApi];

/**
 * The sources that could answer right now, in preference order.
 *
 * INOA_GENERATOR overrides the order and the membership both, so a machine
 * with the CLI installed can still be told to use the API instead. A name it
 * does not recognise is ignored rather than fatal, matching how the scraped
 * search engines read their own list.
 */
export function generators(): Generator[] {
    const wanted = (process.env.INOA_GENERATOR ?? '')
        .split(',')
        .map((label) => label.trim().toLowerCase())
        .filter(Boolean);

    const ordered =
        wanted.length > 0
            ? wanted
                  .map((label) => ALL_GENERATORS.find((g) => g.label === label))
                  .filter((g): g is Generator => g !== undefined)
            : ALL_GENERATORS;

    return ordered.filter((generator) => generator.available());
}

/** Whether anything at all could generate a name. */
export function hasGenerator(): boolean {
    return generators().length > 0;
}
