/** Shared vocabulary between the SvelteKit app and the local worker. */

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

export type CheckKind = 'com' | 'appStore' | 'playStore' | 'google';

/** Order is the funnel: cheapest and least rate-limited first. */
export const CHECK_ORDER: CheckKind[] = ['com', 'appStore', 'playStore', 'google'];

/**
 * The 'google' key is historical: the check asks a search API first, falls back
 * to Bing, and only reaches a browser against Google when neither is available.
 * The column is labelled for what it actually establishes — whether anyone is
 * trading under the name on the open web — rather than for one of the engines
 * that might answer.
 */
export const CHECK_LABEL: Record<CheckKind, string> = {
    com: '.com',
    appStore: 'App Store',
    playStore: 'Play Store',
    google: 'Web'
};

/** Where a person can go and look for themselves, per check. */
export const CHECK_SEARCH: Record<CheckKind, (name: string) => string> = {
    com: (n) => `https://${n.toLowerCase().replace(/[^a-z0-9]/g, '')}.com`,
    appStore: (n) => `https://www.apple.com/us/search/${encodeURIComponent(n)}?src=globalnav`,
    playStore: (n) => `https://play.google.com/store/search?q=${encodeURIComponent(n)}&c=apps`,
    google: (n) =>
        `https://www.google.com/search?q=${encodeURIComponent(`"${n}" (app OR software OR platform OR company)`)}`
};

export type RunStatus =
    'awaiting_verification' | 'queued' | 'generating' | 'checking' | 'done' | 'failed';

/** The generation approaches a brief can ask for. */
export const STRATEGIES = [
    { id: 'compound', label: 'Word combinations', hint: 'Ironforge, Keystone, Warmgrove' },
    { id: 'invented', label: 'Invented words', hint: 'Lumora, Veranex, Kizuneo' },
    { id: 'metaphor', label: 'Metaphor & symbolism', hint: 'Cadence, Lodestar, Tidal' },
    { id: 'portmanteau', label: 'Blends', hint: 'Swiftsylva, Novaris' },
    { id: 'foreign', label: 'Other languages', hint: 'Kizuna, Sonder, Vesta' },
    { id: 'short', label: 'Short & abstract', hint: 'Ovo, Nuo, Kip' }
] as const;

export type StrategyId = (typeof STRATEGIES)[number]['id'];

/**
 * Trademark distinctiveness, after Abercrombie & Fitch v. Hunting World (1976).
 *
 * The availability checks answer whether a name is taken. This answers whether
 * it could be owned, and the two come apart: a name can be free on the domain,
 * both stores and the web and still be too descriptive to register or defend.
 *
 * Listed weakest first, which is also the order a shortlist should be read in.
 */
export const DISTINCTIVENESS = [
    { id: 'generic', label: 'Generic', hint: 'the category naming itself — never registrable' },
    {
        id: 'descriptive',
        label: 'Descriptive',
        hint: 'describes what it does — weak until well known'
    },
    { id: 'suggestive', label: 'Suggestive', hint: 'hints at the category — Netflix, Slack' },
    { id: 'arbitrary', label: 'Arbitrary', hint: 'a real word, unrelated — Apple for computers' },
    { id: 'fanciful', label: 'Fanciful', hint: 'invented outright — Xerox, Kodak' }
] as const;

export type Distinctiveness = (typeof DISTINCTIVENESS)[number]['id'];

export const DISTINCTIVENESS_LABEL: Record<Distinctiveness, string> = {
    generic: 'Generic',
    descriptive: 'Descriptive',
    suggestive: 'Suggestive',
    arbitrary: 'Arbitrary',
    fanciful: 'Fanciful'
};

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
    distinctiveness: Distinctiveness | null;
    distinctivenessWhy: string | null;
    com: CheckStatus;
    appStore: CheckStatus;
    playStore: CheckStatus;
    google: CheckStatus;
    detail: Partial<Record<CheckKind, string>> | null;
    passed: boolean | null;
    droppedBy: CheckKind | null;
}

export interface RunView {
    id: string;
    brief: string;
    strategies: StrategyId[] | null;
    requireCom: boolean;
    requireAppStore: boolean;
    requirePlayStore: boolean;
    requireGoogle: boolean;
    email: string;
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
    total: number;
    passed: number;
}

/** What GET /api/runs/[id] answers with. */
export interface RunPayload {
    run: RunView;
    events: RunEventView[];
    tallies: StrategyTally[];
    candidates: CandidateView[];
}
