import { EntitySchema } from 'typeorm';

/**
 * A line of the worker's console, kept so the browser can watch a run.
 *
 * The worker runs on a different machine from the app, so its stdout is not
 * reachable from the page. Persisting each line is what lets someone who
 * queued a run from their phone see what it is actually doing.
 */
export interface RunEvent {
  id: string;
  runId: string;
  level: 'info' | 'warn' | 'error' | 'success';
  message: string;
  at: Date;
}

export const RunEventEntity = new EntitySchema<RunEvent>({
  name: 'RunEvent',
  tableName: 'run_events',
  columns: {
    id: { type: 'uuid', primary: true, generated: 'uuid' },
    runId: { type: 'uuid' },
    level: { type: 'text', default: 'info' },
    message: { type: 'text' },
    at: { type: 'timestamptz', createDate: true }
  },
  indices: [{ name: 'idx_run_events_run', columns: ['runId', 'at'] }]
});
