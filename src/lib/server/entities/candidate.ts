import { BaseEntity, EntitySchema } from 'typeorm';
import {
    JSON_TYPE,
    SHORT_TEXT,
    SHORT_TEXT_LENGTH,
    TIMESTAMP_TYPE,
    UUID_LENGTH,
    UUID_TYPE
} from '../dialect.ts';
import type { CheckKind, CheckStatus } from '../../types.ts';

export class Candidate extends BaseEntity {
    id!: string;
    runId!: string;
    name!: string;
    rationale!: string | null;
    /** Which naming approach produced it. Null for runs made before this existed. */
    strategy!: string | null;
    /**
     * Which generator wrote it — 'claude-cli', 'openai', 'composed'.
     *
     * A run rotates its batches between whatever sources are configured, and
     * until this column there was no record of which one answered. That was
     * fine until one of them started failing quietly, at which point the only
     * visible symptom was a shortlist that had lost half its variety with
     * nothing anywhere saying why. Null for rows written before this existed.
     */
    source!: string | null;
    position!: number;
    /**
     * One verdict per TLD this run asked for, keyed by the bare TLD.
     *
     * A column each stopped being possible when the TLDs became the person's
     * choice out of a thousand. Null on rows written before that, whose single
     * .com verdict is in the column below.
     */
    domains!: Record<string, CheckStatus> | null;
    /** One verdict per social platform this run asked for, keyed by platform. */
    handles!: Record<string, CheckStatus> | null;
    /** @deprecated Superseded by `domains`. Read-only, for old rows. */
    com!: CheckStatus;
    appStore!: CheckStatus;
    playStore!: CheckStatus;
    google!: CheckStatus;
    /** What each check actually saw. Null where nothing has been written yet. */
    detail!: Partial<Record<CheckKind, string>> | null;
    /** Survived every check the run required. Null until checking reaches it. */
    passed!: boolean | null;
    /** The required gate that dropped it, for explaining a rejection. */
    droppedBy!: CheckKind | null;
    checkedAt!: Date | null;
}

const short = { type: SHORT_TEXT, length: SHORT_TEXT_LENGTH } as const;

export const CandidateSchema = new EntitySchema<Candidate>({
    name: 'Candidate',
    target: Candidate,
    tableName: 'candidates',
    columns: {
        id: { type: UUID_TYPE, length: UUID_LENGTH, primary: true, generated: 'uuid' },
        runId: { type: UUID_TYPE, length: UUID_LENGTH },
        name: { type: 'text' },
        rationale: { type: 'text', nullable: true },
        strategy: { ...short, nullable: true },
        source: { ...short, nullable: true },
        position: { type: 'int', default: 0 },
        domains: { type: JSON_TYPE, nullable: true },
        handles: { type: JSON_TYPE, nullable: true },
        com: { ...short, default: 'pending' },
        appStore: { ...short, default: 'pending' },
        playStore: { ...short, default: 'pending' },
        google: { ...short, default: 'pending' },
        detail: { type: JSON_TYPE, nullable: true },
        passed: { type: 'boolean', nullable: true },
        droppedBy: { ...short, nullable: true },
        checkedAt: { type: TIMESTAMP_TYPE, nullable: true }
    },
    indices: [
        { name: 'idx_candidates_run', columns: ['runId'] },
        // Verdicts are looked up by name across runs, to reuse a recent one.
        { name: 'idx_candidates_name', columns: ['name'] },
        // The worker repeatedly asks for "the next unchecked name in this run".
        { name: 'idx_candidates_run_position', columns: ['runId', 'position'] }
    ]
});
