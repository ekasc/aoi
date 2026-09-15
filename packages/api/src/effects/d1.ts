import { drizzle, type DrizzleD1Database } from 'drizzle-orm/d1';
import { Context, Effect, Layer } from 'effect';

import type { D1Database, D1PreparedStatement, D1Result } from '../env';
import { InternalError } from '../domains/errors';
import * as schema from '../db/d1-schema';

export type D1Schema = typeof schema;

/**
 * Db — the D1 service. Owns the drizzle instance and the raw binding, plus
 * the atomicity/idempotency primitives every domain program builds on:
 * - `batch` — D1's atomic multi-statement write (all-or-nothing),
 * - `guardedUpdate` — conditional UPDATE via raw SQL returning affected rows
 *   (the race-free way to implement guarded transitions such as one-time
 *   invite redemption or proposal accept),
 * - `assertForeignKeys` — pins `PRAGMA foreign_keys = ON` (D1 default).
 */
export interface DbService {
  readonly d1: D1Database;
  readonly db: DrizzleD1Database<D1Schema>;
  readonly batch: (statements: D1PreparedStatement[]) => Promise<D1Result[]>;
  readonly exec: (sql: string) => Promise<D1Result>;
  readonly assertForeignKeys: () => Promise<boolean>;
}

export class Db extends Context.Tag('aoi/Db')<DbService, DbService>() {}

export function makeDbService(d1: D1Database): DbService {
  const db = drizzle(d1, { schema });
  return {
    d1,
    db,
    batch: (statements) => d1.batch(statements),
    exec: (sql) => d1.exec(sql),
    assertForeignKeys: async () => {
      // D1 enables foreign keys by default; pin it explicitly so
      // ON DELETE cascade semantics are always in force.
      const row = await d1.prepare('PRAGMA foreign_keys').first<{ foreign_keys: number }>();
      return row?.foreign_keys === 1;
    },
  };
}

export const makeDbLayer = (d1: D1Database): Layer.Layer<DbService> =>
  Layer.succeed(Db, makeDbService(d1));

/** Effect accessor for the drizzle instance. */
export const drizzleDb = Effect.map(Db, (s) => s.db);

/** Effect accessor for the raw D1 binding. */
export const rawD1 = Effect.map(Db, (s) => s.d1);

/**
 * Assert `PRAGMA foreign_keys = ON`. Fails with a fixed InternalError when
 * the runtime has it off (misconfigured test shim or worker).
 */
export const assertForeignKeys = Effect.flatMap(Db, (s) =>
  Effect.tryPromise({
    try: async () => {
      const ok = await s.assertForeignKeys();
      if (!ok) {
        throw new Error('foreign_keys pragma is off');
      }
      return ok as true;
    },
    catch: () => new InternalError({}),
  })
);

/**
 * Atomic batch write. D1 executes the statements in one implicit transaction;
 * if any statement fails the whole batch rolls back. Used for guarded
 * transitions that must not split (e.g. invite redeem + member insert).
 */
export const batch = (statements: D1PreparedStatement[]): Effect.Effect<D1Result[], InternalError, DbService> =>
  Effect.flatMap(Db, (s) =>
    Effect.tryPromise({
      try: () => s.batch(statements),
      catch: () => new InternalError({}),
    })
  );

/**
 * Execute raw SQL (DDL/migration bootstrap). Fails with a fixed InternalError.
 */
export const exec = (sqlText: string): Effect.Effect<D1Result, InternalError, DbService> =>
  Effect.flatMap(Db, (s) =>
    Effect.tryPromise({
      try: () => s.exec(sqlText),
      catch: () => new InternalError({}),
    })
  );

/**
 * Prepare a statement from the bound D1 (keeps statements on the same
 * connection that `batch` uses).
 */
export const prepare = (sqlText: string): Effect.Effect<D1PreparedStatement, never, DbService> =>
  Effect.map(Db, (s) => s.d1.prepare(sqlText));

export interface GuardedUpdateResult {
  /** Number of rows actually updated (0 = guard failed → conflict). */
  changes: number;
}

/**
 * Guarded UPDATE — the idempotency primitive. Runs `UPDATE … WHERE guard`
 * and returns the affected-row count; a 0 means the guard was already
 * satisfied/released, which callers translate into the right 409/404/200.
 */
export const guardedUpdate = (sqlText: string, ...params: unknown[]): Effect.Effect<GuardedUpdateResult, InternalError, DbService> =>
  Effect.flatMap(Db, (s) =>
    Effect.tryPromise({
      try: async () => {
        const result = await s.d1.prepare(sqlText).bind(...params).run<unknown>();
        return { changes: result.meta?.changes ?? 0 };
      },
      catch: () => new InternalError({}),
    })
  );

/**
 * Upsert helper over the drizzle instance: insert on conflict-do-nothing and
 * return whether the row was actually inserted (idempotency signal).
 */
export const insertDoNothing = (
  statement: D1PreparedStatement
): Effect.Effect<{ inserted: boolean }, InternalError, DbService> =>
  Effect.tryPromise({
    try: async () => {
      const result = await statement.run<unknown>();
      return { inserted: (result.meta?.changes ?? 0) > 0 };
    },
    catch: () => new InternalError({}),
  });
