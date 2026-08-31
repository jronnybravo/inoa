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
  if (!value) return undefined;
  const key = value.trim().toLowerCase();
  if (key === 'sqlite3' || key === 'sqlite') return 'better-sqlite3';
  return FROM_SCHEME[key] ?? (key as Dialect);
}

const url = process.env.DATABASE_URL?.trim() || undefined;

/** Which database. From DB_TYPE, or inferred from the URL's scheme. */
export const DIALECT: Dialect =
  normalize(process.env.DB_TYPE) ??
  normalize(url?.split(':')[0]) ??
  'postgres';

export const IS_SQLITE = DIALECT === 'better-sqlite3' || DIALECT === 'sqlite';

/** SQLite takes a path; strip any scheme someone wrote out of habit. */
function sqlitePath(): string {
  const raw = url ?? process.env.DB_DATABASE ?? './brandy.sqlite';
  return raw.replace(/^(sqlite|file):(\/\/)?/, '');
}

/**
 * Whether to negotiate TLS.
 *
 * DB_SSL settles it when set. Otherwise: a local database does not need it and
 * a remote one almost always does, which is the right default for a managed
 * Postgres and harmless to override.
 */
function ssl(): false | { rejectUnauthorized: boolean } {
  const explicit = process.env.DB_SSL?.trim().toLowerCase();
  if (explicit === 'false' || explicit === '0' || explicit === 'off') return false;
  if (explicit === 'true' || explicit === '1' || explicit === 'on') {
    return { rejectUnauthorized: process.env.DB_SSL_REJECT_UNAUTHORIZED !== 'false' };
  }
  const host = process.env.DB_HOST ?? url ?? '';
  const local = /localhost|127\.0\.0\.1|::1/.test(host);
  return local ? false : { rejectUnauthorized: false };
}

/** The connection half of the DataSource options, whatever the driver. */
export function connectionOptions(): Record<string, unknown> {
  if (IS_SQLITE) return { database: sqlitePath() };
  if (url) return { url, ssl: ssl() };
  return {
    host: process.env.DB_HOST ?? 'localhost',
    port: Number(process.env.DB_PORT ?? (DIALECT === 'postgres' ? 5432 : 3306)),
    username: process.env.DB_USERNAME ?? process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_DATABASE ?? process.env.DB_NAME ?? 'brandy',
    ssl: ssl()
  };
}
