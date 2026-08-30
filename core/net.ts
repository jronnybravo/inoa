/**
 * Network access with a disk cache.
 *
 * Every external lookup goes through here so that (a) a discovery run is
 * repeatable without hammering public APIs, (b) `--offline` degrades the whole
 * engine gracefully instead of throwing, and (c) no single slow endpoint can
 * stall a run.
 */

import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join, isAbsolute } from 'node:path';

// Resolved from the working directory rather than from this module's own URL,
// so the cache lands in the same place whether the engine is run directly by
// the CLI or bundled into the Astro server build.
const CACHE_DIR = (() => {
  const configured = process.env.BRANDY_CACHE_DIR;
  if (configured) return isAbsolute(configured) ? configured : join(process.cwd(), configured);
  return join(process.cwd(), '.cache');
})();
const DAY = 24 * 60 * 60 * 1000;

let offline = false;
let calls = 0;
let cacheHits = 0;

export function setOffline(value: boolean): void {
  offline = value;
}

export function isOffline(): boolean {
  return offline;
}

export function netStats(): { calls: number; cacheHits: number } {
  return { calls, cacheHits };
}

function cachePath(key: string): string {
  const hash = createHash('sha1').update(key).digest('hex');
  return join(CACHE_DIR, `${hash.slice(0, 2)}`, `${hash}.json`);
}

async function readCache<T>(key: string, ttl: number): Promise<T | undefined> {
  try {
    const raw = await readFile(cachePath(key), 'utf8');
    const entry = JSON.parse(raw) as { at: number; value: T };
    if (Date.now() - entry.at > ttl) return undefined;
    cacheHits++;
    return entry.value;
  } catch {
    return undefined;
  }
}

async function writeCache(key: string, value: unknown): Promise<void> {
  const path = cachePath(key);
  try {
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, JSON.stringify({ at: Date.now(), value }), 'utf8');
  } catch {
    // A cache that cannot be written is not a reason to fail a run.
  }
}

export interface FetchOptions {
  timeoutMs?: number;
  ttlMs?: number;
  headers?: Record<string, string>;
  method?: 'GET' | 'HEAD';
  /** Cache negative results too — stops repeated probing of dead endpoints. */
  cacheFailures?: boolean;
  /**
   * Follow redirects. Off by default so a social platform bouncing us to a
   * login page does not read as "profile exists", but required for RDAP, where
   * the bootstrap server always redirects to the authoritative registry.
   */
  followRedirects?: boolean;
}

const UA = 'brandy-name-discovery/0.1 (+research tool; contact: local user)';

/** GET JSON. Returns undefined on any failure — callers must degrade, not throw. */
export async function getJSON<T>(url: string, opts: FetchOptions = {}): Promise<T | undefined> {
  const ttl = opts.ttlMs ?? 30 * DAY;
  const cached = await readCache<T | null>(`json:${url}`, ttl);
  if (cached !== undefined) return cached === null ? undefined : cached;
  if (offline) return undefined;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), opts.timeoutMs ?? 6000);
  try {
    calls++;
    const res = await fetch(url, {
      signal: controller.signal,
      headers: { accept: 'application/json', 'user-agent': UA, ...opts.headers },
    });
    if (!res.ok) {
      if (opts.cacheFailures) await writeCache(`json:${url}`, null);
      return undefined;
    }
    const value = (await res.json()) as T;
    await writeCache(`json:${url}`, value);
    return value;
  } catch {
    if (opts.cacheFailures) await writeCache(`json:${url}`, null);
    return undefined;
  } finally {
    clearTimeout(timer);
  }
}

/** Status-code probe, used by the social and domain validators. */
export async function probe(url: string, opts: FetchOptions = {}): Promise<number | undefined> {
  const ttl = opts.ttlMs ?? 7 * DAY;
  const cached = await readCache<number | null>(`probe:${url}`, ttl);
  if (cached !== undefined) return cached === null ? undefined : cached;
  if (offline) return undefined;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), opts.timeoutMs ?? 6000);
  try {
    calls++;
    const res = await fetch(url, {
      method: opts.method ?? 'HEAD',
      redirect: opts.followRedirects ? 'follow' : 'manual',
      signal: controller.signal,
      headers: { 'user-agent': UA, ...opts.headers },
    });
    await writeCache(`probe:${url}`, res.status);
    return res.status;
  } catch {
    await writeCache(`probe:${url}`, null);
    return undefined;
  } finally {
    clearTimeout(timer);
  }
}

/** Run tasks with bounded concurrency — public APIs deserve manners. */
export async function mapLimit<T, R>(
  items: readonly T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let cursor = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (cursor < items.length) {
      const index = cursor++;
      results[index] = await fn(items[index] as T, index);
    }
  });
  await Promise.all(workers);
  return results;
}
