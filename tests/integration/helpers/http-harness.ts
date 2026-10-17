/**
 * Real client-to-server boundary harness for the album integration suite.
 *
 * What is real here: the Hono routes (createApp), session authentication, the
 * D1-backed persistence (better-sqlite3 shim over the exact baseline migration
 * SQL), the @aoi/shared wire serialization, and the real protocol crypto from
 * features/album. Requests travel over HTTP (ephemeral localhost port via
 * @hono/node-server) through the ACTUAL AlbumProtocolClient
 * (features/album/protocol-client) — the test file mocks only the thin
 * Expo token-plumbing module (@/features/api-client), pointing its
 * apiFetch/apiFetchBytes at this server with an explicit Bearer token. The
 * Authorization header, the JSON wire, and every status code are real.
 *
 * What is NOT real here (documented, not hidden):
 * - The presigned-PUT leg to object storage. In this suite the ciphertext is
 *   written to the harness R2 shim directly after a real reservation, which
 *   simulates the device upload that already succeeded. The signed conditional
 *   PUT against real object storage is covered by r2-conditional-put.test.ts.
 * - Expo SecureStore / Metro / the native app. Those are the E2E layer's job.
 */
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Server } from 'node:http';
import { serve } from '@hono/node-server';

import { createApp } from '../../../packages/api/src/create-app';
import {
  makeTestHarness,
  type ShimD1,
  type TestHarness,
} from '../../../packages/api/src/effects/test-harness';

export const USER_A = '00000000-0000-4000-8000-000000000001';
export const USER_B = '00000000-0000-4000-8000-000000000002';
export const SPACE_ID = '00000000-0000-4000-8000-000000000010';
export const TOKEN_A = 'boundary-token-alice';
export const TOKEN_B = 'boundary-token-bob';
export const NOW = Date.parse('2026-01-15T00:00:00.000Z');
const YEAR_MS = 365 * 24 * 60 * 60 * 1000;

export interface BoundaryServer {
  readonly harness: TestHarness;
  readonly baseUrl: string;
  readonly spaceId: string;
  close(): Promise<void>;
}

function seed(d1: ShimD1): void {
  // Idempotent: a reboot against a file-backed D1 reuses the accounts,
  // sessions, and Space the first boot created — exactly like a real restart.
  const user = (id: string, email: string, name: string) =>
    d1.runSync(
      'insert into users (id, email, name, email_verified, created_at, updated_at) values (?, ?, ?, 1, ?, ?) on conflict(id) do nothing',
      id,
      email,
      name,
      NOW,
      NOW
    );
  user(USER_A, 'alice@example.com', 'Alice');
  user(USER_B, 'bob@example.com', 'Bob');
  const session = (id: string, userId: string, token: string) =>
    d1.runSync(
      'insert into user_sessions (id, user_id, token, expires_at, created_at, updated_at) values (?, ?, ?, ?, ?, ?) on conflict(id) do nothing',
      id,
      userId,
      token,
      NOW + YEAR_MS,
      NOW,
      NOW
    );
  session('sess-alice', USER_A, TOKEN_A);
  session('sess-bob', USER_B, TOKEN_B);
  d1.runSync(
    `insert into spaces (id, name, partner_name, relationship_start_date, created_by_user_id, created_at, updated_at)
     values (?, 'Our Space', 'Partner', '2026-01-01', ?, ?, ?) on conflict(id) do nothing`,
    SPACE_ID,
    USER_A,
    NOW,
    NOW
  );
  d1.runSync(
    `insert into space_members (space_id, user_id, role, state, joined_at) values (?, ?, 'you', 'active', ?) on conflict(space_id, user_id) do nothing`,
    SPACE_ID,
    USER_A,
    NOW
  );
  d1.runSync(
    `insert into space_members (space_id, user_id, role, state, joined_at) values (?, ?, 'partner', 'active', ?) on conflict(space_id, user_id) do nothing`,
    SPACE_ID,
    USER_B,
    NOW
  );
}

/**
 * Boot the real app on an ephemeral port. Each call gets an isolated D1
 * (memory, unless `filename` is given for restart-persistence tests).
 */
export async function startBoundaryServer(options?: { filename?: string }): Promise<BoundaryServer> {
  const harness = makeTestHarness({ filename: options?.filename });
  seed(harness.d1);
  const app = createApp(harness.layer);
  const server = serve({ fetch: app.fetch, port: 0 }) as Server;
  await new Promise<void>((resolve) => server.once('listening', resolve));
  const address = server.address();
  const port = typeof address === 'object' && address !== null ? address.port : 0;
  return {
    harness,
    baseUrl: `http://127.0.0.1:${port}`,
    spaceId: SPACE_ID,
    close: () =>
      new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve()))
      ),
  };
}

/** A fresh temp-file D1 path shared across a restart (server stop + reboot). */
export function tempD1File(): string {
  return join(mkdtempSync(join(tmpdir(), 'aoi-boundary-')), 'd1.sqlite');
}

/** Which token the mocked api-client plumbing should send. Test-scoped. */
export function setBoundaryToken(token: string): void {
  const current = (globalThis as { __albumBoundaryAuth?: { baseUrl?: string } })
    .__albumBoundaryAuth;
  (globalThis as { __albumBoundaryAuth?: { token: string; baseUrl?: string } })
    .__albumBoundaryAuth = { baseUrl: current?.baseUrl, token } as {
    token: string;
    baseUrl?: string;
  };
}

export function setBoundaryBaseUrl(baseUrl: string): void {
  const current = (globalThis as { __albumBoundaryAuth?: { token?: string } })
    .__albumBoundaryAuth;
  (globalThis as { __albumBoundaryAuth?: { token?: string; baseUrl: string } })
    .__albumBoundaryAuth = { token: current?.token, baseUrl } as {
    token?: string;
    baseUrl: string;
  };
}
