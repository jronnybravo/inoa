/**
 * Streaming discovery endpoint (server-sent events).
 *
 * A run takes 10–30 seconds, which is far too long to leave a request hanging
 * with no feedback, so progress is streamed as it happens and the finished
 * result arrives as the last event. The engine is not cancellable mid-run; if
 * the client disconnects we simply stop writing.
 */

import type { APIRoute } from 'astro';
import { discover, renderReport } from '../../../discover.ts';
import { InvalidBriefError, optionsFromParams } from '../../lib/options.ts';
import { isLocalAddress } from '../../lib/local.ts';
import type { ProgressEvent } from '../../../core/types.ts';

export const prerender = false;

/** Discovery is CPU-bound and makes outbound calls to public registries. */
const MAX_CONCURRENT_RUNS = 2;
let activeRuns = 0;

function sse(event: string, data: unknown): string {
  return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
}

export const GET: APIRoute = async ({ url, request, clientAddress }) => {
  let options;
  try {
    options = optionsFromParams(url.searchParams, { local: isLocalAddress(clientAddress) });
  } catch (error) {
    if (error instanceof InvalidBriefError) {
      return new Response(JSON.stringify({ error: error.message }), {
        status: 400,
        headers: { 'content-type': 'application/json' },
      });
    }
    throw error;
  }

  if (activeRuns >= MAX_CONCURRENT_RUNS) {
    return new Response(
      JSON.stringify({ error: 'Another discovery is already running. Try again in a moment.' }),
      { status: 429, headers: { 'content-type': 'application/json' } },
    );
  }

  const encoder = new TextEncoder();
  activeRuns++;

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      let closed = false;
      const write = (event: string, data: unknown) => {
        if (closed || request.signal.aborted) return;
        try {
          controller.enqueue(encoder.encode(sse(event, data)));
        } catch {
          closed = true;
        }
      };

      const started = Date.now();
      try {
        write('start', { brief: options.brief, cycles: options.cycles });

        const result = await discover({
          ...options,
          // The history file belongs to the installation, not to a visitor. On a
          // public deployment it would be shared between strangers and would
          // progressively starve everyone's results, so it is local-only.
          excludeSeen: isLocalAddress(clientAddress),
          recordSeen: isLocalAddress(clientAddress),
          onProgress: (event: ProgressEvent) => write('progress', event),
        });

        write('result', {
          result,
          markdown: renderReport(result, options),
          elapsedMs: Date.now() - started,
        });
      } catch (error) {
        write('failed', { error: error instanceof Error ? error.message : String(error) });
      } finally {
        activeRuns--;
        closed = true;
        try {
          controller.close();
        } catch {
          // Already closed by a client disconnect.
        }
      }
    },
    cancel() {
      // The run finishes on its own; nothing left to write to.
    },
  });

  return new Response(stream, {
    headers: {
      'content-type': 'text/event-stream; charset=utf-8',
      'cache-control': 'no-cache, no-transform',
      connection: 'keep-alive',
      // Stops proxies from buffering the stream into one lump at the end.
      'x-accel-buffering': 'no',
    },
  });
};
