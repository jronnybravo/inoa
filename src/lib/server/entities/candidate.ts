import { EntitySchema } from 'typeorm';
import {
  JSON_TYPE,
  SHORT_TEXT,
  SHORT_TEXT_LENGTH,
  TIMESTAMP_TYPE,
  UUID_LENGTH,
  UUID_TYPE
} from '../dialect.ts';

import type { CheckKind, CheckStatus } from '../../types.ts';

export interface Candidate {
  id: string;
  runId: string;
  name: string;
  rationale: string | null;
  /** Which naming approach produced it. Null for runs made before this existed. */
  strategy: string | null;
  position: number;
  com: CheckStatus;
  appStore: CheckStatus;
  playStore: CheckStatus;
  google: CheckStatus;
  /**
   * What each check actually saw — the colliding listing, the live site.
   *
   * Nullable because MySQL will not put a default on a JSON or TEXT column, so
   * a row inserted without one arrives as null rather than an empty object.
   */
  detail: Partial<Record<CheckKind, string>> | null;
  /** Survived every check the run required. Null until checking reaches it. */
  passed: boolean | null;
  /** The required gate that dropped it, for explaining a rejection. */
  droppedBy: CheckKind | null;
  checkedAt: Date | null;
}

export const CandidateEntity = new EntitySchema<Candidate>({
  name: 'Candidate',
  tableName: 'candidates',
  columns: {
    id: { type: UUID_TYPE, length: UUID_LENGTH, primary: true, generated: 'uuid' },
    runId: { type: UUID_TYPE, length: UUID_LENGTH },
    name: { type: 'text' },
    rationale: { type: 'text', nullable: true },
    strategy: { type: SHORT_TEXT, length: SHORT_TEXT_LENGTH, nullable: true },
    position: { type: 'int', default: 0 },
    com: { type: SHORT_TEXT, length: SHORT_TEXT_LENGTH, default: 'pending' },
    appStore: { type: SHORT_TEXT, length: SHORT_TEXT_LENGTH, default: 'pending' },
    playStore: { type: SHORT_TEXT, length: SHORT_TEXT_LENGTH, default: 'pending' },
    google: { type: SHORT_TEXT, length: SHORT_TEXT_LENGTH, default: 'pending' },
    detail: { type: JSON_TYPE, nullable: true },
    passed: { type: 'boolean', nullable: true },
    droppedBy: { type: SHORT_TEXT, length: SHORT_TEXT_LENGTH, nullable: true },
    checkedAt: { type: TIMESTAMP_TYPE, nullable: true }
  },
  indices: [
    { name: 'idx_candidates_run', columns: ['runId'] },
    // The worker repeatedly asks for "next unchecked candidate in this run".
    { name: 'idx_candidates_run_position', columns: ['runId', 'position'] }
  ]
});
