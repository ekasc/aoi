import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { HTTPException } from 'hono/http-exception';
import type { ApiError } from '@aoi/shared';
import { authMiddleware } from './middleware/auth.js';
import { rateLimit } from './middleware/rate-limit.js';
import { auth } from './routes/auth.js';
import { spacesRouter } from './routes/spaces.js';
import { momentsRouter } from './routes/moments.js';
import { activityRouter } from './routes/activity.js';
import { calendarRouter } from './routes/calendar.js';
import { somedayRouter } from './routes/someday.js';
import { questionRouter } from './routes/question.js';
import { milestonesRouter } from './routes/milestones.js';
import { preferencesRouter } from './routes/preferences.js';
import { mediaRouter } from './routes/media.js';
import { pushRouter } from './routes/push.js';
import { squeezesRouter } from './routes/squeezes.js';
import { locationRouter } from './routes/location.js';

const app = new Hono();

// ── Global middleware ────────────────────────────────────────────────────

app.use('*', cors({
  origin: process.env.CORS_ORIGIN ?? '*',
  credentials: true,
}));

// ── Health (always public, before auth middleware) ───────────────────────

app.get('/healthz', (c) => c.json({ status: 'ok' }));
app.get('/readyz', (c) => c.json({ status: 'ok' }));

// ── Auth (public OAuth endpoints) ────────────────────────────────────────

app.route('/', auth);

// ── Auth middleware for all protected v1 endpoints ──────────────────────

app.use('/v1/*', authMiddleware);

// ── General rate limiting (100 req/min per authenticated user) ──────────

app.use('/v1/*', rateLimit({
  max: 100,
  windowSec: 60,
  keyFn: (c) => c.var.userId ?? 'unknown',
}));

// ── Protected routes ────────────────────────────────────────────────────

app.route('/', spacesRouter);
app.route('/', momentsRouter);
app.route('/', activityRouter);
app.route('/', calendarRouter);
app.route('/', somedayRouter);
app.route('/', questionRouter);
app.route('/', milestonesRouter);
app.route('/', preferencesRouter);
app.route('/', mediaRouter);
app.route('/', pushRouter);
app.route('/', squeezesRouter);
app.route('/', locationRouter);

// ── Global error handler ─────────────────────────────────────────────────

app.onError((err, c) => {
  if (err instanceof HTTPException) {
    const errorResponse: ApiError = {
      error: {
        code: httpCodeToErrorCode(err.status),
        message: err.message,
      },
    };
    return c.json(errorResponse, err.status);
  }

  console.error('Unhandled error:', err instanceof Error ? err.message : String(err));
  const errorResponse: ApiError = {
    error: {
      code: 'INTERNAL_ERROR',
      message: 'Internal server error',
    },
  };
  return c.json(errorResponse, 500);
});

// ── 404 handler ──────────────────────────────────────────────────────────

app.notFound((c) => {
  const errorResponse: ApiError = {
    error: {
      code: 'NOT_FOUND',
      message: `Route ${c.req.method} ${c.req.path} not found`,
    },
  };
  return c.json(errorResponse, 404);
});

function httpCodeToErrorCode(status: number): string {
  switch (status) {
    case 400: return 'BAD_REQUEST';
    case 401: return 'UNAUTHORIZED';
    case 403: return 'FORBIDDEN';
    case 404: return 'NOT_FOUND';
    case 409: return 'CONFLICT';
    case 429: return 'TOO_MANY_REQUESTS';
    default: return 'INTERNAL_ERROR';
  }
}

export { app };
