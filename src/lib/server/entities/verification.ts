import { BaseEntity, EntitySchema } from 'typeorm';
import { TIMESTAMP_TYPE, UUID_LENGTH, UUID_TYPE } from '../dialect.ts';

export class Verification extends BaseEntity {
  id!: string;
  runId!: string;
  email!: string;
  code!: string;
  /** Bounded so a six-digit code cannot be walked through. */
  attempts!: number;
  expiresAt!: Date;
  consumedAt!: Date | null;
  createdAt!: Date;
}

export const VerificationSchema = new EntitySchema<Verification>({
  name: 'Verification',
  target: Verification,
  tableName: 'verifications',
  columns: {
    id: { type: UUID_TYPE, length: UUID_LENGTH, primary: true, generated: 'uuid' },
    runId: { type: UUID_TYPE, length: UUID_LENGTH },
    email: { type: 'text' },
    code: { type: 'text' },
    attempts: { type: 'int', default: 0 },
    expiresAt: { type: TIMESTAMP_TYPE },
    consumedAt: { type: TIMESTAMP_TYPE, nullable: true },
    createdAt: { type: TIMESTAMP_TYPE, createDate: true }
  },
  indices: [{ name: 'idx_verifications_run', columns: ['runId'] }]
});
