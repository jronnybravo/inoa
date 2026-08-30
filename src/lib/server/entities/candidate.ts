import { EntitySchema } from 'typeorm';
import type { CheckKind, CheckStatus } from '../../types.ts';

export interface Candidate {
  id: string;
  runId: string;
  name: string;
  rationale: string | null;
  position: number;
  com: CheckStatus;
  appStore: CheckStatus;
  playStore: CheckStatus;
  google: CheckStatus;
  /** What each check actually saw — the colliding listing, the live site. */
  detail: Partial<Record<CheckKind, string>>;
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
    id: { type: 'uuid', primary: true, generated: 'uuid' },
    runId: { type: 'uuid' },
    name: { type: 'text' },
    rationale: { type: 'text', nullable: true },
    position: { type: 'int', default: 0 },
    com: { type: 'text', default: 'pending' },
    appStore: { type: 'text', default: 'pending' },
    playStore: { type: 'text', default: 'pending' },
    google: { type: 'text', default: 'pending' },
    detail: { type: 'jsonb', default: () => "'{}'::jsonb" },
    passed: { type: 'boolean', nullable: true },
    droppedBy: { type: 'text', nullable: true },
    checkedAt: { type: 'timestamptz', nullable: true }
  },
  indices: [
    { name: 'idx_candidates_run', columns: ['runId'] },
    // The worker repeatedly asks for "next unchecked candidate in this run".
    { name: 'idx_candidates_run_position', columns: ['runId', 'position'] }
  ]
});
