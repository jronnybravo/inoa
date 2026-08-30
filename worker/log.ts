/**
 * The worker's console, mirrored to the database.
 *
 * Every line goes to stdout as before and to run_events, because the page has
 * no other way to see it: the worker runs here and the app runs on Vercel.
 * A failure to record must never take down a run, so writes are best effort.
 */

import type { DataSource } from 'typeorm';
import { RunEventEntity, type RunEvent } from '../src/lib/server/entities/event.ts';

export type Level = RunEvent['level'];

const MARK: Record<Level, string> = {
  info: ' ',
  success: '✓',
  warn: '!',
  error: '×'
};

export function makeLogger(source: DataSource, runId: string) {
  const events = source.getRepository(RunEventEntity);
  return async (message: string, level: Level = 'info') => {
    console.log(`  ${MARK[level]} ${message}`);
    try {
      await events.insert({ runId, level, message });
    } catch {
      // A run must not fail because its narration could not be stored.
    }
  };
}
