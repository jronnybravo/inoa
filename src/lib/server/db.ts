/**
 * One DataSource per process, initialized lazily.
 *
 * Vercel keeps a warm function instance alive between requests, so a module
 * level DataSource is reused rather than reconnected. The `initializing`
 * promise matters: several requests can land on a cold instance at once, and
 * without it each would start its own connect and TypeORM would throw.
 *
 * Neon must be reached through its POOLED connection string. A serverless
 * function that opens a direct connection per invocation exhausts Postgres
 * connection slots long before it exhausts anything else.
 */

import 'reflect-metadata';
import { DataSource } from 'typeorm';
import { RunEntity } from './entities/run.ts';
import { CandidateEntity } from './entities/candidate.ts';
import { VerificationEntity } from './entities/verification.ts';
import { RunEventEntity } from './entities/event.ts';

const url = process.env.DATABASE_URL;

export const dataSource = new DataSource({
  type: 'postgres',
  url,
  entities: [RunEntity, CandidateEntity, VerificationEntity, RunEventEntity],
  // Schema changes go through `npm run db:sync`, never implicitly on boot:
  // a synchronize-on-start in a serverless function races itself.
  synchronize: false,
  logging: false,
  ssl: url?.includes('localhost') ? false : { rejectUnauthorized: false }
});

let initializing: Promise<DataSource> | undefined;

export async function db(): Promise<DataSource> {
  if (dataSource.isInitialized) return dataSource;
  initializing ??= dataSource.initialize();
  return initializing;
}
