/**
 * Rate limiting for the discovery endpoints.
 *
 * Every run is real CPU on this server plus outbound calls to Datamuse,
 * Wikipedia and the RDAP registries made on a visitor's behalf. Being a good
 * citizen of those services is the reason this exists, ahead of protecting our
 * own capacity.
 *
 * In-memory and therefore per-instance: behind more than one process this
 * becomes a per-process budget, and a shared store would be the fix.
 */

import { defineMiddleware } from 'astro:middleware';
import { isLocalAddress } from './lib/local.ts';

interface Bucket {
  hits: number[];
}

const RUN_LIMIT = 6;
const RUN_WINDOW_MS = 15 * 60 * 1000;
const buckets = new Map<string, Bucket>();
let lastSweep = Date.now();

function sweep(now: number): void {
  if (now - lastSweep < RUN_WINDOW_MS) return;
  lastSweep = now;
  for (const [key, bucket] of buckets) {
    bucket.hits = bucket.hits.filter((at) => now - at < RUN_WINDOW_MS);
    if (bucket.hits.length === 0) buckets.delete(key);
  }
}

/** Remaining runs for this client, without consuming one. */
function remaining(key: string, now: number): number {
  const bucket = buckets.get(key);
  if (!bucket) return RUN_LIMIT;
  return Math.max(0, RUN_LIMIT - bucket.hits.filter((at) => now - at < RUN_WINDOW_MS).length);
}

function consume(key: string, now: number): boolean {
  const bucket = buckets.get(key) ?? { hits: [] };
  bucket.hits = bucket.hits.filter((at) => now - at < RUN_WINDOW_MS);
  if (bucket.hits.length >= RUN_LIMIT) {
    buckets.set(key, bucket);
    return false;
  }
  bucket.hits.push(now);
  buckets.set(key, bucket);
  return true;
}

function retryAfterSeconds(key: string, now: number): number {
  const oldest = buckets.get(key)?.hits[0];
  if (!oldest) return 60;
  return Math.max(1, Math.ceil((RUN_WINDOW_MS - (now - oldest)) / 1000));
}

export const onRequest = defineMiddleware(async (context, next) => {
  const path = context.url.pathname;
  const isRun = path === '/api/discover' || path === '/api/discover.json';
  if (!isRun) return next();

  const now = Date.now();
  sweep(now);
  const key = context.clientAddress || 'unknown';
  // Rate limiting protects a public deployment, not your own laptop.
  if (isLocalAddress(key)) return next();

  if (!consume(key, now)) {
    const retry = retryAfterSeconds(key, now);
    return new Response(
      JSON.stringify({
        error: `Rate limit reached — ${RUN_LIMIT} runs per 15 minutes. Try again in ${Math.ceil(retry / 60)} minute${retry > 90 ? 's' : ''}.`,
      }),
      {
        status: 429,
        headers: {
          'content-type': 'application/json',
          'retry-after': String(retry),
        },
      },
    );
  }

  const response = await next();

  // A rejected brief never started a run, so it must not cost the caller one.
  // Without this, a typo in the form burns part of the budget.
  if (response.status === 400) {
    const bucket = buckets.get(key);
    if (bucket) bucket.hits = bucket.hits.filter((at) => at !== now);
  }

  response.headers.set('x-runs-remaining', String(remaining(key, now)));
  return response;
});
