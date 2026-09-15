import { defineConfig } from 'drizzle-kit';

/**
 * D1 (sqlite) migration generation. Output lands in drizzle-d1/ (the
 * legacy drizzle/ dir holds Postgres migrations for the superseded node
 * API and stays untouched until that code is retired).
 */
export default defineConfig({
  schema: './src/db/d1-schema.ts',
  out: './drizzle-d1',
  dialect: 'sqlite',
});
