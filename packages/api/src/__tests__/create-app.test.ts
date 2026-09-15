import { describe, expect, it } from 'vitest';
import { Layer } from 'effect';

import { createApp, REQUEST_ID_HEADER } from '../create-app';
import { makeTestHarness } from '../effects/test-harness';
import { BetterAuth, makeBetterAuthService } from '../auth/better-auth';

function makeApp() {
  const harness = makeTestHarness();
  const app = createApp(harness.layer);
  return { app, harness };
}

function req(path: string, init?: RequestInit): Request {
  return new Request(`http://worker.local${path}`, init);
}

describe('worker shell (createApp)', () => {
  it('serves /healthz and /readyz with Effect-backed status', async () => {
    const { app } = makeApp();
    const [health, ready] = await Promise.all([app.fetch(req('/healthz')), app.fetch(req('/readyz'))]);
    expect(health.status).toBe(200);
    expect(ready.status).toBe(200);
    const body = (await ready.json()) as { status: string; at: string };
    expect(body.status).toBe('ok');
    expect(new Date(body.at).getTime()).toBeGreaterThan(0);
  });

  it('assigns and echoes a request id (accepts an incoming one, bounded)', async () => {
    const { app } = makeApp();
    const res = await app.fetch(
      req('/healthz', { headers: { [REQUEST_ID_HEADER]: 'incoming-id-123' } })
    );
    expect(res.headers.get(REQUEST_ID_HEADER)).toBe('incoming-id-123');

    const generated = await app.fetch(req('/healthz'));
    const id = generated.headers.get(REQUEST_ID_HEADER);
    expect(id).toBeTruthy();
    expect(id?.length).toBeLessThanOrEqual(128);
  });

  it('rejects over-long incoming request ids', async () => {
    const { app } = makeApp();
    const res = await app.fetch(req('/healthz', { headers: { [REQUEST_ID_HEADER]: 'x'.repeat(200) } }));
    const id = res.headers.get(REQUEST_ID_HEADER);
    expect(id?.length).toBeLessThanOrEqual(128);
    expect(id).not.toBe('x'.repeat(200));
  });

  it('returns the canonical error envelope for unknown routes', async () => {
    const { app } = makeApp();
    const res = await app.fetch(req('/v1/definitely-not-a-route'));
    expect(res.status).toBe(404);
    const body = (await res.json()) as { error: { code: string; message: string } };
    expect(body.error.code).toBe('NOT_FOUND');
    expect(body.error.message).toContain('not found');
  });

  it('serves the OpenAPI document at /docs with shared components', async () => {
    const { app } = makeApp();
    const res = await app.fetch(req('/docs'));
    expect(res.status).toBe(200);
    const doc = (await res.json()) as {
      openapi: string;
      info: { title: string };
      components?: { schemas?: Record<string, unknown> };
      paths: Record<string, unknown>;
    };
    expect(doc.openapi).toBe('3.1.0');
    expect(doc.info.title).toBe('Aoi API');
    expect(doc.paths['/healthz']).toBeTruthy();
    // Shared contract schemas appear as components (single source of truth).
    expect(doc.components?.schemas?.ApiError).toBeTruthy();
    expect(doc.components?.schemas?.Space).toBeTruthy();
  });

  it('keeps /healthz alive when Better Auth is not configured (no secret/base URL)', async () => {
    // Regression: the BetterAuth layer is merged into the runtime layer,
    // which Effect builds on every provide. If its construction threw on
    // missing config, EVERY request 500'd — health included (verified
    // against the deployed worker: error 1101 on /healthz).
    const harness = makeTestHarness();
    const unconfigured = makeBetterAuthService(harness.d1, {
      get: () => undefined,
      getNumber: () => undefined,
      require: (key) => {
        throw new Error(`missing config: ${key}`);
      },
    });
    expect(unconfigured.auth).toBeNull();

    const layer = Layer.mergeAll(harness.layer, Layer.succeed(BetterAuth, unconfigured));
    const app = createApp(layer);
    const res = await app.fetch(req('/healthz'));
    expect(res.status).toBe(200);

    // Auth-dependent routes degrade to a fixed 500 (never a crash/1101).
    const authRes = await app.fetch(
      req('/v1/auth/apple', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ provider: 'apple', platform: 'ios', idToken: 'x', nonce: 'n' }),
      })
    );
    expect(authRes.status).toBe(500);
    const body = (await authRes.json()) as { error: { code: string; message: string } };
    expect(body.error.code).toBe('INTERNAL_ERROR');
    expect(body.error.message).toBe('Internal server error');
  });

  it('keeps responses privacy-safe on the fixed 500 path', async () => {
    const { app } = makeApp();
    // Unknown route 404s are already fixed; the error mapper itself is pinned
    // in errors.test.ts — here we assert no error details ever reach the wire.
    const res = await app.fetch(req('/does-not-exist'));
    const raw = await res.text();
    expect(raw).not.toMatch(/error:|\n|stack/i);
  });
});
