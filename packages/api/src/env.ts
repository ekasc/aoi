/**
 * Typed Worker bindings and environments.
 *
 * The binding types are structural (deliberately NOT `@cloudflare/workers-types`):
 * - they keep typechecking working under both the app's root tsconfig and the
 *   API's own tsconfig without extra `types` wiring,
 * - the better-sqlite3 D1 shim (`effects/test-harness.ts`) implements the same
 *   structural shapes, so tests and the worker share one type vocabulary.
 *
 * All values are placeholders-by-default; real IDs/secrets come from the
 * dashboard / `wrangler secret put` (user-owned gates) — never from code.
 */

/** Minimal structural D1 prepared statement (subset we actually use). */
export interface D1PreparedStatement {
  bind(...values: unknown[]): D1PreparedStatement;
  all<T = unknown>(): Promise<D1Result<T[]>>;
  first<T = unknown>(): Promise<T | null>;
  run<T = unknown>(): Promise<D1Result<T>>;
  raw<T = unknown>(): Promise<T[]>;
}

export interface D1Result<T = unknown> {
  success: boolean;
  results?: T;
  meta?: {
    changes?: number;
    last_row_id?: number;
    duration?: number;
    size_after?: number;
  };
  error?: string;
}

/** Minimal structural D1 database binding (subset we actually use). */
export interface D1Database {
  prepare(sql: string): D1PreparedStatement;
  batch(statements: D1PreparedStatement[]): Promise<D1Result[]>;
  exec(sql: string): Promise<D1Result>;
}

/** Structural R2 bucket binding (head/get/put/delete + range). */
export interface R2Object {
  key: string;
  size: number;
  httpEtag: string;
  uploaded: Date;
  etag?: string;
  checksums?: Record<string, string>;
  customMetadata?: Record<string, string>;
  httpMetadata?: { contentType?: string; contentLanguage?: string; contentDisposition?: string; cacheControl?: string; cacheExpiry?: Date };
  writeHttpMetadata(headers: Headers): void;
}

export interface R2ObjectBody extends R2Object {
  body: ReadableStream;
}

export interface R2PutOptions {
  httpMetadata?: { contentType?: string; contentDisposition?: string };
  customMetadata?: Record<string, string>;
}

export interface R2GetOptions {
  range?: { offset: number; length?: number } | { suffix: number };
}

export interface R2ObjectListResult {
  objects: R2Object[];
  truncated: boolean;
  cursor?: string;
}

export interface R2Bucket {
  head(key: string): Promise<R2Object | null>;
  get(key: string, options?: R2GetOptions): Promise<R2ObjectBody | null>;
  put(key: string, value: ReadableStream | ArrayBuffer | ArrayBufferView | string, options?: R2PutOptions): Promise<R2Object>;
  delete(key: string): Promise<void>;
  list(options?: { prefix?: string; limit?: number; cursor?: string }): Promise<R2ObjectListResult>;
}

/** Structural Worker Rate Limiting binding. */
export interface RateLimitBinding {
  limit(options: { key: string }): Promise<{ success: boolean; reset: number; remaining: number }>;
}

/** Structural Analytics Engine dataset binding. */
export interface AnalyticsEngineDatasetBinding {
  writeDataPoint(event: {
    indexes?: string[];
    doubles?: number[];
    blobs?: Array<string | null>;
  }): void;
}

/** Structural Queue producer binding (send / sendBatch). */
export interface QueueProducer {
  send(message: unknown, options?: { contentType?: string; delaySeconds?: number; attempts?: number }): Promise<void>;
  sendBatch(messages: Array<{ id?: string; body: unknown }>): Promise<void>;
}

/** Structural queue message (as delivered to a consumer). */
export interface QueueMessageLike {
  id: string;
  timestamp: Date;
  body: unknown;
  attempts: number;
  ack(): void;
  retry(): void;
}

/** Structural queue batch delivered to the `queue` handler. */
export interface QueueBatchLike {
  messages: QueueMessageLike[];
  queue: string;
  retryAll(): void;
  ackAll(): void;
}

/** Named rate-limit tiers (one binding per tier in wrangler.jsonc). */
export const RATE_LIMIT_NAMES = [
  'AUTH',
  'GENERAL',
  'SQUEEZE',
  'LOCATION_REQUEST',
  'MEDIA',
] as const;

export type RateLimitName = (typeof RATE_LIMIT_NAMES)[number];

export type RateLimitBindings = Record<`RATE_LIMIT_${RateLimitName}`, RateLimitBinding>;

/**
 * Everything a request/program can read from the runtime. In production this
 * is the worker `env`; in tests a test double with the same shape.
 */
export interface WorkerEnv {
  DB: D1Database;
  MEDIA: R2Bucket;
  AOI_QUEUE: QueueProducer;
  AOI_QUEUE_DLQ: QueueProducer;
  AOI_ANALYTICS?: AnalyticsEngineDatasetBinding;
  RATE_LIMIT_AUTH: RateLimitBinding;
  RATE_LIMIT_GENERAL: RateLimitBinding;
  RATE_LIMIT_SQUEEZE: RateLimitBinding;
  RATE_LIMIT_LOCATION_REQUEST: RateLimitBinding;
  RATE_LIMIT_MEDIA: RateLimitBinding;
  /** App-level vars (wrangler `vars` / `[vars]`), not secrets. */
  CORS_ORIGIN?: string;
  APP_ENV?: string;
  APP_BASE_URL?: string;
  LOG_LEVEL?: string;
  /** Secrets — injected via `wrangler secret` / `.dev.vars`, never committed. */
  BETTER_AUTH_SECRET?: string;
  /** Canonical public origin for Better Auth (e.g. https://api.aoi.app). */
  BETTER_AUTH_URL?: string;
  GOOGLE_CLIENT_ID?: string;
  GOOGLE_CLIENT_SECRET?: string;
  APPLE_CLIENT_ID?: string;
  APPLE_CLIENT_SECRET?: string;
  R2_ACCOUNT_ID?: string;
  R2_ACCESS_KEY_ID?: string;
  R2_SECRET_ACCESS_KEY?: string;
  /** R2 bucket name (matches the wrangler r2_buckets entry; default aoi-media). */
  R2_BUCKET?: string;
  /** RevenueCat webhook dashboard secret (required for P8A billing). */
  REVENUECAT_WEBHOOK_SECRET?: string;
  /** RevenueCat entitlement id for Plus (defaults to 'plus' client+server). */
  REVENUECAT_PLUS_ENTITLEMENT_ID?: string;
}

/**
 * Execution context available to programs (worker `ctx` in production).
 * Exposes waitUntil + the scheduled controller signal.
 */
export interface WorkerCtx {
  waitUntil(promise: Promise<unknown>): void;
  passThroughOnException?(): void;
  abortSignal?: AbortSignal;
}
