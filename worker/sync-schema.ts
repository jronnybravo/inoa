/**
 * Create or update the tables. Run explicitly:  npm run db:sync
 *
 * Deliberately a separate command rather than `synchronize: true`, so schema
 * changes never happen as a side effect of a request landing on a cold Vercel
 * instance.
 */
import 'dotenv/config';
import { db } from '../src/lib/server/db.ts';

// db() also attaches the DataSource to the entities, so BaseEntity works here.
const source = await db();
await source.synchronize();
console.log('schema synchronized');
await source.destroy();
