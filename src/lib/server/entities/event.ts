import { BaseEntity, EntitySchema } from 'typeorm';
import { SHORT_TEXT, SHORT_TEXT_LENGTH, TIMESTAMP_TYPE, UUID_LENGTH, UUID_TYPE } from '../dialect.ts';

/**
 * A line of the worker's console, kept so the browser can watch a run.
 *
 * The worker runs on a different machine from the app, so its stdout is not
 * reachable from the page. Persisting each line is what lets someone who
 * queued a run from their phone see what it is actually doing.
 */
export class RunEvent extends BaseEntity {
  id!: string;
  runId!: string;
  level!: 'info' | 'warn' | 'error' | 'success';
  message!: string;
  at!: Date;
}

export const RunEventSchema = new EntitySchema<RunEvent>({
  name: 'RunEvent',
  target: RunEvent,
  tableName: 'run_events',
  columns: {
    id: { type: UUID_TYPE, length: UUID_LENGTH, primary: true, generated: 'uuid' },
    runId: { type: UUID_TYPE, length: UUID_LENGTH },
    level: { type: SHORT_TEXT, length: SHORT_TEXT_LENGTH, default: 'info' },
    message: { type: 'text' },
    at: { type: TIMESTAMP_TYPE, createDate: true }
  },
  indices: [{ name: 'idx_run_events_run', columns: ['runId', 'at'] }]
});
