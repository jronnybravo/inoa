import { EntitySchema } from 'typeorm';
import {
  JSON_TYPE,
  TIMESTAMP_TYPE,
  UUID_LENGTH,
  UUID_TYPE
} from '../dialect.ts';


export interface Verification {
  id: string;
  runId: string;
  email: string;
  code: string;
  attempts: number;
  expiresAt: Date;
  consumedAt: Date | null;
  createdAt: Date;
}

export const VerificationEntity = new EntitySchema<Verification>({
  name: 'Verification',
  tableName: 'verifications',
  columns: {
    id: { type: UUID_TYPE, length: UUID_LENGTH, primary: true, generated: 'uuid' },
    runId: { type: UUID_TYPE, length: UUID_LENGTH },
    email: { type: 'text' },
    code: { type: 'text' },
    // Bounded so a code cannot be brute forced; six digits is 10^6.
    attempts: { type: 'int', default: 0 },
    expiresAt: { type: TIMESTAMP_TYPE },
    consumedAt: { type: TIMESTAMP_TYPE, nullable: true },
    createdAt: { type: TIMESTAMP_TYPE, createDate: true }
  },
  indices: [{ name: 'idx_verifications_run', columns: ['runId'] }]
});
