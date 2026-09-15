import { describe, expect, it } from 'vitest';

import { createApp } from '../../create-app';
import { makeTestHarness, type ShimD1 } from '../../effects/test-harness';

/**
 * Route-level contracts for chapter reads: the bounded bucket summary
 * (`GET /v1/spaces/current/moments/summary`) and bounded chapter ranges
 * (`fromMs`/`toMs` on the moments list). No chapter persistence exists —
 * these tests pin the queryable path that keeps chapters as derived views.
 * The server performs zero timezone math: all bounds are absolute ms.
 */

const USER_A = '00000000-0000-4000-8000-000000000001';
const TOKEN_A = 'token-a';
const SPACE_ID = '00000000-0000-4000-8000-000000000010';

const T = (iso: string) => Date.parse(iso);

function insertUser(d1: ShimD1): void {
  d1.runSync(
    'insert into users (id, email, name, email_verified, created_at, updated_at) values (?, ?, ?, 1, ?, ?)',
    USER_A,
    'aoi@example.com',
    'Aoi',
    T('2026-01-15T00:00:00.000Z'),
    T('2026-01-15T00:00:00.000Z')
  );
  d1.runSync(
    'insert into user_sessions (id, user_id, token, expires_at, created_at, updated_at) values (?, ?, ?, ?, ?, ?)',
    'sess-a',
    USER_A,
    TOKEN_A,
    T('2027-02-01T00:00:00.000Z'),
    T('2026-01-15T00:00:00.000Z'),
    T('2026-01-15T00:00:00.000Z')
  );
  d1.runSync(
    'insert into spaces (id, name, partner_name, relationship_start_date, created_by_user_id, created_at, updated_at) values (?, ?, ?, ?, ?, ?, ?)',
    SPACE_ID,
    'Our Space',
    'Partner',
    '2024-06-15',
    USER_A,
    T('2026-01-15T00:00:00.000Z'),
    T('2026-01-15T00:00:00.000Z')
  );
  d1.runSync(
    "insert into space_members (space_id, user_id, role, state, joined_at) values (?, ?, 'you', 'active', ?)",
    SPACE_ID,
    USER_A,
    T('2026-01-15T00:00:00.000Z')
  );
}

function insertMoment(
  d1: ShimD1,
  id: string,
  occurredAtMs: number,
  opts?: { type?: string; mediaPreview?: string | null }
): void {
  d1.runSync(
    `insert into moments (id, space_id, created_by_user_id, author_role, author_name,
       type, title, body, occurred_at, target_at, media_preview, audio_uri,
       media_id, client_id, created_at, updated_at)
     values (?, ?, ?, 'you', 'You', ?, '', '', ?, null, ?, null, null, ?, ?, ?)`,
    id,
    SPACE_ID,
    USER_A,
    opts?.type ?? 'note',
    occurredAtMs,
    opts?.mediaPreview ?? null,
    `client-${id}`,
    occurredAtMs,
    occurredAtMs
  );
}

function makeApp() {
  const harness = makeTestHarness();
  const app = createApp(harness.layer);
  return { harness, app };
}

function auth() {
  return { Authorization: `Bearer ${TOKEN_A}` };
}

function bucketsParam(bounds: Array<[number, number]>): string {
  return encodeURIComponent(bounds.map(([from, to]) => `${from}:${to}`).join(','));
}

describe('chapter bucket summary (bounded, absolute bounds, no bodies)', () => {
  it('counts per bucket with earliest-photo covers, goals excluded, hasOlder explicit', async () => {
    const { harness, app } = makeApp();
    insertUser(harness.d1);
    insertMoment(harness.d1, '00000000-0000-4000-8000-000000000101', T('2026-08-04T10:00:00.000Z'));
    insertMoment(harness.d1, '00000000-0000-4000-8000-000000000102', T('2026-08-04T12:00:00.000Z'), {
      type: 'media',
      mediaPreview: 'https://cdn.test/second.jpg',
    });
    insertMoment(harness.d1, '00000000-0000-4000-8000-000000000103', T('2026-08-04T08:00:00.000Z'), {
      type: 'media',
      mediaPreview: 'https://cdn.test/first.jpg',
    });
    insertMoment(harness.d1, '00000000-0000-4000-8000-000000000104', T('2026-08-04T15:00:00.000Z'), {
      type: 'goal',
    });
    insertMoment(harness.d1, '00000000-0000-4000-8000-000000000105', T('2024-03-10T10:00:00.000Z'));

    const res = await app.request(
      `/v1/spaces/current/moments/summary?buckets=${bucketsParam([
        [T('2026-08-01T00:00:00.000Z'), T('2026-09-01T00:00:00.000Z')],
        [T('2026-09-01T00:00:00.000Z'), T('2026-10-01T00:00:00.000Z')],
      ])}`,
      { headers: auth() }
    );
    expect(res.status).toBe(200);
    const body = await res.json();

    expect(body.buckets).toEqual([
      {
        fromMs: T('2026-08-01T00:00:00.000Z'),
        toMs: T('2026-09-01T00:00:00.000Z'),
        count: 3,
        cover: 'https://cdn.test/first.jpg',
      },
      {
        fromMs: T('2026-09-01T00:00:00.000Z'),
        toMs: T('2026-10-01T00:00:00.000Z'),
        count: 0,
        cover: null,
      },
    ]);
    // The 2024 memory predates the earliest bucket: exhaustion is explicit.
    expect(body.hasOlder).toBe(true);
  });

  it('reports hasOlder false when nothing predates the buckets', async () => {
    const { harness, app } = makeApp();
    insertUser(harness.d1);
    insertMoment(harness.d1, '00000000-0000-4000-8000-000000000111', T('2026-08-04T10:00:00.000Z'));

    const res = await app.request(
      `/v1/spaces/current/moments/summary?buckets=${bucketsParam([
        [T('2026-08-01T00:00:00.000Z'), T('2026-09-01T00:00:00.000Z')],
      ])}`,
      { headers: auth() }
    );
    expect(res.status).toBe(200);
    expect((await res.json()).hasOlder).toBe(false);
  });

  it('rejects malformed, empty, oversized, and over-wide buckets', async () => {
    const { harness, app } = makeApp();
    insertUser(harness.d1);

    const malformed = await app.request('/v1/spaces/current/moments/summary?buckets=nope', {
      headers: auth(),
    });
    expect(malformed.status).toBe(400);

    const inverted = await app.request(
      `/v1/spaces/current/moments/summary?buckets=${bucketsParam([[2000, 1000]])}`,
      { headers: auth() }
    );
    expect(inverted.status).toBe(400);

    const tooWide = await app.request(
      `/v1/spaces/current/moments/summary?buckets=${bucketsParam([[0, 401 * 24 * 60 * 60 * 1000]])}`,
      { headers: auth() }
    );
    expect(tooWide.status).toBe(400);

    const tooMany = await app.request(
      `/v1/spaces/current/moments/summary?buckets=${bucketsParam(
        Array.from({ length: 25 }, (_, index) => [index * 10, index * 10 + 5] as [number, number])
      )}`,
      { headers: auth() }
    );
    expect(tooMany.status).toBe(400);
  });
});

describe('chapter ranges (bounded from/to reads)', () => {
  it('returns only in-range memories, excluding adjacent months and goals', async () => {
    const { harness, app } = makeApp();
    insertUser(harness.d1);
    const from = T('2026-08-01T00:00:00.000Z');
    const to = T('2026-09-01T00:00:00.000Z');
    insertMoment(harness.d1, '00000000-0000-4000-8000-000000000201', T('2026-07-31T23:00:00.000Z'));
    insertMoment(harness.d1, '00000000-0000-4000-8000-000000000202', T('2026-08-10T10:00:00.000Z'));
    insertMoment(harness.d1, '00000000-0000-4000-8000-000000000203', T('2026-08-20T10:00:00.000Z'), {
      type: 'media',
      mediaPreview: 'https://cdn.test/p.jpg',
    });
    insertMoment(harness.d1, '00000000-0000-4000-8000-000000000204', T('2026-08-15T10:00:00.000Z'), {
      type: 'goal',
    });
    insertMoment(harness.d1, '00000000-0000-4000-8000-000000000205', T('2026-09-01T00:00:00.000Z'));

    const res = await app.request(
      `/v1/spaces/current/moments?fromMs=${from}&toMs=${to}&limit=100`,
      { headers: auth() }
    );
    expect(res.status).toBe(200);
    const body = await res.json();

    // Newest-first; boundary + goal rows excluded.
    expect(body.moments.map((moment: { id: string }) => moment.id)).toEqual([
      '00000000-0000-4000-8000-000000000203',
      '00000000-0000-4000-8000-000000000202',
    ]);
    expect(body.nextCursor).toBeUndefined();
  });

  it('pages a multi-page range to completion with the cursor', async () => {
    const { harness, app } = makeApp();
    insertUser(harness.d1);
    const from = T('2026-08-01T00:00:00.000Z');
    const to = T('2026-09-01T00:00:00.000Z');
    const ids = [
      '00000000-0000-4000-8000-000000000301',
      '00000000-0000-4000-8000-000000000302',
      '00000000-0000-4000-8000-000000000303',
    ];
    insertMoment(harness.d1, ids[0], T('2026-08-03T10:00:00.000Z'));
    insertMoment(harness.d1, ids[1], T('2026-08-02T10:00:00.000Z'));
    insertMoment(harness.d1, ids[2], T('2026-08-01T10:00:00.000Z'));

    const first = await app.request(
      `/v1/spaces/current/moments?fromMs=${from}&toMs=${to}&limit=2`,
      { headers: auth() }
    );
    expect(first.status).toBe(200);
    const firstBody = await first.json();
    expect(firstBody.moments.map((moment: { id: string }) => moment.id)).toEqual([ids[0], ids[1]]);
    expect(typeof firstBody.nextCursor).toBe('string');

    const second = await app.request(
      `/v1/spaces/current/moments?fromMs=${from}&toMs=${to}&limit=2&cursor=${encodeURIComponent(firstBody.nextCursor)}`,
      { headers: auth() }
    );
    expect(second.status).toBe(200);
    const secondBody = await second.json();
    expect(secondBody.moments.map((moment: { id: string }) => moment.id)).toEqual([ids[2]]);
    expect(secondBody.nextCursor).toBeUndefined();
  });

  it('rejects invalid ranges', async () => {    const { harness, app } = makeApp();
    insertUser(harness.d1);

    const inverted = await app.request(
      '/v1/spaces/current/moments?fromMs=2000&toMs=1000',
      { headers: auth() }
    );
    expect(inverted.status).toBe(400);

    const tooWide = await app.request(
      `/v1/spaces/current/moments?fromMs=0&toMs=${401 * 24 * 60 * 60 * 1000}`,
      { headers: auth() }
    );
    expect(tooWide.status).toBe(400);
  });

  it('filters by moment type for Plans-owned goal reads', async () => {
    const { harness, app } = makeApp();
    insertUser(harness.d1);
    insertMoment(harness.d1, '00000000-0000-4000-8000-000000000401', T('2026-08-10T10:00:00.000Z'), {
      type: 'goal',
    });
    insertMoment(harness.d1, '00000000-0000-4000-8000-000000000402', T('2026-08-11T10:00:00.000Z'));

    const res = await app.request('/v1/spaces/current/moments?type=goal&limit=100', {
      headers: auth(),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.moments.map((moment: { id: string }) => moment.id)).toEqual([
      '00000000-0000-4000-8000-000000000401',
    ]);
    expect(body.nextCursor).toBeUndefined();

    const invalid = await app.request('/v1/spaces/current/moments?type=dreams', {
      headers: auth(),
    });
    expect(invalid.status).toBe(400);
  });
});
