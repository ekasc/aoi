import { describe, expect, it } from 'vitest';

import { createApp, makeRun } from '../../create-app';
import { e2eAuthRouter } from '../../routes/e2e-auth';
import { makeTestHarness, type ShimD1 } from '../../effects/test-harness';

const NOW = Date.parse('2026-01-15T00:00:00.000Z');
const USER = '00000000-0000-4000-8000-000000000001';
const EMAIL = 'alice.e2e@example.com';

/**
 * The E2E auth bootstrap is the one test-only seam in the API, so its gate
 * gets its own tests: unreachable without the flag (404), useless without
 * the per-run secret (401), unknown accounts refused (404), and a real
 * session row minted when everything holds — usable as a Bearer token on a
 * session-authenticated route. Everything past this endpoint runs unmodified
 * production code.
 */
function insertUser(d1: ShimD1): void {
  d1.runSync(
    'insert into users (id, email, name, email_verified, created_at, updated_at) values (?, ?, ?, 1, ?, ?)',
    USER,
    EMAIL,
    'Alice E2E',
    NOW,
    NOW
  );
}

async function post(
  app: ReturnType<typeof createApp>,
  body: unknown
): Promise<Response> {
  return app.request('/v1/auth/e2e/session', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

describe('the e2e session bootstrap gate', () => {
  it('is absent without the flag: 404 even with the right secret', async () => {
    const harness = makeTestHarness();
    insertUser(harness.d1);
    const app = createApp(harness.layer);
    app.route('/', e2eAuthRouter(makeRun(harness.layer)));
    const response = await post(app, { email: EMAIL, secret: 'run-secret' });
    expect(response.status).toBe(404);
  });

  it('refuses a wrong secret with 401 and an unknown account with 404', async () => {
    const harness = makeTestHarness({
      config: { AOI_E2E_MODE: 'true', AOI_E2E_SECRET: 'run-secret' },
    });
    insertUser(harness.d1);
    const app = createApp(harness.layer);
    app.route('/', e2eAuthRouter(makeRun(harness.layer)));
    expect(
      (await post(app, { email: EMAIL, secret: 'nope' })).status
    ).toBe(401);
    expect(
      (await post(app, { email: 'ghost@example.com', secret: 'run-secret' })).status
    ).toBe(404);
  });

  it('mints a real session the session middleware accepts', async () => {
    const harness = makeTestHarness({
      config: { AOI_E2E_MODE: 'true', AOI_E2E_SECRET: 'run-secret' },
    });
    insertUser(harness.d1);
    const app = createApp(harness.layer);
    app.route('/', e2eAuthRouter(makeRun(harness.layer)));
    const minted = await post(app, { email: EMAIL, secret: 'run-secret' });
    expect(minted.status).toBe(201);
    const { token, userId } = (await minted.json()) as { token: string; userId: string };
    expect(userId).toBe(USER);

    const row = await harness.d1
      .prepare('select user_id from user_sessions where token = ?')
      .bind(token)
      .first<{ user_id: string }>();
    expect(row?.user_id).toBe(USER);

    const authed = await app.request('/v1/spaces/current/album/protocol', {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(authed.status).toBe(200);
  });
});


describe('production route isolation', () => {
  it('does not expose test sign-in even if test configuration is accidentally supplied', async () => {
    const harness = makeTestHarness({ config: { AOI_E2E_MODE: 'true', AOI_E2E_SECRET: 'run-secret' } });
    insertUser(harness.d1);
    const app = createApp(harness.layer);
    const response = await post(app, { email: EMAIL, secret: 'run-secret' });
    expect(response.status).toBe(404);
    const sessions = await harness.d1.prepare('select count(*) as count from user_sessions').first<{ count: number }>();
    expect(sessions?.count).toBe(0);
  });
});
