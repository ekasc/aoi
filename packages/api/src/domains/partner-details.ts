import { Effect } from 'effect';
import type { CreatePartnerDetailRequest, PartnerDetail } from '@aoi/shared';

import { Db } from '../effects/d1';
import { nowMs } from '../effects/clock';
import { newId } from '../effects/id';
import { InternalError, notFound } from './errors';

interface DetailRow {
  id: string;
  text: string;
  category: PartnerDetail['category'];
  created_at: number;
}

const serialize = (row: DetailRow): PartnerDetail => ({
  id: row.id, text: row.text, category: row.category, createdAt: new Date(row.created_at).toISOString(),
});

export const listPartnerDetailsProgram = (userId: string) => Effect.gen(function* () {
  const db = yield* Db;
  const rows = yield* Effect.tryPromise({
    try: () => db.d1.prepare(`select id, text, category, created_at from partner_details
      where user_id = ? order by created_at desc, id desc`).bind(userId).all<DetailRow>(),
    catch: () => new InternalError({}),
  });
  return (rows.results ?? []).map(serialize);
});

export const createPartnerDetailProgram = (userId: string, input: CreatePartnerDetailRequest) => Effect.gen(function* () {
  const db = yield* Db;
  const id = yield* newId;
  const at = yield* nowMs;
  yield* Effect.tryPromise({
    try: () => db.d1.prepare(`insert into partner_details (id, user_id, text, category, created_at)
      values (?, ?, ?, ?, ?)`).bind(id, userId, input.text, input.category, at).run(),
    catch: () => new InternalError({}),
  });
  return serialize({ id, text: input.text, category: input.category, created_at: at });
});

export const deletePartnerDetailProgram = (userId: string, id: string) => Effect.gen(function* () {
  const db = yield* Db;
  const result = yield* Effect.tryPromise({
    try: () => db.d1.prepare('delete from partner_details where id = ? and user_id = ?').bind(id, userId).run(),
    catch: () => new InternalError({}),
  });
  if ((result.meta?.changes ?? 0) === 0) return yield* Effect.fail(notFound('Detail not found'));
  return { deleted: true };
});
