/**
 * The worker's console, mirrored to the database.
 *
 * Every line goes to stdout as before and to run_events, because the page has
 * no other way to see it: the worker runs here and the app runs on Vercel.
 * A failure to record must never take down a run, so writes are best effort.
 */

import { RunEvent } from '../src/lib/server/entities/event.ts';
import type { DataSource } from 'typeorm';

export type Level = RunEvent['level'];

const MARK: Record<Level, string> = {
    info: ' ',
    success: '✓',
    warn: '!',
    error: '×'
};

export function makeLogger(_source: DataSource, runId: string) {
    return async (message: string, level: Level = 'info') => {
        console.log(`  ${MARK[level]} ${message}`);
        try {
            await RunEvent.insert({ runId, level, message });
        } catch {
            // A run must not fail because its narration could not be stored.
        }
    };
}
