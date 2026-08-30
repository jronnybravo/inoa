import { EntitySchema } from 'typeorm';
import type { CheckStatus, RunStatus } from '../../types.ts';

export interface Run {
  id: string;
  brief: string;
  strategies: string[];
  requireCom: boolean;
  requireAppStore: boolean;
  requirePlayStore: boolean;
  requireGoogle: boolean;
  email: string;
  emailVerified: boolean;
  status: RunStatus;
  targetCount: number;
  generatedCount: number;
  checkedCount: number;
  error: string | null;
  /** Set when a worker takes ownership, so two workers cannot both run it. */
  claimedAt: Date | null;
  notifiedAt: Date | null;
  createdAt: Date;
  finishedAt: Date | null;
}

export const RunEntity = new EntitySchema<Run>({
  name: 'Run',
  tableName: 'runs',
  columns: {
    id: { type: 'uuid', primary: true, generated: 'uuid' },
    brief: { type: 'text' },
    strategies: { type: 'jsonb', default: () => "'[]'::jsonb" },
    requireCom: { type: 'boolean', default: false },
    requireAppStore: { type: 'boolean', default: false },
    requirePlayStore: { type: 'boolean', default: false },
    requireGoogle: { type: 'boolean', default: false },
    email: { type: 'text' },
    emailVerified: { type: 'boolean', default: false },
    status: { type: 'text', default: 'awaiting_verification' },
    targetCount: { type: 'int', default: 1000 },
    generatedCount: { type: 'int', default: 0 },
    checkedCount: { type: 'int', default: 0 },
    error: { type: 'text', nullable: true },
    claimedAt: { type: 'timestamptz', nullable: true },
    notifiedAt: { type: 'timestamptz', nullable: true },
    createdAt: { type: 'timestamptz', createDate: true },
    finishedAt: { type: 'timestamptz', nullable: true }
  },
  indices: [{ name: 'idx_runs_status', columns: ['status'] }]
});

export type { CheckStatus };
