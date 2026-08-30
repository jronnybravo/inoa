/**
 * A shared rate limit for one endpoint.
 *
 * Pacing with a sleep between checks only works while checks run one at a
 * time. The moment several names are checked concurrently, each has its own
 * timer and they all call the same service at once — which is how you collect
 * 403s from Apple.
 *
 * This is a token bucket held in the module, so every caller queues against the
 * same schedule no matter how many are running.
 */
export class RateLimit {
  #next = 0;
  // A plain field, not a constructor parameter property: those are not
  // erasable syntax, and Node's type stripping refuses to run them.
  readonly #intervalMs: number;

  constructor(intervalMs: number) {
    this.#intervalMs = intervalMs;
  }

  /** Resolves when it is this caller's turn. */
  async take(): Promise<void> {
    const now = Date.now();
    const at = Math.max(now, this.#next);
    // Reserve the slot before awaiting, so concurrent callers queue rather
    // than all reading the same free slot.
    this.#next = at + this.#intervalMs;
    const wait = at - now;
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
  }
}

/**
 * Apple tolerates roughly twenty searches a minute before returning 403, and
 * that ceiling — not this machine — is what sets the floor on a run.
 */
export const appleLimit = new RateLimit(3200);

/** Play is scraped rather than an API; keep it gentle. */
export const playLimit = new RateLimit(900);

/** A search API has an ordinary quota. The browser path paces itself. */
export const webLimit = new RateLimit(600);
