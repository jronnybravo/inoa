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
function ssl(): false | { rejectUnauthorized: boolean } {
    const explicit = process.env.DB_SSL?.trim().toLowerCase();
    if (explicit === 'false' || explicit === '0' || explicit === 'off') {
        return false;
    }
    if (explicit === 'true' || explicit === '1' || explicit === 'on') {
        return { rejectUnauthorized: process.env.DB_SSL_REJECT_UNAUTHORIZED !== 'false' };
    }
    return isLoopbackHost(targetHost()) ? false : { rejectUnauthorized: false };
}

/** The connection half of the DataSource options, whatever the driver. */
export function connectionOptions(): Record<string, unknown> {
    if (IS_SQLITE) {
        return { database: sqlitePath() };
    }
    if (url) {
        return { url, ssl: ssl() };
    }
    return {
        host: process.env.DB_HOST ?? 'localhost',
        port: Number(process.env.DB_PORT ?? (DIALECT === 'postgres' ? 5432 : 3306)),
        username: process.env.DB_USERNAME ?? process.env.DB_USER,
        password: process.env.DB_PASSWORD,
        database: process.env.DB_DATABASE ?? process.env.DB_NAME ?? 'inoa',
        ssl: ssl()
    };
}
