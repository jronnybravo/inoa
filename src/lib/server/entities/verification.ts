import { EntitySchema } from 'typeorm';

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
    id: { type: 'uuid', primary: true, generated: 'uuid' },
    runId: { type: 'uuid' },
    email: { type: 'text' },
    code: { type: 'text' },
    // Bounded so a code cannot be brute forced; six digits is 10^6.
    attempts: { type: 'int', default: 0 },
    expiresAt: { type: 'timestamptz' },
    consumedAt: { type: 'timestamptz', nullable: true },
    createdAt: { type: 'timestamptz', createDate: true }
  },
  indices: [{ name: 'idx_verifications_run', columns: ['runId'] }]
});
