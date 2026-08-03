import { vi, describe, it, expect } from 'vitest';
import { app, req } from '../helpers/test-app.js';

vi.stubEnv('JWT_SECRET', 'test-jwt-secret-for-testing');
vi.stubEnv('CORS_ORIGIN', '*');

vi.mock('../../db/index.js', () => ({
  db: {
    select: vi.fn(() => ({ from: vi.fn(() => ({ where: vi.fn(() => ({ limit: vi.fn(() => Promise.resolve([])), then: (r: Function) => r([]) })) })) })),
    insert: vi.fn(() => ({ values: vi.fn(() => ({ returning: vi.fn(() => Promise.resolve([])), then: (r: Function) => r([]) })) })),
    update: vi.fn(() => ({ set: vi.fn(() => ({ where: vi.fn(() => ({ returning: vi.fn(() => Promise.resolve([])), then: (r: Function) => r([]) })) })) })),
  },
}));

describe('health endpoints', () => {
  it('GET /healthz returns ok', async () => {
    const res = await app.fetch(req('GET', '/healthz'));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ status: 'ok' });
  });

  it('GET /readyz returns ok', async () => {
    const res = await app.fetch(req('GET', '/readyz'));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ status: 'ok' });
  });

  it('both health endpoints are public (no auth required)', async () => {
    const [health, ready] = await Promise.all([
      app.fetch(req('GET', '/healthz')),
      app.fetch(req('GET', '/readyz')),
    ]);
    expect(health.status).toBe(200);
    expect(ready.status).toBe(200);
  });

  it('returns json content type', async () => {
    const res = await app.fetch(req('GET', '/healthz'));
    const ct = res.headers.get('content-type');
    expect(ct).toMatch(/application\/json/);
  });
});
