/**
 * Blocking JSON endpoint, for scripting against the engine.
 *
 * Same parameters as the streaming route; returns the whole DiscoveryResult in
 * one response. Expect it to take 10–30 seconds.
 *
 *   curl -s 'http://localhost:4321/api/discover.json?brief=A+calm+family+assistant&cycles=2'
 */

import type { APIRoute } from 'astro';
import { discover } from '../../../discover.ts';
import { InvalidBriefError, optionsFromParams } from '../../lib/options.ts';
import { isLocalAddress } from '../../lib/local.ts';

export const prerender = false;

export const GET: APIRoute = async ({ url, clientAddress }) => {
  try {
    const options = optionsFromParams(url.searchParams, { local: isLocalAddress(clientAddress) });
    const local = isLocalAddress(clientAddress);
    // Shared history across strangers would starve a public instance; local only.
    const result = await discover({ ...options, excludeSeen: local, recordSeen: local });
    return new Response(JSON.stringify(result, null, 2), {
      headers: { 'content-type': 'application/json; charset=utf-8' },
    });
  } catch (error) {
    const status = error instanceof InvalidBriefError ? 400 : 500;
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : String(error) }),
      { status, headers: { 'content-type': 'application/json' } },
    );
  }
};
