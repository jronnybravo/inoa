/**
 * Shared vocabulary for the whole engine.
 *
 * Everything downstream — sources, generators, analyzers, validators, scorers —
 * speaks in Seeds (raw meaning) and Candidates (a name plus everything we know
 * about it).
 */

/** A language we are willing to mine for meaning. */
export type Language =
  | 'english'
  | 'latin'
  | 'greek'
  | 'french'
  | 'spanish'
  | 'italian'
  | 'japanese'
  | 'korean'
  | 'german'
  | 'sanskrit'
  | 'old-norse'
  | 'arabic'
  | 'hebrew';

/** Where a piece of raw material came from. */
export type SourceKind =
  | 'dictionary'
  | 'thesaurus'
  | 'etymology'
  | 'translation'
  | 'wikipedia'
  | 'concept'
  | 'brief';

/** Which knowledge domain a concept was mined from (Stage 3). */
export type ConceptDomain =
  | 'mythology'
  | 'astronomy'
  | 'geography'
  | 'biology'
  | 'architecture'
  | 'engineering'
  | 'psychology'
  | 'music'
  | 'mathematics'
  | 'sports'
  | 'philosophy'
  | 'navigation'
  | 'materials'
  | 'weather'
  | 'craft';

/**
 * A unit of raw meaning: a word, root, or concept that could seed a name.
 * Seeds are language- and domain-tagged so generators can respect provenance.
 */
export interface Seed {
  /** The surface form used for generation (romanized, lowercase, a-z only). */
  form: string;
  /** How it is actually written in its own script, when different. */
  native?: string;
  /** Plain-English meaning. */
  gloss: string;
  language: Language;
  source: SourceKind;
  domain?: ConceptDomain;
  /** Concept tags this seed serves: 'speed', 'trust', 'light'... */
  tags: string[];
  /** 0..1 — how emotionally/strategically on-brief this seed is. */
  weight: number;
  /** Free-form provenance note, surfaced in the final report. */
  note?: string;
  /**
   * Grammatical role, when a source actually knows it.
   *
   * Only set by sources that establish it from usage rather than inferring it
   * from a part-of-speech label — which is a distinction the word bank cannot
   * make, since Datamuse tags 'stone' and 'warm' alike as adjectival.
   */
  role?: 'head' | 'mod';
}

/** Naming strategies (Stage 4). */
export type Strategy =
  | 'real-word'
  | 'compound'
  | 'invented'
  | 'misspelling'
  | 'prefixed'
  | 'suffixed'
  | 'blend'
  | 'portmanteau'
  | 'acronym'
  | 'symbolic'
  | 'metaphorical'
  | 'emotional'
  | 'action'
  | 'abstract'
  | 'mutation';

/** The naming philosophy driving one discovery cycle (Stage 7). */
export type Philosophy =
  | 'evocative-classical'
  | 'invented-phonetic'
  | 'plain-english-metaphor'
  | 'compound-utility'
  | 'mythic-symbolic'
  | 'minimal-abstract';

/** Stage 1 output: the strategic brief, made explicit. */
export interface BrandDNA {
  brief: string;
  problem: string;
  users: string;
  /** The feelings the name must produce, ranked. */
  emotions: string[];
  industryNow: string;
  industryLater: string;
  /** Should the name describe the category or evoke a feeling? */
  posture: 'describe' | 'evoke' | 'balanced';
  /** Concept tags that drive seed selection and scoring. */
  concepts: string[];
  /**
   * The brief's own content words. These carry the product's actual field —
   * 'sport', 'kitchen', 'deploy' — which the abstract concept tags cannot.
   */
  briefTerms: string[];
  /** Sounds/shapes to reach for, e.g. 'open vowels', 'liquid consonants'. */
  soundTargets: string[];
  /** Words, roots and clichés that are banned for this brief. */
  avoid: string[];
  /** Syllable window the winning name should live in. */
  syllableRange: [number, number];
}

export interface Scores {
  memorability: number;
  pronunciation: number;
  visual: number;
  brandability: number;
  emotion: number;
  premium: number;
  scalability: number;
  international: number;
  /** Estimates — heuristic unless a validator upgraded them. */
  trademarkUniqueness: number;
  domainUniqueness: number;
  socialUniqueness: number;
  overall: number;
}

/**
 * `no-active-site` covers every registered domain with no business running on
 * it: parked, listed for sale, squatted, or simply dormant. Those are not
 * distinguishable without a broker API — all four serve nothing — so they are
 * reported as one honest category rather than guessed at individually.
 */
export type Availability =
  | 'available'
  | 'taken'
  | 'no-active-site'
  | 'premium-or-parked'
  | 'unknown';

export interface DomainCheck {
  domain: string;
  status: Availability;
  /** How the verdict was reached: 'rdap', 'dns', 'heuristic'. */
  method: string;
  detail?: string;
  /** Where to go and look, when there is something there to look at. */
  url?: string;
}

export interface SocialCheck {
  platform: string;
  handle: string;
  status: Availability;
  method: string;
  /** The profile or package page, so a taken handle can be inspected. */
  url?: string;
}

export interface TrademarkCheck {
  /** 0..100 — higher means more likely to be ownable. */
  uniqueness: number;
  /** Live marks or famous brands that look/sound too close. */
  collisions: { mark: string; similarity: number; reason: string }[];
  method: string;
  /** True when a real registry was queried rather than the offline corpus. */
  authoritative: boolean;
}

export interface StoreVerdictRecord {
  store: string;
  status: 'clear' | 'taken' | 'unknown';
  matches: string[];
  method: string;
  /** The colliding listing, or the store search that found it. */
  url?: string;
}

export interface Validation {
  domains: DomainCheck[];
  social: SocialCheck[];
  trademark: TrademarkCheck;
  /** App Store and Play Store listings that collide with the name. */
  appStores?: StoreVerdictRecord[];
}

/** A name under consideration, with its full provenance and verdicts. */
export interface Candidate {
  /** Lowercase canonical form. */
  name: string;
  /** Display form, e.g. 'Lumora'. */
  display: string;
  strategy: Strategy;
  philosophy: Philosophy;
  /** Seeds that produced it. */
  seeds: Seed[];
  /** Names this one was mutated from, oldest first. */
  lineage: string[];
  /** Why this name exists — one sentence, written by the generator. */
  rationale: string;
  scores?: Scores;
  validation?: Validation;
  /** Hard problems found by analyzers: negative meanings, collisions, etc. */
  risks: string[];
  /** Cycle index that produced it. */
  cycle: number;
}

/**
 * A run in progress. Emitted often enough that a UI can show real movement
 * during the 10–30 seconds a multi-cycle discovery takes.
 */
export interface ProgressEvent {
  stage: 'seeds' | 'cycle' | 'validate' | 'done';
  message: string;
  /** 0..1 across the whole run. */
  progress: number;
  /** Names worth showing as they appear, so the wait has something in it. */
  preview?: string[];
}

export interface DiscoveryOptions {
  brief: string;
  industry?: string;
  emotions?: string[];
  audience?: string;
  posture?: BrandDNA['posture'];
  avoid?: string[];
  /** Number of full generate → score → mutate cycles (Stage 7). */
  cycles: number;
  /**
   * Which naming philosophies to run, in order. Omit to take the first
   * `cycles` from the canonical rotation — which is what the CLI does by
   * default, and why anything past the fourth was previously unreachable.
   */
  philosophies?: Philosophy[];
  /** Minimum candidates generated per cycle before ranking. */
  perCycle: number;
  /** How many finalists get network validation. */
  validate: number;
  /**
   * A TLD whose availability is a hard requirement, e.g. 'com'.
   *
   * Off by default: a parked or for-sale domain is purchasable, and RDAP cannot
   * tell those apart from a domain in active use, so requiring one rejects
   * names that are actually obtainable.
   */
  requireTld?: string;
  /**
   * Reject names already shipping as an app. On by default — an app listing is
   * public, indexed, and the first thing anyone searching the name will find.
   */
  requireAppStoreClear?: boolean;
  /** How many ranked candidates the availability pre-screen examines. */
  prescreen?: number;
  /**
   * Skip names shown by earlier runs. On by default locally, off for a public
   * deployment where the history would be shared between strangers.
   */
  excludeSeen?: boolean;
  /** Add this run's finalists to that history. */
  recordSeen?: boolean;
  /** TLDs to check for the finalists. */
  tlds: string[];
  /** Skip every network call and run purely offline. */
  offline: boolean;
  /** Deterministic runs. */
  seedValue: number;
  syllableRange?: [number, number];
  outFile?: string;
  /** Called as the run advances. The CLI logs to stderr; the web app streams. */
  onProgress?: (event: ProgressEvent) => void;
}

export interface CycleReport {
  cycle: number;
  philosophy: Philosophy;
  generated: number;
  survived: number;
  top: Candidate[];
}

export interface DiscoveryResult {
  dna: BrandDNA;
  /** The seed this run used. Re-running with it reproduces the run exactly. */
  seedValue: number;
  cycles: CycleReport[];
  finalists: Candidate[];
  nextMutations: string[];
  generatedTotal: number;
  /** Present when a required-TLD screen ran. */
  prescreen?: { tld: string; examined: number; available: number };
  /** Present when the app-store screen ran. */
  appStoreScreen?: { examined: number; rejected: number; unresolved: number; names: string[] };
  /** How many candidates earlier runs had already shown. */
  history?: { excluded: number; remembered: number; exhausted: boolean };
}
