import 'dotenv/config';

import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import postgres from 'postgres';

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  console.error('DATABASE_URL environment variable is required');
  process.exit(1);
}

const migrationClient = postgres(databaseUrl, { max: 1 });
const db = drizzle(migrationClient);

async function runMigrations() {
  console.log('[migrate] running migrations...');
  await migrate(db, { migrationsFolder: './drizzle' });
  console.log('[migrate] migrations complete');
}

runMigrations()
  .then(() => {
    process.exit(0);
  })
  .catch((err) => {
    console.error('[migrate] failed:', err);
    process.exit(1);
  });
