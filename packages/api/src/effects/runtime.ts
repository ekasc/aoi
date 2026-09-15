import { Effect, Layer } from 'effect';

import type { WorkerCtx, WorkerEnv } from '../env';
import { LiveClock } from './clock';
import { LiveId } from './id';
import { DEFAULT_DEV_VARS, makeConfigLayer } from './config';
import { Logger, makeLoggerService, type LogLevel } from './logger';
import { makeDbLayer } from './d1';
import { makeRateLimiterLayer } from '../services/rate-limit';
import { makeObservabilityLayer } from '../services/observability';
import { makeDlqSenderLayer } from '../programs/queue';
import { makeJobQueueLayer } from '../services/job-queue';
import { makeMediaStoreLayer } from '../services/media-store';
import { makeRealQueueHandlers } from '../programs/queue-consumer';
import { makeBetterAuthLayer } from '../auth/better-auth';

/**
 * Compose the full production layer stack from a WorkerEnv (and optional
 * ctx for waitUntil). Requirements are `never` — everything is supplied —
 * which is exactly what `createApp` / the worker entry need.
 */
export function buildRuntimeLayer(env: WorkerEnv, ctx?: WorkerCtx) {
  void ctx;
  const vars: Record<string, string | undefined> = { ...DEFAULT_DEV_VARS };
  for (const key of Object.keys(env)) {
    const value = (env as unknown as Record<string, unknown>)[key];
    if (typeof value === 'string') {
      vars[key] = value;
    }
  }
  const logger = makeLoggerService({ level: (env.LOG_LEVEL as LogLevel | undefined) ?? 'info' });
  const config = { get: (k: string) => vars[k], getNumber: (k: string) => {
    const raw = vars[k];
    if (raw === undefined || raw === '') return undefined;
    const n = Number(raw);
    return Number.isFinite(n) ? n : undefined;
  }, require: (k: string) => {
    const v = vars[k];
    if (v === undefined || v === '') throw new Error(`missing config: ${k}`);
    return v;
  } };

  const core = Layer.mergeAll(
    LiveClock,
    LiveId,
    makeConfigLayer(vars),
    Layer.succeed(Logger, logger),
    makeDbLayer(env.DB),
    makeBetterAuthLayer(env.DB, config),
    makeRateLimiterLayer(env),
    makeObservabilityLayer({ logger, analytics: env.AOI_ANALYTICS }),
    makeDlqSenderLayer(env.AOI_QUEUE_DLQ),
    makeJobQueueLayer(env.AOI_QUEUE),
    makeMediaStoreLayer(env.MEDIA, config, env.R2_BUCKET ?? 'aoi-media')
  );

  // Real queue handlers (push.deliver + media.sanitize) provide the core
  // layer per job invocation — programs declare their requirements and the
  // worker's single runtime supplies them.
  const handlers = makeRealQueueHandlers(core as unknown as Layer.Layer<never, never, never>);

  return Layer.mergeAll(core, handlers);
}

export type RuntimeLayer = ReturnType<typeof buildRuntimeLayer>;
