/**
 * Database configuration, from discrete settings or a single URL.
 *
 * A URL is convenient where the host hands you one (Neon, Railway, Heroku) and
 * awkward everywhere else: SQLite has no host or port, a password containing
 * '@' has to be escaped, and a socket path does not fit the shape at all. So
 * both are accepted — DATABASE_URL wins when present, and otherwise the parts
 * are read individually.
 */

export type Dialect = 'postgres' | 'mysql' | 'mariadb' | 'sqlite' | 'better-sqlite3';

const FROM_SCHEME: Record<string, Dialect> = {
    postgres: 'postgres',
    postgresql: 'postgres',
    mysql: 'mysql',
    mariadb: 'mariadb',
    sqlite: 'better-sqlite3',
    file: 'better-sqlite3'
};

function normalize(value: string | undefined): Dialect | undefined {
    if (!value) {
        return undefined;
    }
    const key = value.trim().toLowerCase();
    if (key === 'sqlite3' || key === 'sqlite') {
        return 'better-sqlite3';
    }
    return FROM_SCHEME[key] ?? (key as Dialect);
}

const url = process.env.DATABASE_URL?.trim() || undefined;

/** Which database. From DB_TYPE, or inferred from the URL's scheme. */
export const DIALECT: Dialect =
    normalize(process.env.DB_TYPE) ?? normalize(url?.split(':')[0]) ?? 'postgres';

export const IS_SQLITE = DIALECT === 'better-sqlite3' || DIALECT === 'sqlite';

/** SQLite takes a path; strip any scheme someone wrote out of habit. */
function sqlitePath(): string {
    const raw = url ?? process.env.DB_DATABASE ?? './inoa.sqlite';
    return raw.replace(/^(sqlite|file):(\/\/)?/, '');
}

/**
 * The hostname inside a connection URL, or '' when it will not parse.
 *
 * Parsed rather than pattern-matched. The locality test below used to run over
 * the whole connection string, so a password, database name or query parameter
 * containing 'localhost' silently disabled TLS against a remote server — a
 * check that fails open, which is the wrong direction for one guarding
 * transport security.
 */
export function hostFromUrl(rawUrl: string): string {
    try {
        return new URL(rawUrl).hostname;
    } catch {
        return '';
    }
}

/** Is this host this machine? Exact, because 'localhost' as a substring is not. */
export function isLoopbackHost(host: string): boolean {
    const bare = host.replace(/^\[|\]$/g, '').toLowerCase();
    return bare === 'localhost' || bare === '::1' || /^127\./.test(bare);
}

/**
 * Where we will actually connect.
 *
 * Derived once and shared, because ssl() and connectionOptions() used to decide
 * this separately and could disagree: with DB_HOST unset, ssl() tested '' —
 * which is not loopback — and turned TLS on, while connectionOptions() fell
 * back to 'localhost' and connected there. A local Postgres then answered 'the
 * server does not support SSL connections', which names neither cause.
 */
export function targetHost(): string {
    if (url) {
        return hostFromUrl(url);
    }
    return process.env.DB_HOST ?? 'localhost';
}

/**
 * Whether to negotiate TLS.
 *
 * DB_SSL settles it when set. Otherwise: a local database does not need it and
 * a remote one almost always does, which is the right default for a managed
 * Postgres and harmless to override.
 *
 * A URL that will not parse is treated as remote. We cannot tell where it
 * points, and enabling TLS against a local server fails loudly, where skipping
 * it against a remote one fails silently.
 */
export function ssl(): false | { rejectUnauthorized: boolean } {
    const explicit = process.env.DB_SSL?.trim().toLowerCase();
    if (explicit === 'false' || explicit === '0' || explicit === 'off') {
        return false;
    }
    if (explicit === 'true' || explicit === '1' || explicit === 'on') {
        return { rejectUnauthorized: process.env.DB_SSL_REJECT_UNAUTHORIZED !== 'false' };
    }

    /*
     * PGSSLMODE, because that is the variable the host tells you to set.
     *
     * Neon's own snippet hands you PGSSLMODE=require, and this read DB_SSL and
     * nothing else — so the setting did nothing and TLS happened only by way of
     * the remote-host default below. That worked by luck rather than by
     * instruction, which is the kind of thing that stops working quietly.
     *
     * verify-ca and verify-full check the chain; require does not, which is
     * libpq's own distinction and not one to improve on here.
     */
    const mode = process.env.PGSSLMODE?.trim().toLowerCase();
    if (mode === 'disable') {
        return false;
    }
    if (mode === 'verify-ca' || mode === 'verify-full') {
        return { rejectUnauthorized: true };
    }
    if (mode === 'require') {
        return { rejectUnauthorized: process.env.DB_SSL_REJECT_UNAUTHORIZED === 'true' };
    }

    return isLoopbackHost(targetHost()) ? false : { rejectUnauthorized: false };
}

/**
 * Whether to offer SCRAM-SHA-256-PLUS, which is what channel binding is.
 *
 * node-postgres will not do it unless asked: `enableChannelBinding` defaults to
 * false, and without it the driver never offers the -PLUS mechanism at all. A
 * Neon database configured with channel_binding=require then refuses the
 * connection, and PGCHANNELBINDING does not help because that is a libpq
 * variable and this driver is not libpq.
 *
 * On by default, which matches libpq's own `prefer`. It costs nothing where it
 * is not wanted: the driver only uses the mechanism when the server offers it,
 * and falls back to plain SCRAM-SHA-256 otherwise. It also needs TLS — there is
 * no certificate to bind to without it — so this is paired with ssl() below.
 */
export function channelBinding(): boolean {
    const mode = (process.env.PGCHANNELBINDING ?? process.env.DB_CHANNEL_BINDING)
        ?.trim()
        .toLowerCase();
    return mode !== 'disable' && mode !== 'false' && mode !== 'off' && mode !== '0';
}

/** The connection half of the DataSource options, whatever the driver. */
export function connectionOptions(): Record<string, unknown> {
    if (IS_SQLITE) {
        return { database: sqlitePath() };
    }

    /*
     * `extra` rather than a top-level option, because that is the only bag
     * TypeORM forwards to the pg pool untouched — anything it does not
     * recognise itself is dropped.
     */
    const secure = ssl();
    const extra = secure && channelBinding() ? { extra: { enableChannelBinding: true } } : {};

    if (url) {
        return { url, ssl: secure, ...extra };
    }
    return {
        host: process.env.DB_HOST ?? 'localhost',
        port: Number(process.env.DB_PORT ?? (DIALECT === 'postgres' ? 5432 : 3306)),
        username: process.env.DB_USERNAME ?? process.env.DB_USER,
        password: process.env.DB_PASSWORD,
        database: process.env.DB_DATABASE ?? process.env.DB_NAME ?? 'inoa',
        ssl: secure,
        ...extra
    };
}
