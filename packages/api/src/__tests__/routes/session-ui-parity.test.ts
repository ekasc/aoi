import { describe, expect, it, vi } from 'vitest';
import { createMomentResponseRequestSchema, momentResponseSchema, partnerDetailSchema } from '@aoi/shared';

import { createApp } from '../../create-app';
import { makeTestHarness } from '../../effects/test-harness';

const A = '00000000-0000-4000-8000-000000000101';
const B = '00000000-0000-4000-8000-000000000102';
const C = '00000000-0000-4000-8000-000000000103';
const SPACE = '00000000-0000-4000-8000-000000000110';
const MOMENT = '00000000-0000-4000-8000-000000000120';
const MEDIA = '00000000-0000-4000-8000-000000000130';
const NOW = Date.parse('2026-01-15T00:00:00.000Z');

function setup() {
  const harness = makeTestHarness();
  const app = createApp(harness.layer);
  for (const [id, name] of [[A, 'Aoi'], [B, 'June'], [C, 'Outsider']]) {
    harness.d1.runSync('insert into users (id, email, name, email_verified, created_at, updated_at) values (?, ?, ?, 1, ?, ?)', id, `${id}@example.test`, name, NOW, NOW);
    harness.d1.runSync('insert into user_sessions (id, user_id, token, expires_at, created_at, updated_at) values (?, ?, ?, ?, ?, ?)', `session-${id}`, id, `token-${id}`, Date.parse('2030-01-01T00:00:00.000Z'), NOW, NOW);
  }
  harness.d1.runSync('insert into spaces (id, name, partner_name, relationship_start_date, created_by_user_id, created_at, updated_at) values (?, ?, ?, ?, ?, ?, ?)', SPACE, 'Us', 'June', '2024-01-01', A, NOW, NOW);
  for (const id of [A, B]) harness.d1.runSync("insert into space_members (space_id, user_id, role, state, joined_at) values (?, ?, ?, 'active', ?)", SPACE, id, id === A ? 'you' : 'partner', NOW);
  harness.d1.runSync("insert into moments (id, space_id, created_by_user_id, author_role, author_name, type, title, body, occurred_at, created_at, updated_at) values (?, ?, ?, 'you', 'Aoi', 'note', 'Together', 'A memory', ?, ?, ?)", MOMENT, SPACE, A, NOW, NOW, NOW);
  const request = (path: string, user = A, method = 'GET', body?: unknown) => app.request(path, {
    method, headers: { Authorization: `Bearer token-${user}`, 'Content-Type': 'application/json' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const insertMedia = (owner = A, mime = 'image/jpeg', state = 'complete') => harness.d1.runSync(`insert into media_objects
    (id, space_id, created_by_user_id, filename, mime_type, size_bytes, storage_key, upload_state, created_at)
    values (?, ?, ?, 'file', ?, 100, ?, ?, ?)`, MEDIA, SPACE, owner, mime, `media/${MEDIA}/original`, state, NOW);
  return { ...harness, app, request, insertMedia };
}

const RESPONSE_PATH = `/v1/moments/${MOMENT}/responses`;
const DETAILS_PATH = '/v1/users/me/partner-details';

describe('Worker UI parity', () => {
  it('requires authentication and returns honest empty collections', async () => {
    const { app, request } = setup();
    for (const path of [RESPONSE_PATH, DETAILS_PATH, '/v1/spaces/current/responses']) expect((await app.request(path)).status).toBe(401);
    expect(await (await request(RESPONSE_PATH)).json()).toEqual({ responses: [] });
    expect(await (await request(DETAILS_PATH)).json()).toEqual({ details: [] });
    expect(await (await request('/v1/spaces/current/responses')).json()).toEqual({ responses: [] });
  });

  it('pages space responses without duplicate or missing ties and excludes inaccessible memories', async () => {
    const { request, d1 } = setup();
    for (let index = 0; index < 5; index += 1) {
      expect((await request(RESPONSE_PATH, A, 'POST', { kind: 'word', body: `Word ${index}` })).status).toBe(201);
    }
    const ids: string[] = [];
    let cursor: string | undefined;
    for (let page = 0; page < 3; page += 1) {
      const response = await request('/v1/spaces/current/responses?limit=2' + (cursor ? `&cursor=${cursor}` : ''));
      expect(response.status).toBe(200);
      const body = await response.json();
      ids.push(...body.responses.map((r: { id: string }) => r.id));
      cursor = body.nextCursor;
    }
    expect(ids).toHaveLength(5);
    expect(new Set(ids).size).toBe(5);
    expect(cursor).toBeUndefined();
    expect(await (await request('/v1/spaces/current/responses', C)).json()).toEqual({ responses: [] });
    expect((await request('/v1/spaces/current/responses?limit=101')).status).toBe(400);
    expect((await request(`/v1/spaces/current/responses?cursor=${C}`)).status).toBe(400);
    d1.runSync('update moments set deleted_at = ? where id = ?', NOW, MOMENT);
    expect(await (await request('/v1/spaces/current/responses')).json()).toEqual({ responses: [] });
  });

  it('creates tap and words with session-authored, viewer-relative attribution', async () => {
    const { request } = setup();
    const tap = await request(RESPONSE_PATH, A, 'POST', { kind: 'tap' });
    expect(tap.status).toBe(201);
    expect(momentResponseSchema.parse(await tap.json())).toMatchObject({ kind: 'tap', authorId: A, authorRole: 'you', body: null });
    const words = await request(RESPONSE_PATH, B, 'POST', { kind: 'word', body: '  Remember this?  ' });
    expect(words.status).toBe(201);
    const listed = await (await request(RESPONSE_PATH)).json();
    expect(listed.responses).toHaveLength(2);
    expect(listed.responses.find((r: { kind: string }) => r.kind === 'word')).toMatchObject({ body: 'Remember this?', authorId: B, authorName: 'June', authorRole: 'partner' });
  });

  it.each([
    { kind: 'word', body: ' ' }, { kind: 'word', body: 'x'.repeat(401) },
    { kind: 'tap', authorId: B }, { kind: 'photo', mediaPreview: 'file:///private.jpg' },
    { kind: 'voice', audioUri: 'https://outside.test/voice' }, { kind: 'photo', mediaId: 'not-an-id' },
  ])('rejects an invalid or forged response payload %j', async (body) => {
    const { request } = setup();
    const response = await request(RESPONSE_PATH, A, 'POST', body);
    expect(response.status).toBe(400);
    expect((await response.json()).error.code).toBe('BAD_REQUEST');
  });

  it('hides memories from outsiders, former members, and after deletion', async () => {
    const { request, d1 } = setup();
    for (const method of ['GET', 'POST']) expect((await request(RESPONSE_PATH, C, method, method === 'POST' ? { kind: 'tap' } : undefined)).status).toBe(404);
    d1.runSync("update space_members set state = 'left' where user_id = ?", B);
    expect((await request(RESPONSE_PATH, B)).status).toBe(404);
    d1.runSync('update moments set deleted_at = ? where id = ?', NOW, MOMENT);
    expect((await request(RESPONSE_PATH)).status).toBe(404);
    expect((await request(RESPONSE_PATH, A, 'POST', { kind: 'tap' })).status).toBe(404);
  });

  it.each([['photo', 'image/jpeg', 'mediaPreview', 'display'], ['voice', 'audio/m4a', 'audioUri', 'original']] as const)(
    'accepts an own uploaded %s and derives a protected URL', async (kind, mime, field, variant) => {
      const { request, insertMedia } = setup();
      insertMedia(A, mime);
      const response = await request(RESPONSE_PATH, A, 'POST', { kind, mediaId: MEDIA });
      expect(response.status).toBe(201);
      expect((await response.json())[field]).toBe(`/v1/media/${MEDIA}/object?variant=${variant}`);
    }
  );

  it.each([[B, 'image/jpeg', 'complete', 404], [A, 'audio/m4a', 'complete', 400], [A, 'image/jpeg', 'pending', 400]] as const)(
    'rejects other-owner, wrong-kind, or incomplete media', async (owner, mime, state, status) => {
      const { request, insertMedia } = setup();
      insertMedia(owner, mime, state);
      expect((await request(RESPONSE_PATH, A, 'POST', { kind: 'photo', mediaId: MEDIA })).status).toBe(status);
    }
  );

  it('releases response-only media when its memory is deleted', async () => {
    const { request, insertMedia, d1 } = setup();
    insertMedia();
    expect((await request(RESPONSE_PATH, A, 'POST', { kind: 'photo', mediaId: MEDIA })).status).toBe(201);
    expect((await request(`/v1/moments/${MOMENT}`, A, 'DELETE')).status).toBe(200);
    expect(await d1.prepare('select id from moment_responses').first()).toBeNull();
    expect((await d1.prepare('select deleted_at from media_objects where id = ?').bind(MEDIA).first<{ deleted_at: number }>())?.deleted_at).not.toBeNull();
  });

  it('preserves a media object while another live memory response still references it', async () => {
    const { request, insertMedia, d1 } = setup();
    insertMedia();
    const other = '00000000-0000-4000-8000-000000000121';
    d1.runSync(`insert into moments (id, space_id, created_by_user_id, author_role, author_name, type, title, body, occurred_at, created_at, updated_at)
      values (?, ?, ?, 'you', 'Aoi', 'note', 'Other', 'Words', ?, ?, ?)`, other, SPACE, A, NOW, NOW, NOW);
    for (const id of [MOMENT, other]) {
      expect((await request(`/v1/moments/${id}/responses`, A, 'POST', { kind: 'photo', mediaId: MEDIA })).status).toBe(201);
    }
    expect((await request(`/v1/moments/${MOMENT}`, A, 'DELETE')).status).toBe(200);
    expect((await d1.prepare('select deleted_at from media_objects where id = ?').bind(MEDIA).first<{ deleted_at: number | null }>())?.deleted_at).toBeNull();
    expect((await (await request(`/v1/moments/${other}/responses`)).json()).responses).toHaveLength(1);
  });

  it('rejects deleted or other-space media and archived spaces', async () => {
    const { request, insertMedia, d1 } = setup();
    insertMedia();
    d1.runSync('update media_objects set deleted_at = ? where id = ?', NOW, MEDIA);
    expect((await request(RESPONSE_PATH, A, 'POST', { kind: 'photo', mediaId: MEDIA })).status).toBe(404);
    const other = '00000000-0000-4000-8000-000000000111';
    d1.runSync('insert into spaces (id, name, partner_name, relationship_start_date, created_by_user_id, created_at, updated_at) values (?, ?, ?, ?, ?, ?, ?)', other, 'Other', 'Partner', '2024-01-01', C, NOW, NOW);
    d1.runSync('update media_objects set deleted_at = null, space_id = ? where id = ?', other, MEDIA);
    expect((await request(RESPONSE_PATH, A, 'POST', { kind: 'photo', mediaId: MEDIA })).status).toBe(404);
    d1.runSync('update spaces set archived_at = ? where id = ?', NOW, SPACE);
    expect((await request(RESPONSE_PATH)).status).toBe(404);
  });

  it('enforces response payload and private-detail constraints in SQLite too', () => {
    const { d1 } = setup();
    expect(() => d1.runSync("insert into moment_responses (id, moment_id, created_by_user_id, kind, body, created_at) values ('bad-response', ?, ?, 'word', null, ?)", MOMENT, A, NOW)).toThrow();
    expect(() => d1.runSync("insert into partner_details (id, user_id, text, category, created_at) values ('bad-detail', ?, ' ', 'other', ?)", A, NOW)).toThrow();
  });

  it('rechecks membership and media liveness in the write after initial validation', async () => {
    for (const change of ['membership', 'media']) {
      const { request, insertMedia, d1 } = setup();
      insertMedia();
      const prepare = d1.prepare.bind(d1);
      const spy = vi.spyOn(d1, 'prepare').mockImplementation((sql) => {
        if (sql.startsWith('insert into moment_responses')) {
          if (change === 'membership') d1.runSync("update space_members set state = 'left' where user_id = ?", A);
          else d1.runSync('update media_objects set deleted_at = ? where id = ?', NOW, MEDIA);
        }
        return prepare(sql);
      });
      expect((await request(RESPONSE_PATH, A, 'POST', { kind: 'photo', mediaId: MEDIA })).status).toBe(404);
      spy.mockRestore();
      expect(await d1.prepare('select id from moment_responses').first()).toBeNull();
    }
  });

  it('creates private details and forbids even the partner from deleting them', async () => {
    const { request } = setup();
    const response = await request(DETAILS_PATH, A, 'POST', { text: '  Tea, no sugar  ', category: 'favorite' });
    expect(response.status).toBe(201);
    const detail = partnerDetailSchema.parse(await response.json());
    expect(detail.text).toBe('Tea, no sugar');
    expect(await (await request(DETAILS_PATH, B)).json()).toEqual({ details: [] });
    expect((await request(`${DETAILS_PATH}/${detail.id}`, B, 'DELETE')).status).toBe(404);
    expect(await (await request(DETAILS_PATH)).json()).toEqual({ details: [detail] });
    expect((await request(`${DETAILS_PATH}/${detail.id}`, A, 'DELETE')).status).toBe(200);
    expect(await (await request(DETAILS_PATH)).json()).toEqual({ details: [] });
  });

  it.each([{ text: '' }, { text: 'x'.repeat(401) }, { text: 'ok', category: 'unknown' }, { text: 'ok', userId: B }])('rejects invalid detail input %j', async (body) => {
    const { request } = setup();
    expect((await request(DETAILS_PATH, A, 'POST', body)).status).toBe(400);
  });

  it('purges private details on account deletion but retains shared response attribution anonymously', async () => {
    const { request, d1 } = setup();
    await request(DETAILS_PATH, A, 'POST', { text: 'Private detail' });
    await request(RESPONSE_PATH, A, 'POST', { kind: 'word', body: 'Shared memory' });
    expect((await request('/v1/auth/account', A, 'DELETE')).status).toBe(200);
    expect(await d1.prepare('select id from partner_details where user_id = ?').bind(A).first()).toBeNull();
    const listed = await (await request(RESPONSE_PATH, B)).json();
    expect(listed.responses[0]).toMatchObject({ body: 'Shared memory', authorName: 'Deleted member' });
  });

  it('publishes the request/response schemas and routes in OpenAPI', async () => {
    const { app } = setup();
    const spec = await (await app.request('/docs')).json();
    expect(spec.paths['/v1/moments/{id}/responses'].post).toBeTruthy();
    expect(spec.paths['/v1/users/me/partner-details'].get).toBeTruthy();
    expect(spec.components.schemas.MomentResponse).toBeTruthy();
    expect(createMomentResponseRequestSchema.safeParse({ kind: 'tap', body: 'extra' }).success).toBe(false);
  });
});
