/**
 * Create or update the tables. Run explicitly:  npm run db:sync
 *
 * Deliberately a separate command rather than `synchronize: true`, so schema
 * changes never happen as a side effect of a request landing on a cold Vercel
 * instance.
 */
import 'dotenv/config';
import { dataSource } from '../src/lib/server/db.ts';

const source = await dataSource.initialize();
await source.synchronize();
console.log('schema synchronized');
await source.destroy();
