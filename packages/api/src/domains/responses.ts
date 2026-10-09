import { Effect } from 'effect';
import { mediaObjectUrl, type CreateMomentResponseRequest, type MomentResponse, type MomentResponsePageQuery } from '@aoi/shared';

import { Db } from '../effects/d1';
import { nowMs } from '../effects/clock';
import { newId } from '../effects/id';
import { InternalError, badRequest, notFound } from './errors';
import { getActiveSpaceId } from './spaces';

interface ResponseRow {
  id: string;
  moment_id: string;
  created_by_user_id: string;
  author_name: string;
  kind: MomentResponse['kind'];
  body: string | null;
  media_id: string | null;
  created_at: number;
}

const VISIBLE_MOMENT = `select m.space_id from moments m
  join spaces s on s.id = m.space_id and s.archived_at is null
  join space_members sm on sm.space_id = m.space_id and sm.user_id = ? and sm.state = 'active'
  where m.id = ? and m.deleted_at is null`;

function serialize(row: ResponseRow, userId: string): MomentResponse {
  return {
    id: row.id,
    momentId: row.moment_id,
    authorId: row.created_by_user_id,
    authorRole: row.created_by_user_id === userId ? 'you' : 'partner',
    authorName: row.created_by_user_id === userId ? 'You' : row.author_name,
    kind: row.kind,
    body: row.body,
    mediaPreview: row.kind === 'photo' && row.media_id ? mediaObjectUrl(row.media_id, 'display') : null,
    audioUri: row.kind === 'voice' && row.media_id ? mediaObjectUrl(row.media_id, 'original') : null,
    createdAt: new Date(row.created_at).toISOString(),
  };
}

export const listResponsesProgram = (userId: string, momentId: string) => Effect.gen(function* () {
  const db = yield* Db;
  const visible = yield* Effect.tryPromise({
    try: () => db.d1.prepare(VISIBLE_MOMENT).bind(userId, momentId).first(),
    catch: () => new InternalError({}),
  });
  if (!visible) return yield* Effect.fail(notFound('Memory not found'));
  const rows = yield* Effect.tryPromise({
    try: () => db.d1.prepare(`select r.*, u.name as author_name from moment_responses r
      join users u on u.id = r.created_by_user_id
      where r.moment_id = ? and exists (${VISIBLE_MOMENT})
      order by r.created_at desc, r.id desc`).bind(momentId, userId, momentId).all<ResponseRow>(),
    catch: () => new InternalError({}),
  });
  return (rows.results ?? []).map((row) => serialize(row, userId));
});

export const listSpaceResponsesProgram = (userId: string, query: MomentResponsePageQuery) => Effect.gen(function* () {
  const db = yield* Db;
  const spaceId = yield* getActiveSpaceId(userId);
  if (!spaceId) return { responses: [] };
  const select = `select r.*, u.name as author_name from moment_responses r
    join moments m on m.id = r.moment_id and m.deleted_at is null
    join spaces s on s.id = m.space_id and s.archived_at is null
    join space_members sm on sm.space_id = m.space_id and sm.user_id = ? and sm.state = 'active'
    join users u on u.id = r.created_by_user_id where m.space_id = ?`;
  let cursor: ResponseRow | null = null;
  if (query.cursor) {
    cursor = yield* Effect.tryPromise({
      try: () => db.d1.prepare(`${select} and r.id = ?`).bind(userId, spaceId, query.cursor).first<ResponseRow>(),
      catch: () => new InternalError({}),
    });
    if (!cursor) return yield* Effect.fail(badRequest('Response cursor is no longer available'));
  }
  const rows = yield* Effect.tryPromise({
    try: () => db.d1.prepare(`${select}${cursor ? ' and (r.created_at, r.id) < (?, ?)' : ''}
      order by r.created_at desc, r.id desc limit ?`)
      .bind(userId, spaceId, ...(cursor ? [cursor.created_at, cursor.id] : []), query.limit + 1).all<ResponseRow>(),
    catch: () => new InternalError({}),
  });
  const all = rows.results ?? [];
  const page = all.slice(0, query.limit);
  return { responses: page.map((row) => serialize(row, userId)),
    ...(all.length > query.limit ? { nextCursor: page[page.length - 1].id } : {}) };
});

export const createResponseProgram = (userId: string, momentId: string, input: CreateMomentResponseRequest) => Effect.gen(function* () {
  const db = yield* Db;
  const memory = yield* Effect.tryPromise({
    try: () => db.d1.prepare(VISIBLE_MOMENT).bind(userId, momentId).first<{ space_id: string }>(),
    catch: () => new InternalError({}),
  });
  if (!memory) return yield* Effect.fail(notFound('Memory not found'));
  const mediaId = 'mediaId' in input ? input.mediaId : null;
  if (mediaId) {
    const media = yield* Effect.tryPromise({
      try: () => db.d1.prepare(`select upload_state, mime_type from media_objects
        where id = ? and space_id = ? and created_by_user_id = ? and deleted_at is null`)
        .bind(mediaId, memory.space_id, userId).first<{ upload_state: string; mime_type: string }>(),
      catch: () => new InternalError({}),
    });
    if (!media) return yield* Effect.fail(notFound('Media not found'));
    const family = input.kind === 'photo' ? 'image/' : 'audio/';
    if (media.upload_state !== 'complete' || !media.mime_type.startsWith(family)) {
      return yield* Effect.fail(badRequest('Media is not ready for this response'));
    }
  }
  const id = yield* newId;
  const at = yield* nowMs;
  const result = yield* Effect.tryPromise({
    // Membership, deletion, and media liveness are rechecked by the write itself.
    try: () => db.d1.prepare(`insert into moment_responses
      (id, moment_id, created_by_user_id, kind, body, media_id, created_at)
      select ?, ?, ?, ?, ?, ?, ? where exists (${VISIBLE_MOMENT})
      and (? is null or exists (select 1 from media_objects where id = ? and space_id = ?
        and created_by_user_id = ? and upload_state = 'complete' and deleted_at is null))`)
      .bind(id, momentId, userId, input.kind, input.kind === 'word' ? input.body : null, mediaId, at,
        userId, momentId, mediaId, mediaId, memory.space_id, userId).run(),
    catch: () => new InternalError({}),
  });
  if ((result.meta?.changes ?? 0) === 0) return yield* Effect.fail(notFound('Memory or media not found'));
  const row = yield* Effect.tryPromise({
    try: () => db.d1.prepare(`select r.*, u.name as author_name from moment_responses r
      join users u on u.id = r.created_by_user_id where r.id = ?`).bind(id).first<ResponseRow>(),
    catch: () => new InternalError({}),
  });
  if (!row) return yield* Effect.fail(notFound('Response not found'));
  return serialize(row, userId);
});
