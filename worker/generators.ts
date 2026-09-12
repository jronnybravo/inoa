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

import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { flag } from '../src/lib/server/config.ts';

/** A CLI that exited badly, in the shape describeFailure() reads. */
interface CommandFailure extends Error {
    stdout: string;
    stderr: string;
    code: number | null;
}

function failed(
    message: string,
    stdout: string,
    stderr: string,
    code: number | null
): CommandFailure {
    return Object.assign(new Error(message), { stdout, stderr, code });
}

/**
 * Run a CLI with its stdin closed, and treat anything but a clean exit as an error.
 *
 * spawn rather than execFile, for the stdin. Neither CLI is given input — the
 * prompt goes in as an argument — but both look for some anyway, and what they
 * do when they find an open pipe differs: the Claude CLI waits three seconds
 * and moves on, while `codex exec` blocks on it indefinitely.
 *
 * This used to pass `stdio: ['ignore', ...]` to execFile, which does nothing:
 * execFile builds its own pipes to capture output and never forwards the
 * option. So codex sat holding an open stdin until the timeout killed it —
 * and it exits 0 on the signal, so the batch came back empty and SUCCESSFUL.
 * Twelve minutes of a real run went that way, and every name the run was
 * supposed to get from that source was silently lost.
 *
 * An empty stdout is a failure here too. A CLI that answers nothing has not
 * answered, whatever it says on the way out, and calling it a success is what
 * let the failover below be skipped.
 */
async function run(
    file: string,
    args: string[],
    options: { timeout: number; maxBuffer: number }
): Promise<{ stdout: string }> {
    return new Promise((resolve, reject) => {
        const child = spawn(file, args, { stdio: ['ignore', 'pipe', 'pipe'] });
        let stdout = '';
        let stderr = '';
        let overflowed = false;
        let timedOut = false;

        const collect = (into: 'out' | 'err') => (chunk: Buffer) => {
            const text = chunk.toString();
            if (into === 'out') {
                stdout += text;
            } else {
                stderr += text;
            }
            if (stdout.length + stderr.length > options.maxBuffer && !overflowed) {
                overflowed = true;
                child.kill('SIGKILL');
            }
        };
        child.stdout.on('data', collect('out'));
        child.stderr.on('data', collect('err'));

        const timer = setTimeout(() => {
            timedOut = true;
            child.kill('SIGKILL');
        }, options.timeout);

        child.on('error', (error) => {
            clearTimeout(timer);
            reject(failed(error.message, stdout, stderr, null));
        });

        child.on('close', (code) => {
            clearTimeout(timer);
            if (timedOut) {
                reject(
                    failed(
                        `${file} produced no answer within ${Math.round(options.timeout / 1000)}s`,
                        stdout,
                        stderr,
                        code
                    )
                );
            } else if (overflowed) {
                reject(failed(`${file} wrote more output than we will read`, stdout, stderr, code));
            } else if (code !== 0) {
                reject(failed(`${file} exited ${code}`, stdout, stderr, code));
            } else if (stdout.trim() === '') {
                reject(failed(`${file} answered with nothing at all`, stdout, stderr, code));
            } else {
                resolve({ stdout });
            }
        });
    });
}

const CLI_OPTIONS = {
    maxBuffer: 32 * 1024 * 1024,
    /*
     * Three minutes, not fifteen.
     *
     * A batch of twenty-five names takes seconds. Fifteen minutes was not a
     * budget, it was the length of time a wedged CLI could hold a run hostage
     * before anything noticed — and it did: one batch sat for eight minutes
     * with the run stalled behind it and nothing on screen saying why.
     *
     * Generous against the work and short against a hang, which is what a
     * timeout is for. INOA_CLI_TIMEOUT_MS raises it for a slow machine.
     */
    timeout: Number(process.env.INOA_CLI_TIMEOUT_MS ?? 180_000)
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
 * A CLI this deployment has asked for, by name.
 *
 * CLAUDE_CLI and CODEX_CLI take true or false like every other switch in this
 * project's .env, and neither is assumed. Unset means no: a subscription is
 * somebody's account and their money's worth of quota, and spending it because
 * a binary happened to be on PATH is not a decision this should make on their
 * behalf. Say which one you want and it is used; say nothing and the keys are
 * reached instead, or names are composed here.
 */
function switchedOn(name: string): boolean {
    return flag(name) ?? false;
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
    available: () => switchedOn('CLAUDE_CLI') && onPath('claude'),
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
 * The OpenAI CLI, driven non-interactively — and kept away from the repository.
 *
 * `codex exec` is the one-shot form; without it the binary opens a session and
 * waits for a terminal that is not there. Like the Claude CLI it spends a
 * subscription rather than metering tokens, which is why both sit in the same
 * tier.
 *
 * The flags are the difference between an answer and an afternoon. `claude -p`
 * is print mode: it answers the question and exits. `codex exec` has no such
 * mode — it is a coding agent, and run from a git repository it treats that
 * repository as the job. Asked for twenty-five brand names it went off reading
 * the codebase; measured here, the same prompt took over eight minutes that way
 * and sixteen seconds with these.
 *
 * -C into a scratch directory is the one that matters: with no workspace there
 * is nothing to explore. read-only and --ignore-user-config remove the other
 * two ways in — running commands, and instructions from somebody's own config.
 */
const codexCli: Generator = {
    label: 'codex-cli',
    tier: 'cli',
    available: () => switchedOn('CODEX_CLI') && onPath('codex'),
    complete: async (prompt) => {
        const args = [
            'exec',
            '--skip-git-repo-check',
            '--ephemeral',
            '--ignore-user-config',
            '--sandbox',
            'read-only',
            '--cd',
            tmpdir(),
            prompt
        ];
        const { stdout } = await run('codex', args, CLI_OPTIONS);
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
    return flag('INOA_AI') ?? true;
}

/**
 * The sources this deployment will actually use.
 *
 * A CLI beats a key outright, and not by a hair: a signed-in CLI spends a
 * subscription already paid for, and a key spends money per batch. So if any
 * CLI is switched on and present, the run rotates between the CLIs and the
 * keys are not touched at all — not as failover, not as overflow. A machine
 * that wants its keys used says so by switching the CLIs off.
 *
 * With no CLI, the keys rotate between themselves on the same terms. With
 * neither, this is empty and names are composed here instead.
 */
export function generators(): Generator[] {
    if (!aiAllowed()) {
        return [];
    }
    const ready = ALL_GENERATORS.filter((generator) => generator.available());
    const clis = ready.filter((generator) => generator.tier === 'cli');
    return clis.length > 0 ? clis : ready.filter((generator) => generator.tier === 'api');
}

/**
 * A source put down after it reported a usage limit.
 *
 * Two times, not one, and the difference is the whole point. `until` is when
 * the service said it would be back, which is what a person wants told.
 * `retryAt` is when we will ask it anyway — because the service's answer can
 * stop being true the moment somebody upgrades a plan, and a breaker that never
 * closes again is a fuse.
 */
interface Setback {
    /** When the service said it returns. Reported, never trusted absolutely. */
    until: number;
    /** When to try regardless, in case it came back early. */
    retryAt: number;
}

/**
 * Sources set aside, by label.
 *
 * Per process, which is the right lifetime: a worker is long-lived and will
 * meet the same limit again within minutes, while a restart is a fair moment to
 * find out whether anything has changed.
 */
const exhausted = new Map<string, Setback>();

/**
 * The longest a source is ever set aside.
 *
 * A sanity bound on a reading, not a policy about windows. It started at twelve
 * hours, on the assumption that no service shelves you for longer — and then
 * the Codex CLI said 'try again at Oct 10th, 2026' on the twelfth of September,
 * which is a real answer about a real monthly quota that twelve hours would
 * have thrown away in favour of retrying hourly for a month.
 *
 * Thirty days honours that and still refuses nonsense. The map is per process,
 * so restarting the worker is the escape hatch if a service comes back early.
 */
const MAX_SETBACK = 30 * 24 * 60 * 60 * 1000;

/**
 * How often a source that has run out is tried again anyway.
 *
 * The service's own reset time is information, not a contract: upgrade a plan
 * mid-run and Codex's 'try again at Oct 10th' becomes wrong immediately, and
 * nothing tells us. So it is asked again on this cadence whatever it said, and
 * put back down if it says the same thing.
 *
 * Fifteen minutes because the probe is nearly free — a CLI that is out answers
 * in about a second, and the batch moves straight on to the next source — and
 * because a person who has just paid for more quota should not have to restart
 * a worker to spend it.
 *
 * It also stands in for the reset time where the message named none. A guess
 * about a window nobody stated is worth no more than a retry.
 */
const RETRY_EVERY = Number(process.env.INOA_LIMIT_RETRY_MIN ?? 15) * 60 * 1000;

/**
 * When a service says its quota comes back, if it says at all.
 *
 * Every one of these has been seen in the wild from one CLI or the other, and
 * none of them is a format either service promises to keep — so each is tried,
 * nothing is required, and a message that matches none of them falls back to
 * the cooldown rather than to a guess dressed up as a reading.
 *
 * Exported for the tests, which is the only way to pin behaviour that depends
 * on somebody else's error text.
 */
export function resetAt(said: string, now: number = Date.now()): number | undefined {
    const capped = (at: number): number | undefined =>
        at > now && at - now <= MAX_SETBACK ? at : undefined;

    // 'try again in 4 hours 12 minutes', 'retry in 30 minutes'
    const relative =
        /(?:try again|retry|available again|back) in\s+(?:(\d+)\s*h(?:ours?)?)?\s*(?:(\d+)\s*m(?:in(?:utes?)?)?)?/i.exec(
            said
        );
    if (relative && (relative[1] || relative[2])) {
        const ms = (Number(relative[1] ?? 0) * 60 + Number(relative[2] ?? 0)) * 60 * 1000;
        return capped(now + ms);
    }

    /*
     * A written-out date and time, which is what the Codex CLI actually says:
     * 'try again at Oct 10th, 2026 9:31 PM'. The ordinal suffix has to come off
     * first — Date.parse handles 'Oct 10, 2026 9:31 PM' and not 'Oct 10th'.
     */
    const written =
        /(?:try again|retry|available again|back|reset[a-z]*)\s+(?:at|on)\s+([A-Z][a-z]{2,8}\.?\s+\d{1,2}(?:st|nd|rd|th)?,?\s+\d{4}(?:,?\s+\d{1,2}:\d{2}(?::\d{2})?\s*(?:am|pm)?)?)/i.exec(
            said
        );
    if (written?.[1]) {
        const at = Date.parse(written[1].replace(/(\d+)(?:st|nd|rd|th)/i, '$1'));
        if (!Number.isNaN(at)) {
            return capped(at);
        }
    }

    // An explicit instant: ISO 8601, or the epoch seconds some CLIs print.
    const iso =
        /reset[^.]*?(\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}(?::\d{2})?(?:Z|[+-]\d{2}:?\d{2})?)/i.exec(
            said
        );
    if (iso?.[1]) {
        const at = Date.parse(iso[1].replace(' ', 'T'));
        if (!Number.isNaN(at)) {
            return capped(at);
        }
    }
    const epoch = /reset[^.]*?\b(1[0-9]{9})\b/i.exec(said);
    if (epoch?.[1]) {
        return capped(Number(epoch[1]) * 1000);
    }

    // 'your limit will reset at 3pm' / 'resets at 15:00'
    const clock = /reset[^.]*?\bat\s+(\d{1,2})(?::(\d{2}))?\s*(am|pm)?/i.exec(said);
    if (clock?.[1]) {
        let hour = Number(clock[1]);
        const meridiem = clock[3]?.toLowerCase();
        if (meridiem === 'pm' && hour < 12) {
            hour += 12;
        }
        if (meridiem === 'am' && hour === 12) {
            hour = 0;
        }
        const at = new Date(now);
        at.setHours(hour, Number(clock[2] ?? 0), 0, 0);
        // Already past today means they mean tomorrow.
        return capped(at.getTime() > now ? at.getTime() : at.getTime() + 24 * 60 * 60 * 1000);
    }

    return undefined;
}

/**
 * Set a source aside because it is out of quota.
 *
 * A usage limit resets on a clock rather than on a retry, so asking again
 * immediately spends nothing but time. Setting the one source aside — rather
 * than ending the run, which is what used to happen — leaves whatever else is
 * configured to carry the rest of the batches.
 */
export function noteUsageLimit(label: string, said: string, now: number = Date.now()): number {
    const stated = resetAt(said, now);
    /*
     * The longer of what it says now and what it said before, so a vaguer
     * second answer cannot release a source the first one shelved properly.
     */
    const until = Math.max(stated ?? now + RETRY_EVERY, exhausted.get(label)?.until ?? 0);
    exhausted.set(label, { until, retryAt: Math.min(until, now + RETRY_EVERY) });
    return until;
}

/**
 * When this source is believed to return, or undefined if it may be asked now.
 *
 * 'May be asked' is the retry cadence, not the stated reset. A source whose
 * window has not arrived is still offered once the cadence comes round, and put
 * straight back down if it still says no — which costs about a second and is
 * the only way a plan upgraded mid-run is ever noticed.
 */
export function setAsideUntil(label: string, now: number = Date.now()): number | undefined {
    const setback = exhausted.get(label);
    if (setback === undefined) {
        return undefined;
    }
    if (setback.retryAt <= now) {
        exhausted.delete(label);
        return undefined;
    }
    return setback.until;
}

/** Exported for the tests: the map is per process and outlives a case. */
export function clearUsageLimits(): void {
    exhausted.clear();
}

/**
 * The configured sources that are not currently out of quota.
 *
 * Distinct from generators() on purpose. That answers 'is anything set up',
 * which decides whether a run generates or composes; this answers 'can
 * anything answer right now', which decides where a batch goes. Reading one
 * for the other would turn a temporary limit into a run of composed names with
 * nothing saying why.
 */
export function usable(now: number = Date.now()): Generator[] {
    return generators().filter((generator) => setAsideUntil(generator.label, now) === undefined);
}

/**
 * Does anything this run reaches have a quota to come back?
 *
 * Says when, so the line a person reads is 'nothing until 3pm' rather than
 * 'nothing'.
 */
export function exhaustedUntil(now: number = Date.now()): number | undefined {
    const times = generators()
        .map((generator) => setAsideUntil(generator.label, now))
        .filter((at): at is number => at !== undefined);
    return times.length === generators().length && times.length > 0
        ? Math.min(...times)
        : undefined;
}

/**
 * Whether a failure is a quota rather than a fault.
 *
 * It presents as every batch failing at once, which is indistinguishable from
 * an outage unless you read the message — and it resets on a clock rather than
 * on a retry, so a short backoff cannot help.
 */
export function isUsageLimit(error: unknown): boolean {
    return /usage limit|rate limit|limit reached|too many requests|429|quota exceeded/i.test(
        saidBy(error)
    );
}

/** Everything a failed source told us, for reading a limit out of. */
export function saidBy(error: unknown): string {
    const e = error as Partial<Error> & { stderr?: string; stdout?: string };
    return `${e.stderr ?? ''} ${e.stdout ?? ''} ${e.message ?? ''}`;
}

export function hasGenerator(): boolean {
    return generators().length > 0;
}
