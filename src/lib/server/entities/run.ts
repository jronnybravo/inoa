import { EntitySchema } from 'typeorm';
import {
  JSON_TYPE,
  SHORT_TEXT,
  SHORT_TEXT_LENGTH,
  TIMESTAMP_TYPE,
  UUID_LENGTH,
  UUID_TYPE
} from '../dialect.ts';

import type { CheckStatus, RunStatus } from '../../types.ts';

export interface Run {
  id: string;
  brief: string;
  strategies: string[] | null;
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
    id: { type: UUID_TYPE, length: UUID_LENGTH, primary: true, generated: 'uuid' },
    brief: { type: 'text' },
    strategies: { type: JSON_TYPE, nullable: true },
    requireCom: { type: 'boolean', default: false },
    requireAppStore: { type: 'boolean', default: false },
    requirePlayStore: { type: 'boolean', default: false },
    requireGoogle: { type: 'boolean', default: false },
    email: { type: 'text' },
    emailVerified: { type: 'boolean', default: false },
    status: { type: SHORT_TEXT, length: SHORT_TEXT_LENGTH, default: 'awaiting_verification' },
    targetCount: { type: 'int', default: 1000 },
    generatedCount: { type: 'int', default: 0 },
    checkedCount: { type: 'int', default: 0 },
    error: { type: 'text', nullable: true },
    claimedAt: { type: TIMESTAMP_TYPE, nullable: true },
    notifiedAt: { type: TIMESTAMP_TYPE, nullable: true },
    createdAt: { type: TIMESTAMP_TYPE, createDate: true },
    finishedAt: { type: TIMESTAMP_TYPE, nullable: true }
  },
  indices: [{ name: 'idx_runs_status', columns: ['status'] }]
});

export type { CheckStatus };
