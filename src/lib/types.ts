/** Shared vocabulary between the SvelteKit app and the local worker. */

import { platform } from './handles.ts';

/**
 * The state of one check against one name.
 *
 * 'unknown' exists because a boolean cannot tell "we looked and it is free"
 * apart from "we could not find out". Rendering the second as a clean cell is
 * how a broken check disguises itself as a working one — which is exactly what
 * happened to the web check in the previous tool, silently, for 500 names.
 *
 * 'skipped' is different again: a check the run never had to make, because an
 * earlier required gate already dropped the name.
 */
export type CheckStatus = 'pending' | 'clear' | 'taken' | 'unknown' | 'skipped';

/**
 * The places a name can be taken, other than a domain.
 *
 * The 'google' key is historical: the check asks a search API first, falls back
 * to Bing, and only reaches a browser against Google when neither is available.
 * The column is labelled for what it actually establishes — whether anyone is
 * trading under the name on the open web — rather than for one of the engines
 * that might answer.
 */
export type StoreKind = 'appStore' | 'playStore' | 'google';

/**
 * One domain check, named for its TLD.
 *
 * Prefixed rather than bare, and the prefix is load-bearing: '.google' and
 * '.app' are both real top-level domains, and 'google' and 'appStore' are
 * already checks. Without the namespace a run asking for the .google domain
 * would silently address the web check instead.
 */
export type TldKind = `tld:${string}`;

/**
 * One handle check, named for its platform.
 *
 * Prefixed for the same reason a TLD is: the platform ids are ordinary words
 * and would collide with something eventually. 'at:' because a handle is an
 * @name, which is also what makes it recognisable in a log.
 */
export type HandleKind = `at:${string}`;

export type CheckKind = StoreKind | TldKind | HandleKind;

/** Order is the funnel: cheapest and least rate-limited last-resort. */
export const STORE_ORDER: StoreKind[] = ['appStore', 'playStore', 'google'];

const STORE_LABEL: Record<StoreKind, string> = {
    appStore: 'App Store',
    playStore: 'Play Store',
    google: 'Web'
};

export const tldKind = (tld: string): TldKind => `tld:${tld}`;
export const handleKind = (platform: string): HandleKind => `at:${platform}`;

/** The TLD a check is for, or null if it is not a domain check. */
export function tldOf(kind: CheckKind): string | null {
    return kind.startsWith('tld:') ? kind.slice(4) : null;
}

/** The platform a check is for, or null if it is not a handle check. */
export function platformOf(kind: CheckKind): string | null {
    return kind.startsWith('at:') ? kind.slice(3) : null;
}

export function isTldKind(kind: CheckKind): kind is TldKind {
    return kind.startsWith('tld:');
}

/** What to call a check in a column heading or a sentence. */
export function checkLabel(kind: CheckKind): string {
    const tld = tldOf(kind);
    if (tld) {
        return `.${tld}`;
    }
    const at = platformOf(kind);
    if (at) {
        return `@${platform(at)?.label ?? at}`;
    }
    return STORE_LABEL[kind as StoreKind];
}

/** Where a person can go and look for themselves, per check. */
export function checkSearch(kind: CheckKind, name: string): string {
    const handle = name.toLowerCase().replace(/[^a-z0-9]/g, '');
    const tld = tldOf(kind);
    if (tld) {
        return `https://${handle}.${tld}`;
    }
    const at = platformOf(kind);
    if (at) {
        return platform(at)?.url(handle) ?? `https://${at}.com/${handle}`;
    }
    if (kind === 'appStore') {
        return `https://www.apple.com/us/search/${encodeURIComponent(name)}?src=globalnav`;
    }
    if (kind === 'playStore') {
        return `https://play.google.com/store/search?q=${encodeURIComponent(name)}&c=apps`;
    }
    return `https://www.google.com/search?q=${encodeURIComponent(`"${name}" (app OR software OR platform OR company)`)}`;
}

/** Every check a run makes, and the subset that can drop a name. */
export interface RunChecks {
    /** In funnel order: domains first, then the stores, then the web. */
    kinds: CheckKind[];
    /** A 'taken' here ends the name. Always a subset of `kinds`. */
    required: CheckKind[];
}

/** Statuses by check. A key that is absent was never asked. */
export type CheckStatuses = Partial<Record<CheckKind, CheckStatus>>;

/**
 * 'pending' for a check nobody has made yet.
 *
 * The map used to be a total record so that no caller had to assert a key back
 * into existence. It cannot be total now that the keys depend on the run, so
 * the same guarantee is made here instead: there is one place that decides
 * what an absent key means, and it is not the caller.
 */
export function statusOf(statuses: CheckStatuses | null, kind: CheckKind): CheckStatus {
    return statuses?.[kind] ?? 'pending';
}

/**
 * 'stopped' is a decision, not a failure.
 *
 * A run that was asked to stop kept whatever it had already found, so it is
 * not 'failed' - nothing went wrong - and it is not 'done', because the checks
 * it was asked for were never finished. Reading it as either would misdescribe
 * what is in the table.
 */
export type RunStatus =
    'awaiting_verification' | 'queued' | 'generating' | 'checking' | 'done' | 'failed' | 'stopped';

/** Statuses a worker will never pick up again. */
export const TERMINAL_STATUSES: RunStatus[] = ['done', 'failed', 'stopped'];

/** The generation approaches a brief can ask for. */
export const STRATEGIES = [
    { id: 'compound', label: 'Word combinations', hint: 'Ironforge, Keystone, Warmgrove' },
    { id: 'invented', label: 'Invented words', hint: 'Lumora, Veranex, Kizuneo' },
    { id: 'metaphor', label: 'Metaphor & symbolism', hint: 'Cadence, Lodestar, Tidal' },
    { id: 'portmanteau', label: 'Blends', hint: 'Swiftsylva, Novaris' },
    { id: 'foreign', label: 'Other languages', hint: 'Kizuna, Sonder, Vesta' },
    { id: 'short', label: 'Short & abstract', hint: 'Ovo, Nuo, Kip' },
    /*
     * The one move that exists because the real word is taken, which is this
     * whole project's premise. Flickr, Lyft, Tumblr — a word everybody already
     * knows, spelled a way nobody has registered.
     */
    { id: 'respell', label: 'Respelled words', hint: 'Gathr, Kwarry, Stok' }
] as const;

export type StrategyId = (typeof STRATEGIES)[number]['id'];

/**
 * What a candidate name may look like.
 *
 * The same rule generation is already held to — letters only, long enough to
 * say and short enough to fit a logo. A name somebody brings themselves is
 * checked by exactly the same machinery as a generated one, so it has to clear
 * the same bar or the checks would be asked questions they cannot answer.
 */
export const NAME_PATTERN = /^[A-Za-z]{3,16}$/;

/**
 * What the `source` column says for a name somebody typed in themselves.
 *
 * A value in the same column the generators write to, because it answers the
 * same question — where did this name come from — and a separate flag would
 * mean two places to look and two ways to disagree.
 */
export const OWN_SOURCE = 'you';

/** How many names somebody may bring to a run of their own. */
export const OWN_NAMES_MAX = 200;

/**
 * Names typed into the box under the brief, one per line.
 *
 * Commas are taken as separators too, because a list pasted out of a notes app
 * is as likely to be comma-separated as line-separated and guessing wrong
 * would silently turn six names into one.
 *
 * Rejects are returned rather than dropped. A name quietly discarded for a
 * stray digit is the kind of thing somebody only notices when the results come
 * back missing it, so the form says so while they are still looking at it.
 */
export function parseOwnNames(text: string): { names: string[]; rejected: string[] } {
    const names: string[] = [];
    const rejected: string[] = [];
    const seen = new Set<string>();
    for (const raw of text.split(/[\n,]/)) {
        const name = raw.trim();
        if (name === '') {
            continue;
        }
        if (!NAME_PATTERN.test(name)) {
            rejected.push(name);
            continue;
        }
        // Case-insensitively, because a domain does not distinguish them.
        const key = name.toLowerCase();
        if (!seen.has(key)) {
            seen.add(key);
            names.push(name);
        }
    }
    return { names, rejected };
}

/**
 * The shapes the API actually returns.
 *
 * Declared rather than inferred so the page is type-checked against the
 * server's answer instead of trusting whatever arrives. Dates cross as ISO
 * strings, which is the one place these differ from the entities.
 */
export interface CandidateView {
    id: string;
    name: string;
    rationale: string | null;
    strategy: StrategyId | null;
    /** The generator that wrote it. Null on rows from before this was recorded. */
    source: string | null;
    /** Keyed by check. Read through statusOf(), which answers for absent keys. */
    statuses: CheckStatuses;
    detail: Partial<Record<CheckKind, string>> | null;
    passed: boolean | null;
    droppedBy: CheckKind | null;
}

/**
 * The settings a run was composed with, as the form takes them.
 *
 * Written down as a type because it now travels: out of a finished run,
 * through ?from=, and back into the fields somebody is about to change.
 */
export interface RunSettings {
    brief: string;
    strategies: string[];
    languages: string[];
    /** Names the person brought themselves. Empty on a run that brought none. */
    ownNames: string[];
    tlds: string[];
    requiredTlds: string[];
    handles: string[];
    requiredHandles: string[];
    stores: string[];
    requiredStores: string[];
    webLinks: boolean;
    targetCount: number;
    /** Always null over the wire — the address is never sent back out. */
    email: string | null;
}

export interface RunView {
    id: string;
    brief: string;
    strategies: StrategyId[] | null;
    /** Languages the foreign approach was narrowed to. Empty means any. */
    languages: string[];
    /** Names the person brought themselves, checked alongside the generated ones. */
    ownNames: string[];
    /**
     * The checks this run makes, resolved on the server.
     *
     * Sent rather than derived here: the rules for reading a run written
     * before the TLDs were a choice live in one module on the server, and a
     * second copy on the client is a second thing to get wrong.
     */
    checks: RunChecks;
    /**
     * A Web column of search links rather than a Web check.
     *
     * Not part of `checks`: a link is not a verdict, and putting it there
     * would let it into computePassed, where 'we did not look' would start
     * counting as 'nothing found'.
     */
    webLinks: boolean;
    /** Masked, or null on a deployment that never asked for one. */
    email: string | null;
    status: RunStatus;
    targetCount: number;
    generatedCount: number;
    checkedCount: number;
    error: string | null;
}

export interface RunEventView {
    id: string;
    at: string;
    level: 'info' | 'warn' | 'error' | 'success';
    message: string;
}

export interface StrategyTally {
    strategy: StrategyId | null;
    /** Generated under this approach. */
    total: number;
    /**
     * Actually asked about: `passed` is a boolean, and null means the checks
     * never reached this name. Without this number a stopped run reports
     * everything it never examined as a failure.
     */
    checked: number;
    passed: number;
}

/** What GET /api/runs/[id] answers with. */
export interface RunPayload {
    run: RunView;
    events: RunEventView[];
    tallies: StrategyTally[];
    candidates: CandidateView[];
}
