import { vi, describe, it, expect } from 'vitest';
import { Hono } from 'hono';
import { HTTPException } from 'hono/http-exception';
import { rateLimit } from '../middleware/rate-limit.js';

function makeApp(max = 5) {
  const key = `test-${Math.random().toString(36).slice(2)}`;
  const app = new Hono();
  app.use('*', rateLimit({
    max,
    windowSec: 60,
    keyFn: () => key,
  }));
  app.get('/test', (c) => c.json({ ok: true }));
  app.onError((err, c) => {
    if (err instanceof HTTPException) {
      return c.json({ error: { code: 'TOO_MANY_REQUESTS', message: err.message } }, err.status);
    }
    return c.json({ error: { code: 'INTERNAL_ERROR', message: 'Internal error' } }, 500);
  });
  return app;
}

describe('rate limit middleware', () => {
  it('allows requests within the limit', async () => {
    const app = makeApp();
    for (let i = 0; i < 5; i++) {
      const res = await app.fetch(new Request('http://localhost/test'));
      expect(res.status).toBe(200);
    }
  });

  it('blocks request exceeding the limit', async () => {
    const app = makeApp();
    for (let i = 0; i < 5; i++) {
      await app.fetch(new Request('http://localhost/test'));
    }
    const res = await app.fetch(new Request('http://localhost/test'));
    expect(res.status).toBe(429);
  });

  it('sets rate limit headers', async () => {
    const app = makeApp();
    const res = await app.fetch(new Request('http://localhost/test'));
    expect(res.headers.get('X-RateLimit-Limit')).toBe('5');
    expect(res.headers.get('X-RateLimit-Remaining')).toBe('4');
    expect(res.headers.get('X-RateLimit-Reset')).toBeTruthy();
  });

  it('uses different keys independently', async () => {
    const appA = makeApp(2);
    const appB = makeApp(2);

    expect((await appA.fetch(new Request('http://localhost/test'))).status).toBe(200);
    expect((await appB.fetch(new Request('http://localhost/test'))).status).toBe(200);
    expect((await appA.fetch(new Request('http://localhost/test'))).status).toBe(200);
    expect((await appA.fetch(new Request('http://localhost/test'))).status).toBe(429);
    expect((await appB.fetch(new Request('http://localhost/test'))).status).toBe(200);
  });

  it('returns JSON error body on 429', async () => {
    const app = makeApp();
    for (let i = 0; i < 5; i++) {
      await app.fetch(new Request('http://localhost/test'));
    }
    const res = await app.fetch(new Request('http://localhost/test'));
    const body = await res.json();
    expect(body).toHaveProperty('error');
    expect(body.error).toHaveProperty('code', 'TOO_MANY_REQUESTS');
  });

  it('resets after window expires', async () => {
    vi.useFakeTimers();
    const app = makeApp();
    for (let i = 0; i < 5; i++) {
      await app.fetch(new Request('http://localhost/test'));
    }

    let res = await app.fetch(new Request('http://localhost/test'));
    expect(res.status).toBe(429);

    vi.advanceTimersByTime(61_000);

    res = await app.fetch(new Request('http://localhost/test'));
    expect(res.status).toBe(200);
    vi.useRealTimers();
  });
});
