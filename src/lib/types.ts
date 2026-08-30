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

export const CHECK_LABEL: Record<CheckKind, string> = {
  com: '.com',
  appStore: 'App Store',
  playStore: 'Play Store',
  google: 'Google'
};

export type RunStatus =
  | 'awaiting_verification'
  | 'queued'
  | 'generating'
  | 'checking'
  | 'done'
  | 'failed';

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
