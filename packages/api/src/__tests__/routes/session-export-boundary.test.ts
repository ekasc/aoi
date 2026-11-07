import { describe, expect, it } from 'vitest';

import { createApp } from '../../create-app';
import { makeTestHarness, type ShimD1 } from '../../effects/test-harness';

/**
 * Read contract the free raw-data export depends on (Astra #12). The
 * exporter uses only these already-authorized endpoints, so the boundary
 * below IS the export authorization boundary:
 * - Free users read every export dataset with no Plus anywhere;
 * - spaceless/archived callers get null current (nothing to export);
 * - sealed bodies are absent until opened, then present;
 * - tombstone authors resolve without erased identity;
 * - original media bytes require active membership.
 */

const USER_A = '00000000-0000-4000-8000-000000000001';
const USER_B = '00000000-0000-4000-8000-000000000002';
const USER_C = '00000000-0000-4000-8000-000000000003';
const TOKEN_A = 'token-a';
const TOKEN_B = 'token-b';
const TOKEN_C = 'token-c';
const NOW = Date.parse('2026-01-15T00:00:00.000Z');
const YEAR_MS = 365 * 24 * 60 * 60 * 1000;

function insertUser(d1: ShimD1, id: string, email: string, name: string): void {
  d1.runSync(
    'insert into users (id, email, name, email_verified, created_at, updated_at) values (?, ?, ?, 1, ?, ?)',
    id,
    email,
    name,
    NOW,
    NOW
  );
}

function insertSession(d1: ShimD1, id: string, userId: string, token: string): void {
  d1.runSync(
    'insert into user_sessions (id, user_id, token, expires_at, created_at, updated_at) values (?, ?, ?, ?, ?, ?)',
    id,
    userId,
    token,
    NOW + YEAR_MS,
    NOW,
    NOW
  );
}

function makeApp() {
  const harness = makeTestHarness();
  const app = createApp(harness.layer);
  return { harness, app };
}

function auth(token: string) {
  return { Authorization: `Bearer ${token}` };
}

async function setupPairedSpace(
  app: ReturnType<typeof makeApp>['app'],
  harness: ReturnType<typeof makeApp>['harness']
): Promise<string> {
  insertUser(harness.d1, USER_A, 'aoi@example.com', 'Aoi');
  insertUser(harness.d1, USER_B, 'partner@example.com', 'Partner');
  insertSession(harness.d1, 'sess-a', USER_A, TOKEN_A);
  insertSession(harness.d1, 'sess-b', USER_B, TOKEN_B);
  const created = await app.request('/v1/spaces', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...auth(TOKEN_A) },
    body: JSON.stringify({ name: 'Our Space', partnerName: 'Partner' }),
  });
  expect(created.status).toBe(201);
  const { inviteCode, space } = (await created.json()) as {
    inviteCode: string;
    space: { id: string };
  };
  const join = await app.request('/v1/spaces/join', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...auth(TOKEN_B) },
    body: JSON.stringify({ inviteCode }),
  });
  expect(join.status).toBe(200);
  return space.id;
}

async function getJson(app: ReturnType<typeof makeApp>['app'], path: string, token: string) {
  const res = await app.request(path, { headers: auth(token) });
  expect(res.status).toBe(200);
  return res.json() as Promise<unknown>;
}

