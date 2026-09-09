/**
 * How a run's status looks, in one place.
 *
 * The run page and the history list both draw a dot and a word for the same
 * seven states, and they were drifting: the run page had already learned that
 * 'awaiting_verification' should not be shown to anybody as a raw enum, and
 * the list would have had to learn it separately.
 */

import type { RunStatus } from './types.ts';

export const STATUS_WORD: Record<RunStatus, string> = {
    awaiting_verification: 'Waiting on the code',
    queued: 'Queued',
    generating: 'Generating',
    checking: 'Checking',
    done: 'Done',
    failed: 'Failed',
    stopped: 'Stopped'
};

/** The dot's colour. Amber for stopped, because it is a decision, not a fault. */
export const STATUS_TONE: Record<RunStatus, string> = {
    awaiting_verification: 'bg-stone-400',
    queued: 'bg-stone-400',
    generating: 'bg-emerald-500',
    checking: 'bg-emerald-500',
    done: 'bg-stone-400',
    failed: 'bg-rose-500',
    stopped: 'bg-amber-500'
};
