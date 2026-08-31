/**
 * One DataSource per process, initialized lazily.
 *
 * Vercel keeps a warm function instance alive between requests, so a module
 * level DataSource is reused rather than reconnected. The `initializing`
 * promise matters: several requests can land on a cold instance at once, and
 * without it each would start its own connect and TypeORM would throw.
 *
 * Entities extend BaseEntity, so they carry their own queries — Run.find()
 * rather than a repository handed around. That only works once the DataSource
 * has been attached to them, which is why every caller goes through db().
 */

import 'reflect-metadata';
import { DataSource } from 'typeorm';
import { connectionOptions, DIALECT } from './config.ts';
import { Run, RunSchema } from './entities/run.ts';
import { Candidate, CandidateSchema } from './entities/candidate.ts';
import { Verification, VerificationSchema } from './entities/verification.ts';
import { RunEvent, RunEventSchema } from './entities/event.ts';

export const dataSource = new DataSource({
    type: DIALECT as 'postgres',
    ...connectionOptions(),
    entities: [RunSchema, CandidateSchema, VerificationSchema, RunEventSchema],
    // Schema changes go through `npm run db:sync`, never implicitly on boot:
    // a synchronize-on-start in a serverless function races itself.
    synchronize: false,
    logging: false
} as never);

let initializing: Promise<DataSource> | undefined;

export async function db(): Promise<DataSource> {
    if (dataSource.isInitialized) {
        return dataSource;
    }
    initializing ??= dataSource.initialize().then((source) => {
        // Without this, Run.find() has no connection to run against.
        BaseEntities.forEach((entity) => entity.useDataSource(source));
        return source;
    });
    return initializing;
}

/** Each schema's `target` is one of these, which is what makes Run.find() work. */
const BaseEntities = [Run, Candidate, Verification, RunEvent];
