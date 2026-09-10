/**
 * Create or update the tables. Run explicitly:  npm run db:sync
 *
 * Deliberately a separate command rather than `synchronize: true`, so schema
 * changes never happen as a side effect of a request landing on a cold Vercel
 * instance.
 */
import 'dotenv/config';
import {
    connectionOptions,
    DIALECT,
    isLoopbackHost,
    targetHost
} from '../src/lib/server/config.ts';
import { db } from '../src/lib/server/db.ts';

/**
 * What a failure to connect probably means, in the terms of this .env.
 *
 * A connection error names a syscall and nothing else — ETIMEDOUT does not
 * mention the port it timed out on, and 'password authentication failed' does
 * not mention channel binding. Both were worth an afternoon each: a managed
 * host with a leftover local port produced a bare ETIMEDOUT, which reads as
 * 'the database is down' rather than 'you are knocking on the wrong door'.
 *
 * A guess, offered as one. It never replaces the driver's own message.
 */
function diagnose(error: Error & { code?: string }): string[] {
    const notes: string[] = [];
    const host = targetHost();
    const remote = host !== '' && !isLoopbackHost(host);
    const port = Number(process.env.DB_PORT ?? 0);
    const standard = DIALECT === 'postgres' ? 5432 : 3306;

    if (error.code === 'ETIMEDOUT' || error.code === 'ECONNREFUSED') {
        if (remote && port && port !== standard) {
            notes.push(
                `DB_HOST is ${host}, which is not this machine, but DB_PORT is ${port}.`,
                `A managed database almost always listens on ${standard}; ${port} looks like a` +
                    ' port left behind by a local container.'
            );
        } else if (remote) {
            notes.push(
                `Nothing answered at ${host}:${port || standard}. Check the host is right and` +
                    ' that your address is allowed to reach it.'
            );
        } else {
            notes.push(
                `Nothing is listening on ${host}:${port || standard}. Is the local database running?`
            );
        }
    }

    if (/password authentication failed|SASL|channel binding/i.test(error.message)) {
        notes.push(
            'If this database requires channel binding, it needs TLS as well —' +
                ' DB_SSL=true, and leave DB_CHANNEL_BINDING alone.'
        );
    }

    if (/does not support SSL/i.test(error.message)) {
        notes.push('That server does not speak TLS. Set DB_SSL=false.');
    }

    return notes;
}

try {
    // db() also attaches the DataSource to the entities, so BaseEntity works here.
    const source = await db();
    await source.synchronize();
    console.log('schema synchronized');
    await source.destroy();
} catch (error) {
    const failure = error as Error & { code?: string };
    const options = connectionOptions();
    console.error(`\nCould not create the tables: ${failure.message}`);
    for (const note of diagnose(failure)) {
        console.error(`  ${note}`);
    }
    // Where it was pointed, since that is the thing usually wrong.
    console.error(
        `\n  connecting as: ${JSON.stringify(options).replace(/"password":"[^"]*"/, '"password":"***"')}`
    );
    process.exit(1);
}
