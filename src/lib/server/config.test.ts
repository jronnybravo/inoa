/**
 * Where we connect, and whether we encrypt getting there.
 *
 * Both decisions used to be made twice from different inputs, and could
 * disagree: with DB_HOST unset, the TLS check tested '' (not loopback, so TLS
 * on) while the connection fell back to 'localhost' (which does not speak TLS).
 * The driver then reported "the server does not support SSL connections",
 * which names neither cause.
 */

import assert from 'node:assert/strict';
import { afterEach, describe, it } from 'node:test';
import { hostFromUrl, isLoopbackHost } from './config.ts';

describe('isLoopbackHost', () => {
    for (const host of ['localhost', 'LOCALHOST', '127.0.0.1', '127.1.2.3', '::1', '[::1]']) {
        it(`treats ${host} as this machine`, () => {
            assert.equal(isLoopbackHost(host), true);
        });
    }

    /*
     * The old test was a substring match over the whole connection string, so
     * any of these disabled TLS against a remote server — a check that fails
     * open, which is the wrong direction for one guarding transport security.
     */
    for (const host of [
        'db.example.com',
        'localhost.attacker.example',
        'my-localhost-db.neon.tech',
        '10.0.0.5',
        ''
    ]) {
        it(`does not treat ${JSON.stringify(host)} as this machine`, () => {
            assert.equal(isLoopbackHost(host), false);
        });
    }
});

describe('hostFromUrl', () => {
    it('reads the hostname, not the rest of the string', () => {
        assert.equal(
            hostFromUrl('postgresql://user:pass@db.example.com:5432/app'),
            'db.example.com'
        );
    });

    /*
     * The credential and database name are attacker- or accident-controlled
     * text that used to be searched for 'localhost'.
     */
    it('ignores localhost appearing in the password or database name', () => {
        const url = 'postgresql://user:localhost@db.example.com/localhost';
        assert.equal(hostFromUrl(url), 'db.example.com');
        assert.equal(isLoopbackHost(hostFromUrl(url)), false);
    });

    it('recognises a genuinely local URL', () => {
        assert.equal(isLoopbackHost(hostFromUrl('postgresql://u:p@localhost:55432/app')), true);
    });

    it('returns empty for a string that will not parse, which reads as remote', () => {
        assert.equal(hostFromUrl('not a url'), '');
        assert.equal(isLoopbackHost(hostFromUrl('not a url')), false);
    });
});

/**
 * Connecting to a managed Postgres that demands channel binding.
 *
 * Neon hands you PGSSLMODE=require and PGCHANNELBINDING=require and the app
 * could not connect with them set. Neither variable did anything: DB_SSL was
 * the only thing consulted for TLS, and PGCHANNELBINDING is a libpq variable
 * that node-postgres has never read.
 *
 * These build the options and read them back rather than opening a socket, so
 * they say what the driver is handed. What the driver then does with it is
 * pinned separately, below.
 */
describe('connecting where the host asks for channel binding', () => {
    const VARS = [
        'DATABASE_URL',
        'DB_SSL',
        'DB_SSL_REJECT_UNAUTHORIZED',
        'DB_HOST',
        'DB_CHANNEL_BINDING',
        'PGSSLMODE',
        'PGCHANNELBINDING'
    ];
    const saved = new Map(VARS.map((key) => [key, process.env[key]]));

    afterEach(() => {
        for (const [key, value] of saved) {
            if (value === undefined) {
                Reflect.deleteProperty(process.env, key);
            } else {
                process.env[key] = value;
            }
        }
    });

    const clear = (): void => {
        for (const key of VARS) {
            Reflect.deleteProperty(process.env, key);
        }
    };

    /**
     * Read the module afresh, because DATABASE_URL is captured at import time.
     *
     * A cache-busting query on the specifier is the whole trick: without it
     * every case here would see whichever environment the first one happened
     * to set.
     */
    const optionsNow = async (): Promise<Record<string, unknown>> => {
        const mod = (await import(`./config.ts?v=${Math.random()}`)) as {
            connectionOptions: () => Record<string, unknown>;
        };
        return mod.connectionOptions();
    };

    it('asks for channel binding against a remote host', async () => {
        clear();
        process.env.DB_HOST = 'ep-cool-name.us-east-2.aws.neon.tech';
        process.env.PGSSLMODE = 'require';
        process.env.PGCHANNELBINDING = 'require';
        const options = await optionsNow();
        assert.deepEqual(options.extra, { enableChannelBinding: true });
        assert.deepEqual(options.ssl, { rejectUnauthorized: false });
    });

    it('asks for it through a URL too, which is how Neon hands it over', async () => {
        clear();
        process.env.DATABASE_URL =
            'postgresql://u:p@ep-cool-name.neon.tech/neondb?sslmode=require&channel_binding=require';
        const options = await optionsNow();
        assert.deepEqual(options.extra, { enableChannelBinding: true });
    });

    /*
     * There is no certificate to bind to without TLS, so offering the -PLUS
     * mechanism there would be a request the driver cannot honour.
     */
    it('does not ask for it without TLS', async () => {
        clear();
        process.env.DB_HOST = 'localhost';
        const options = await optionsNow();
        assert.equal(options.ssl, false);
        assert.equal(options.extra, undefined);
    });

    /* true/false, like DB_SSL and every other switch this file owns. */
    it('takes DB_CHANNEL_BINDING=false to turn it off', async () => {
        clear();
        process.env.DB_HOST = 'db.example.com';
        process.env.DB_CHANNEL_BINDING = 'false';
        assert.equal((await optionsNow()).extra, undefined);
    });

    it('takes DB_CHANNEL_BINDING=true to leave it on', async () => {
        clear();
        process.env.DB_HOST = 'db.example.com';
        process.env.DB_CHANNEL_BINDING = 'true';
        assert.deepEqual((await optionsNow()).extra, { enableChannelBinding: true });
    });

    /* The alias speaks libpq's words, because that is what it is an alias for. */
    it('lets PGCHANNELBINDING=disable turn it off', async () => {
        clear();
        process.env.DB_HOST = 'db.example.com';
        process.env.PGCHANNELBINDING = 'disable';
        assert.equal((await optionsNow()).extra, undefined);
    });

    it('lets the DB_ name win over the alias, as DB_SSL does over PGSSLMODE', async () => {
        clear();
        process.env.DB_HOST = 'db.example.com';
        process.env.PGCHANNELBINDING = 'disable';
        process.env.DB_CHANNEL_BINDING = 'true';
        assert.deepEqual((await optionsNow()).extra, { enableChannelBinding: true });
    });

    /* PGSSLMODE is the variable the host's own snippet tells you to set. */
    it('reads PGSSLMODE=disable as no TLS', async () => {
        clear();
        process.env.DB_HOST = 'db.example.com';
        process.env.PGSSLMODE = 'disable';
        assert.equal((await optionsNow()).ssl, false);
    });

    it('reads verify-full as checking the chain, and require as not', async () => {
        clear();
        process.env.DB_HOST = 'db.example.com';
        process.env.PGSSLMODE = 'verify-full';
        assert.deepEqual((await optionsNow()).ssl, { rejectUnauthorized: true });

        process.env.PGSSLMODE = 'require';
        assert.deepEqual((await optionsNow()).ssl, { rejectUnauthorized: false });
    });

    it('still lets DB_SSL win, since it is this project own switch', async () => {
        clear();
        process.env.DB_HOST = 'db.example.com';
        process.env.PGSSLMODE = 'verify-full';
        process.env.DB_SSL = 'false';
        assert.equal((await optionsNow()).ssl, false);
    });
});

/**
 * What node-postgres does with that flag, pinned.
 *
 * The whole fix rests on one third-party default: `enableChannelBinding` is
 * false unless asked, and without it the driver never offers
 * SCRAM-SHA-256-PLUS — so a server that requires channel binding refuses the
 * connection. These call the driver's own SASL negotiation directly, so if a
 * pg upgrade changes that default or renames the flag, this fails here rather
 * than against somebody's database.
 */
describe('the driver only binds the channel when asked', () => {
    /** What a TLS socket looks like to the negotiation: it has a certificate. */
    const secureStream = { getPeerCertificate: () => ({ raw: Buffer.alloc(32) }) };
    const OFFERED = ['SCRAM-SHA-256-PLUS', 'SCRAM-SHA-256'];

    /*
     * An internal path with no types of its own, which is the point: this is
     * reaching past the public API on purpose to pin an internal default the
     * fix depends on. The assertion below fails loudly if it ever moves.
     */
    type Sasl = {
        default?: { startSession: (m: string[], s: unknown) => { mechanism: string } };
        startSession?: (m: string[], s: unknown) => { mechanism: string };
    };

    const startSession = async (stream: unknown): Promise<{ mechanism: string }> => {
        const internal = 'pg/lib/crypto/sasl.js';
        const sasl = (await import(/* @vite-ignore */ internal)) as unknown as Sasl;
        const fn = sasl.startSession ?? sasl.default?.startSession;
        assert.ok(fn, 'pg no longer exposes startSession — the flag below may have moved too');
        return fn(OFFERED, stream);
    };

    /* The failure, stated: no stream means no -PLUS, whatever the server offers. */
    it('picks plain SCRAM when channel binding is off, even where it is offered', async () => {
        const session = await startSession(false);
        assert.equal(session.mechanism, 'SCRAM-SHA-256');
    });

    it('picks the -PLUS mechanism once it has a certificate to bind to', async () => {
        const session = await startSession(secureStream);
        assert.equal(session.mechanism, 'SCRAM-SHA-256-PLUS');
    });
});
