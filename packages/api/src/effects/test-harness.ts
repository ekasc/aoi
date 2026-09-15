import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import Database from 'better-sqlite3';
import { Effect, Layer } from 'effect';

import type {
  D1Database,
  D1PreparedStatement,
  D1Result,
  QueueProducer,
  R2Bucket,
  R2GetOptions,
  R2Object,
  R2ObjectBody,
  R2ObjectListResult,
  R2PutOptions,
} from '../env';
import { makeTestClock } from './clock';
import { makeTestId } from './id';
import { makeConfigLayer } from './config';
import { makeCaptureLogger } from './logger';
import { Db, makeDbService } from './d1';
import { RateLimiter, makeRateLimiterService } from '../services/rate-limit';
import { Observability, makeObservabilityService } from '../services/observability';
import { DlqSender, makeDlqSenderLayer, QueueHandlers, makeNoopQueueHandlersLayer } from '../programs/queue';
import { JobQueue } from '../services/job-queue';
import { MediaStore, makeMediaStoreService } from '../services/media-store';
import type { QueueJob } from '../programs/queue';
import { BetterAuth, makeBetterAuthService } from '../auth/better-auth';
import type { RuntimeLayer } from './runtime';

/**
 * better-sqlite3-backed D1 shim.
 *
 * Implements the structural D1Database interface (prepare/batch/exec) on top
 * of a real SQLite file so domain/constraint tests run against the exact
 * baseline migration SQL — fast, deterministic, and identical to what D1
 * executes. Foreign keys are enabled (D1 default, pinned by the Db service).
 */

export function loadBaselineSql(): string {
  // Resolve relative to this module: packages/api/drizzle-d1/<baseline>.sql
  const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'drizzle-d1');
  const files = fs
    .readdirSync(dir)
    .filter((name) => /^\d{4}_.*\.sql$/.test(name))
    .sort();
  if (files.length === 0) {
    throw new Error(`D1 migrations not found in ${dir} — run pnpm --filter @aoi/api db:generate:d1`);
  }
  // All migration files in journal order (0000 baseline + increments), the
  // same sequence `wrangler d1 migrations apply` executes.
  return files
    .map((file) => fs.readFileSync(path.join(dir, file), 'utf8'))
    .join('\n');
}

class ShimPreparedStatement implements D1PreparedStatement {
  private params: unknown[] = [];

  constructor(private readonly stmt: Database.Statement) {}

  bind(...values: unknown[]): D1PreparedStatement {
    this.params = values;
    return this;
  }

  async all<T = unknown>(): Promise<D1Result<T[]>> {
    return { success: true, results: this.stmt.all(...this.params) as T[] };
  }

  async first<T = unknown>(): Promise<T | null> {
    const row = this.stmt.get(...this.params);
    return (row ?? null) as T | null;
  }

  async run<T = unknown>(): Promise<D1Result<T>> {
    return this.runSync<T>();
  }

  async raw<T = unknown>(): Promise<T[]> {
    return this.stmt.raw().all(...this.params) as T[];
  }

  /** Synchronous run (used inside the batch transaction). */
  runSync<T = unknown>(): D1Result<T> {
    const info = this.stmt.run(...this.params);
    return {
      success: true,
      results: [] as unknown as T,
      meta: { changes: info.changes, last_row_id: Number(info.lastInsertRowid) },
    };
  }
}

export class ShimD1 implements D1Database {
  private readonly sqlite: Database.Database;

  constructor(filename = ':memory:') {
    this.sqlite = new Database(filename);
    this.sqlite.pragma('journal_mode = WAL');
    this.sqlite.pragma('foreign_keys = ON');
  }

  prepare(sql: string): D1PreparedStatement {
    return new ShimPreparedStatement(this.sqlite.prepare(sql));
  }

  async batch(statements: D1PreparedStatement[]): Promise<D1Result[]> {
    return this.sqlite.transaction(() =>
      statements.map((s) => (s as ShimPreparedStatement).runSync())
    )();
  }

  async exec(sql: string): Promise<D1Result> {
    this.sqlite.exec(sql);
    return { success: true };
  }

  /** Apply a SQL migration/DDL script (the drizzle baseline). */
  apply(sql: string): void {
    this.sqlite.exec(sql);
  }

  /**
   * Synchronous run for tests that assert constraint violations (D1's run()
   * is async; sync throws surface naturally in `toThrow` assertions).
   */
  runSync(sql: string, ...params: unknown[]): D1Result {
    const stmt = new ShimPreparedStatement(this.sqlite.prepare(sql));
    stmt.bind(...params);
    return stmt.runSync();
  }

  /** Direct access for tests that need raw asserts. */
  get rawDb(): Database.Database {
    return this.sqlite;
  }
}

export function createTestD1(baselineSql?: string): ShimD1 {
  const d1 = new ShimD1();
  d1.apply(baselineSql ?? loadBaselineSql());
  return d1;
}

// ── Test layer composition ────────────────────────────────────────────────

export interface FakeQueues {
  readonly dlq: QueueProducer;
  readonly capturedDlq: Array<unknown>;
}

export function makeFakeDlq(): FakeQueues {
  const capturedDlq: Array<unknown> = [];
  return {
    capturedDlq,
    dlq: {
      send: async (message) => {
        capturedDlq.push(message);
      },
      sendBatch: async () => {},
    },
  };
}

export interface TestHarness {
  readonly d1: ShimD1;
  readonly clock: ReturnType<typeof makeTestClock>;
  readonly ids: ReturnType<typeof makeTestId>;
  readonly logger: ReturnType<typeof makeCaptureLogger>;
  readonly layer: RuntimeLayer;
  readonly queues: FakeQueues;
  /** In-memory R2 shim (seed objects with `r2.putSync`). */
  readonly r2: ShimR2;
  /** Jobs enqueued through the JobQueue service. */
  readonly capturedQueue: QueueJob[];
}

/**
 * Auth config for tests: fixed secret + placeholder provider creds. Real
 * credentials are user-owned gates (wrangler secret put) — tests never need
 * them because sign-in idToken verification is provider-key-bound (mocked
 * away) and session resolution is a DB lookup against minted rows.
 */
const TEST_AUTH_CONFIG: Record<string, string | undefined> = {
  BETTER_AUTH_SECRET: 'test-secret-32-chars-minimum-length-000',
  BETTER_AUTH_URL: 'http://worker.local',
  APP_BASE_URL: 'http://worker.local',
  APP_ENV: 'test',
  GOOGLE_CLIENT_ID: 'placeholder.google.client',
  GOOGLE_CLIENT_SECRET: 'placeholder-secret',
  APPLE_CLIENT_ID: 'placeholder.apple.client',
  APPLE_CLIENT_SECRET: 'placeholder-secret',
  // Media pipeline: presigning is pure signature math (no network), so
  // placeholder creds exercise the real code path.
  R2_ACCOUNT_ID: 'test-account',
  R2_ACCESS_KEY_ID: 'test-access-key',
  R2_SECRET_ACCESS_KEY: 'test-secret-key',
  R2_BUCKET: 'aoi-media',
  // Billing (P8A): placeholder webhook secret exercises the real auth path;
  // never a real secret.
  REVENUECAT_WEBHOOK_SECRET: 'test-revenuecat-webhook-secret',
  REVENUECAT_PLUS_ENTITLEMENT_ID: 'plus',
};

/**
 * In-memory R2 shim — implements the structural R2Bucket interface so the
 * media pipeline (head/get/put/delete/list + range) runs in node tests.
 */
export class ShimR2 implements R2Bucket {
  readonly objects = new Map<string, { bytes: Uint8Array; contentType?: string; uploaded?: Date }>();
  readonly puts: Array<{ key: string; contentType?: string }> = [];
  readonly deletes: string[] = [];

  putSync(key: string, bytes: Uint8Array, contentType?: string, uploaded?: Date): void {
    this.objects.set(key, { bytes, contentType, uploaded });
  }

  private toObject(key: string, entry: { bytes: Uint8Array; contentType?: string; uploaded?: Date }, offset: number, size: number): R2ObjectBody {
    const bytes = entry.bytes;
    const sliced = bytes.subarray(offset, offset + size);
    return {
      key,
      size,
      httpEtag: `etag-${key}-${size}`,
      uploaded: entry.uploaded ? new Date(entry.uploaded) : new Date(0),
      httpMetadata: entry.contentType ? { contentType: entry.contentType } : undefined,
      writeHttpMetadata() {},
      body: new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(sliced);
          controller.close();
        },
      }),
    };
  }

  async head(key: string): Promise<R2Object | null> {
    const entry = this.objects.get(key);
    if (!entry) return null;
    return {
      key,
      size: entry.bytes.byteLength,
      httpEtag: `etag-${key}-${entry.bytes.byteLength}`,
      uploaded: entry.uploaded ? new Date(entry.uploaded) : new Date(0),
      httpMetadata: entry.contentType ? { contentType: entry.contentType } : undefined,
      writeHttpMetadata() {},
    };
  }

  async get(key: string, options?: R2GetOptions): Promise<R2ObjectBody | null> {
    const entry = this.objects.get(key);
    if (!entry) return null;
    const total = entry.bytes.byteLength;
    if (!options?.range) {
      return this.toObject(key, entry, 0, total);
    }
    const range = options.range;
    if ('offset' in range) {
      const offset = range.offset ?? 0;
      const size = range.length !== undefined ? Math.min(range.length, total - offset) : total - offset;
      if (size <= 0) return null;
      return this.toObject(key, entry, offset, size);
    }
    const offset = Math.max(total - range.suffix, 0);
    const size = Math.min(range.suffix, total);
    if (size <= 0) return null;
    return this.toObject(key, entry, offset, size);
  }

  async put(key: string, value: ReadableStream | ArrayBuffer | ArrayBufferView | string, options?: R2PutOptions): Promise<R2Object> {
    let bytes: Uint8Array;
    if (typeof value === 'string') {
      bytes = new TextEncoder().encode(value);
    } else if (value instanceof ArrayBuffer) {
      bytes = new Uint8Array(value);
    } else if (value instanceof Uint8Array) {
      bytes = value;
    } else {
      bytes = new Uint8Array(await new Response(value as ReadableStream).arrayBuffer());
    }
    this.objects.set(key, { bytes, contentType: options?.httpMetadata?.contentType });
    this.puts.push({ key, contentType: options?.httpMetadata?.contentType });
    return {
      key,
      size: bytes.byteLength,
      httpEtag: `etag-${key}-${bytes.byteLength}`,
      uploaded: new Date(0),
      writeHttpMetadata() {},
    };
  }

  async delete(key: string): Promise<void> {
    this.objects.delete(key);
    this.deletes.push(key);
  }

  async list(options?: { prefix?: string; limit?: number; cursor?: string }): Promise<R2ObjectListResult> {
    const prefix = options?.prefix ?? '';
    const keys = [...this.objects.keys()].filter((key) => key.startsWith(prefix)).sort();
    let start = 0;
    if (options?.cursor !== undefined) {
      // Cursor is the first key of the next page (as returned previously).
      // Start at the first key >= cursor so deletions between pages cannot
      // cause a stall or skip-back. Unknown cursors start at the end.
      const idx = keys.findIndex((key) => key >= (options.cursor as string));
      start = idx === -1 ? keys.length : idx;
    }
    const limit = options?.limit ?? keys.length - start;
    const page = keys.slice(start, start + limit);
    const end = start + page.length;
    const truncated = end < keys.length;
    return {
      objects: page.map((key) => ({
        key,
        size: this.objects.get(key)!.bytes.byteLength,
        httpEtag: `etag-${key}`,
        uploaded: this.objects.get(key)!.uploaded
          ? new Date(this.objects.get(key)!.uploaded as Date)
          : new Date(0),
        writeHttpMetadata() {},
      })),
      truncated,
      cursor: truncated ? keys[end] : undefined,
    };
  }
}

/**
 * Build a full test layer stack: real SQLite D1 (baseline applied), settable
 * clock, deterministic ids, capture logger, permissive rate limiter, capture
 * DLQ + queue, in-memory R2, no-op queue handlers.
 */
export function makeTestHarness(options?: { baselineSql?: string; initialMs?: number }): TestHarness {
  const d1 = createTestD1(options?.baselineSql);
  const clock = makeTestClock(options?.initialMs ?? Date.parse('2026-01-15T00:00:00.000Z'));
  const ids = makeTestId(1);
  const logger = makeCaptureLogger();
  const queues = makeFakeDlq();
  const capturedQueue: Array<QueueJob> = [];
  const queueProducer: QueueProducer = {
    send: async (message) => {
      capturedQueue.push(message as QueueJob);
    },
    sendBatch: async () => {},
  };
  const r2 = new ShimR2();
  const rateLimiter = makeRateLimiterService(() => undefined);
  const configValues: Record<string, string | undefined> = {
    ...TEST_AUTH_CONFIG,
    CORS_ORIGIN: '*',
    LOG_LEVEL: 'debug',
  };
  const mediaStore = makeMediaStoreService(r2, { get: (key) => configValues[key] }, 'aoi-media');

  const layer = Layer.mergeAll(
    clock.layer,
    ids.layer,
    makeConfigLayer(configValues),
    logger.layer,
    Layer.succeed(Db, makeDbService(d1)),
    Layer.succeed(BetterAuth, makeBetterAuthService(d1, {
      get: (key) => TEST_AUTH_CONFIG[key],
      getNumber: () => undefined,
      require: (key) => {
        const value = TEST_AUTH_CONFIG[key];
        if (value === undefined || value === '') {
          throw new Error(`missing test config: ${key}`);
        }
        return value;
      },
    })),
    Layer.succeed(RateLimiter, rateLimiter),
    Layer.succeed(Observability, makeObservabilityService({ logger: logger.service })),
    Layer.succeed(DlqSender, {
      send: (body) =>
        Effect.tryPromise({
          try: () => queues.dlq.send(body),
          catch: () => new Error('dlq send failed'),
        }).pipe(Effect.catchAll(() => Effect.void)),
    }),
    Layer.succeed(JobQueue, {
      enqueue: async (job) => {
        capturedQueue.push(job);
      },
    }),
    Layer.succeed(MediaStore, mediaStore),
    makeNoopQueueHandlersLayer()
  );

  return { d1, clock, ids, logger, layer, queues, r2, capturedQueue };
}
