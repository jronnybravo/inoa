/**
 * Column types that differ between databases.
 *
 * This project is meant to be deployed by other people on whatever they
 * already run, so nothing may assume Postgres. Three column types have no
 * portable spelling and are resolved here once, from the connection string:
 *
 *   - JSON: Postgres has jsonb, MySQL has json, SQLite has neither. TypeORM's
 *     'simple-json' serialises to text and works on all of them. It cannot be
 *     queried by key, which nothing here does.
 *   - Timestamps: Postgres wants timestamptz, MySQL and SQLite want datetime.
 *   - UUID keys: only Postgres has a uuid type. A char(36) holds the same
 *     value everywhere, and TypeORM still generates it.
 */

import { DIALECT } from './config.ts';

const isPostgres = DIALECT === 'postgres';

/** A JSON document. Stored as text off Postgres, which needs no key queries. */
export const JSON_TYPE = 'simple-json' as const;

/**
 * A short string that carries a default.
 *
 * MySQL refuses a DEFAULT on TEXT — 'BLOB, TEXT, GEOMETRY or JSON column can't
 * have a default value' — so every enumerated value here is a varchar. Only
 * free prose stays TEXT, and free prose never has a default.
 */
export const SHORT_TEXT = 'varchar' as const;
export const SHORT_TEXT_LENGTH = 64;

/** An instant. Postgres keeps the zone; the others store UTC in a datetime. */
export const TIMESTAMP_TYPE = isPostgres ? ('timestamptz' as const) : ('datetime' as const);

/** A generated primary key. char(36) is a uuid everywhere that lacks the type. */
export const UUID_TYPE = isPostgres ? ('uuid' as const) : ('varchar' as const);
export const UUID_LENGTH = isPostgres ? undefined : 36;
