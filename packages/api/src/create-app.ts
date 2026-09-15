import { OpenAPIHono } from '@hono/zod-openapi';
import { cors } from 'hono/cors';
import { Effect, Layer } from 'effect';

import type { WorkerEnv } from './env';
import type { RuntimeLayer } from './effects/runtime';
import { toApiError } from './domains/errors';
import { livenessProgram, readinessProgram } from './programs/health';
import { Observability, type ObservabilityService } from './services/observability';
import { registerOpenApiRoutes } from './openapi';
import { BetterAuth } from './auth/better-auth';
import { authRouter } from './routes/session-auth';
import { plusRouter } from './routes/session-plus';
import { spacesRouter } from './routes/session-spaces';
import { momentsRouter } from './routes/session-moments';
import { pushRouter } from './routes/session-push';
import { mediaRouter } from './routes/session-media';
import { calendarRouter } from './routes/session-calendar';
import { proposalsRouter } from './routes/session-proposals';
import { lettersRouter } from './routes/session-letters';
import { questionRouter } from './routes/session-question';
import { somedayRouter } from './routes/session-someday';
import { locationRouter } from './routes/session-location';
import { preferencesRouter } from './routes/session-preferences';
import { milestonesRouter } from './routes/session-milestones';
import { squeezesRouter } from './routes/session-squeezes';

export interface AppEnv {
  Bindings: WorkerEnv;
  Variables: {
    requestId: string;
    userId?: string;
    sessionId?: string;
  };
}

export const REQUEST_ID_HEADER = 'x-request-id';

/**
 * Run a program with the full layer stack (per-call provide keeps this
 * cheap: layers are plain value builders, not connections).
 */
export type RunProgram = <A, Err, Req>(
  program: Effect.Effect<A, Err, Req>
) => Promise<A>;

export function makeRun(layers: RuntimeLayer): RunProgram {
  return ((program: Effect.Effect<unknown, unknown, unknown>) =>
    Effect.runPromise(
      Effect.provide(
        program as Effect.Effect<unknown, unknown, never>,
        layers as unknown as Layer.Layer<never, never, never>
      ) as Effect.Effect<unknown, unknown, never>
    )) as RunProgram;
}

/**
 * Build the Hono shell around an Effect runtime composed from the given
 * layers. Routes are thin transport: handlers run bounded Effect programs
 * through the runtime and the shared error mapper turns typed failures into
 * the canonical `{ error: { code, message } }` envelope.
 *
 * The legacy Node/Postgres app (`app.ts`) is untouched — this shell is the
 * Cloudflare migration target that later stages mount domain routes onto.
 */
export function createApp(layers: RuntimeLayer): OpenAPIHono<AppEnv> {
  const run = makeRun(layers);

  // Extract services once so middleware can use them without re-entering the
  // runtime per request. Guarded: if a caller omits a service, the dependent
  // path degrades gracefully (auth → 503, observability → skipped).
  let observability: ObservabilityService | null = null;
  try {
    observability = Effect.runSync(
      Effect.provide(
        Effect.map(Observability, (s) => s) as Effect.Effect<ObservabilityService, never, never>,
        layers as unknown as Layer.Layer<never, never, never>
      )
    );
  } catch {
    observability = null;
  }

  let authHandler: ((request: Request) => Promise<Response>) | null = null;
  try {
    const program = Effect.map(BetterAuth, (s) =>
      s.auth === null ? null : s.auth.handler
    ) as unknown as Effect.Effect<
      ((request: Request) => Promise<Response>) | null,
      never,
      never
    >;
    authHandler = Effect.runSync(
      Effect.provide(program, layers as unknown as Layer.Layer<never, never, never>)
    );
  } catch {
    authHandler = null;
  }

  const app = new OpenAPIHono<AppEnv>();

  // ── Request id (privacy-safe correlation) ──────────────────────────────
  app.use('*', async (c, next) => {
    const incoming = c.req.header(REQUEST_ID_HEADER);
    const requestId =
      incoming && incoming.length > 0 && incoming.length <= 128
        ? incoming
        : crypto.randomUUID();
    c.set('requestId', requestId);
    c.header(REQUEST_ID_HEADER, requestId);
    await next();
  });

  // ── CORS ───────────────────────────────────────────────────────────────
  app.use(
    '*',
    cors({
      origin: (_origin, c) => c.env?.CORS_ORIGIN ?? '*',
      credentials: true,
    })
  );

  // ── Health (public, Effect-backed) ─────────────────────────────────────
  app.get('/healthz', async (c) => c.json(await run(livenessProgram)));
  app.get('/readyz', async (c) => {
    try {
      return c.json(await run(readinessProgram));
    } catch {
      return c.json({ status: 'degraded' }, 503);
    }
  });

  // ── OpenAPI spec + documented routes ───────────────────────────────────
  registerOpenApiRoutes(app);
  app.doc('/docs', {
    openapi: '3.1.0',
    info: { title: 'Aoi API', version: '0.1.0' },
    servers: [{ url: '/' }],
  });

  // ── Better Auth endpoints (public, own handler) ───────────────────────
  // Mounted at the default /api/auth/* path. The handler is cookie/session
  // aware; the mobile app uses the /v1/auth/* adapters instead.
  app.all('/api/auth/*', async (c) => {
    if (!authHandler) {
      return c.json(
        { error: { code: 'INTERNAL_ERROR', message: 'Auth is not configured' } },
        500
      );
    }
    return authHandler(c.req.raw);
  });

  // ── Normalize @hono/zod-validator 400s into the canonical envelope ────
  // zValidator returns `{ success:false, error:{ issues } }` directly (it
  // does not throw), bypassing onError. Reshape to the contract shape with
  // a word-only message (schema messages are static strings; anything else
  // falls back to a fixed message — request content never reaches the wire).
  // Must be registered BEFORE the routes: Hono middleware only wraps paths
  // matched at registration time.
  app.use('*', async (c, next) => {
    await next();
    const res = c.res;
    if (res.status !== 400) return;
    if (!(res.headers.get('content-type') ?? '').includes('application/json')) return;
    const body = await res.clone().json().catch(() => null);
    if (!body || body.success !== false || !Array.isArray(body.error?.issues)) return;
    const issue = body.error.issues[0];
    const message =
      typeof issue?.message === 'string' &&
      /^[\w .,'!?-]{1,120}$/.test(issue.message)
        ? issue.message
        : 'Invalid request';
    c.res = c.json({ error: { code: 'BAD_REQUEST', message } }, 400);
  });

  // ── Domain routes (public auth adapters + protected spaces) ───────────
  app.route('/', authRouter(run));
  app.route('/', plusRouter(run));
  app.route('/', spacesRouter(run));
  app.route('/', momentsRouter(run));
  app.route('/', pushRouter(run));
  app.route('/', mediaRouter(run));
  app.route('/', calendarRouter(run));
  app.route('/', proposalsRouter(run));
  app.route('/', lettersRouter(run));
  app.route('/', questionRouter(run));
  app.route('/', somedayRouter(run));
  app.route('/', locationRouter(run));
  app.route('/', preferencesRouter(run));
  app.route('/', milestonesRouter(run));
  app.route('/', squeezesRouter(run));

  // ── Per-request observability (after routing; 404s count too) ─────────
  app.use('*', async (c, next) => {
    const started = Date.now();
    await next();
    if (observability) {
      try {
        observability.recordRequest({
          requestId: c.get('requestId'),
          method: c.req.method,
          path: c.req.path,
          status: c.res.status,
          durationMs: Date.now() - started,
        });
      } catch {
        // logging must never break a request
      }
    }
  });

  // ── Error mapper (privacy-safe envelope) ───────────────────────────────
  app.onError((err, c) => {
    const mapped = toApiError(err);
    if (observability) {
      try {
        observability.recordRequest({
          requestId: c.get('requestId'),
          method: c.req.method,
          path: c.req.path,
          status: mapped.status,
          durationMs: 0,
        });
      } catch {
        // ignore
      }
    }
    return c.json(mapped.body, mapped.status);
  });

  // ── 404 handler ────────────────────────────────────────────────────────
  app.notFound((c) => {
    const body = {
      error: { code: 'NOT_FOUND', message: `Route ${c.req.method} ${c.req.path} not found` },
    };
    return c.json(body, 404);
  });

  return app;
}
