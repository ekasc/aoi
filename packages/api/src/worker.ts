import { Effect, Layer } from 'effect';

import type { QueueBatchLike, WorkerCtx, WorkerEnv } from './env';
import { createApp } from './create-app';
import { buildRuntimeLayer } from './effects/runtime';
import { consumeQueueBatch } from './programs/queue';
import { scheduledProgram } from './programs/cron';

/**
 * Worker entry — the Cloudflare runtime boundary. Three handlers:
 * `fetch` (HTTP), `queue` (AOI_QUEUE consumer), `scheduled` (crons).
 * Every handler composes the runtime layer from `env` and runs a bounded
 * Effect program; nothing outside `programs/*` touches bindings directly.
 */

function runWithEnv<A, Err, Req>(
  env: WorkerEnv,
  ctx: WorkerCtx,
  program: Effect.Effect<A, Err, Req>
): Promise<A> {
  const layers = buildRuntimeLayer(env, ctx);
  // The program's requirements are a subset of the layer's services; the
  // cast bridges the generic boundary without erasing error types.
  return Effect.runPromise(
    Effect.provide(
      program as Effect.Effect<A, Err, never>,
      layers as Layer.Layer<never, never, never>
    ) as Effect.Effect<A, Err, never>
  );
}

export default {
  async fetch(request: Request, env: WorkerEnv, ctx: WorkerCtx): Promise<Response> {
    // The shell owns its runtime per-request (cheap: layers are plain value
    // builders; the D1/R2/queue bindings are handles, not connections).
    const app = createApp(buildRuntimeLayer(env, ctx));
    return app.fetch(request, env, ctx as never);
  },

  async queue(batch: QueueBatchLike, env: WorkerEnv, ctx: WorkerCtx): Promise<void> {
    await runWithEnv(env, ctx, consumeQueueBatch(batch));
  },

  async scheduled(controller: { cron: string }, env: WorkerEnv, ctx: WorkerCtx): Promise<void> {
    await runWithEnv(env, ctx, scheduledProgram(controller.cron, ctx));
  },
};
