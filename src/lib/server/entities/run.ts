/**
 * ActiveRecord without decorators.
 *
 * The class extends BaseEntity so it carries its own queries — Run.find()
 * rather than a repository passed around — and the mapping lives in an
 * EntitySchema whose `target` is that class. Decorators would express the same
 * thing more briefly, but they are not erasable syntax: Node's type stripping
 * rejects them outright, and Vite emits them into the server bundle untouched,
 * where they become a syntax error with no filename attached. This gets the
 * ergonomics with none of that.
 */

import { BaseEntity, EntitySchema } from 'typeorm';
import {
    JSON_TYPE,
    SHORT_TEXT,
    SHORT_TEXT_LENGTH,
    TIMESTAMP_TYPE,
    UUID_LENGTH,
    UUID_TYPE
} from '../dialect.ts';
import type { RunStatus, StrategyId } from '../../types.ts';

export class Run extends BaseEntity {
    id!: string;
    brief!: string;
    /** Null rather than defaulted: MySQL forbids a DEFAULT on a TEXT column. */
    strategies!: StrategyId[] | null;
    /**
     * The TLDs to check, and which of them a name must be free on.
     *
     * Null on runs made before a run could ask for anything but the .com;
     * `runChecks()` reads those through requireCom instead, which is why that
     * column is still here.
     */
    tlds!: string[] | null;
    requiredTlds!: string[] | null;
    /** @deprecated Superseded by tlds/requiredTlds. Read-only, for old rows. */
    requireCom!: boolean;
    requireAppStore!: boolean;
    requirePlayStore!: boolean;
    requireGoogle!: boolean;
    email!: string;
    emailVerified!: boolean;
    status!: RunStatus;
    targetCount!: number;
    generatedCount!: number;
    checkedCount!: number;
    error!: string | null;
    /** Set when a worker takes ownership, and renewed while it works. */
    claimedAt!: Date | null;
    notifiedAt!: Date | null;
    createdAt!: Date;
    finishedAt!: Date | null;
}

export const RunSchema = new EntitySchema<Run>({
    name: 'Run',
    target: Run,
    tableName: 'runs',
    columns: {
        id: { type: UUID_TYPE, length: UUID_LENGTH, primary: true, generated: 'uuid' },
        brief: { type: 'text' },
        strategies: { type: JSON_TYPE, nullable: true },
        tlds: { type: JSON_TYPE, nullable: true },
        requiredTlds: { type: JSON_TYPE, nullable: true },
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
