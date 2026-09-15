import { Effect } from 'effect';

import {
  type CreateImportedMilestoneRequest,
  type ImportedMilestone,
} from '@aoi/shared';

import { nowMs, type ClockService } from '../effects/clock';
import { newId, type IdService } from '../effects/id';
import { Db, type DbService } from '../effects/d1';
import { getActiveSpaceId } from './spaces';
import { BadRequestError, InternalError, badRequest } from './errors';

/**
 * Milestones domain — imported milestones (notes, milestone markers, dates,
 * goals) shown on the timeline. Space-scoped, soft-deletable, newest-first.
 */

export interface ImportedMilestoneRow {
  id: string;
  space_id: string;
  created_by_user_id: string;
  type: string;
  title: string;
  body: string | null;
  occurred_at: number;
  target_at: number | null;
  created_at: number;
}

export function milestoneToApi(row: ImportedMilestoneRow): ImportedMilestone {
  return {
    id: row.id,
    type: row.type as ImportedMilestone['type'],
    title: row.title,
    body: row.body ?? undefined,
    occurredAt: new Date(row.occurred_at).toISOString(),
    targetAt: row.target_at === null ? undefined : new Date(row.target_at).toISOString(),
    createdAt: new Date(row.created_at).toISOString(),
  };
}

export const listMilestonesProgram = (
  userId: string
): Effect.Effect<ImportedMilestone[], InternalError, DbService> =>
  Effect.gen(function* () {
    const spaceId = yield* getActiveSpaceId(userId);
    if (!spaceId) {
      return [];
    }

    const db = yield* Db;
    const rows = yield* Effect.tryPromise({
      try: () =>
        db.d1
          .prepare(
            `select id, space_id, created_by_user_id, type, title, body,
                    occurred_at, target_at, created_at
             from imported_milestones
             where space_id = ? and deleted_at is null
             order by occurred_at desc`
          )
          .bind(spaceId)
          .all<ImportedMilestoneRow>(),
      catch: () => new InternalError({}),
    });

    return (rows.results ?? []).map(milestoneToApi);
  });

export const createMilestoneProgram = (
  userId: string,
  input: CreateImportedMilestoneRequest
): Effect.Effect<ImportedMilestone, BadRequestError | InternalError, DbService | ClockService | IdService> =>
  Effect.gen(function* () {
    const spaceId = yield* getActiveSpaceId(userId);
    if (!spaceId) {
      return yield* Effect.fail(badRequest('You must have an active space to add milestones'));
    }

    const db = yield* Db;
    const id = yield* newId;
    const at = yield* nowMs;
    const occurredAt = Date.parse(input.occurredAt);
    const targetAt = input.targetAt ? Date.parse(input.targetAt) : null;
    if (!Number.isFinite(occurredAt) || (targetAt !== null && !Number.isFinite(targetAt))) {
      return yield* Effect.fail(badRequest("That date doesn't look quite right"));
    }

    yield* Effect.tryPromise({
      try: () =>
        db.d1
          .prepare(
            `insert into imported_milestones
               (id, space_id, created_by_user_id, type, title, body,
                occurred_at, target_at, created_at)
             values (?, ?, ?, ?, ?, ?, ?, ?, ?)`
          )
          .bind(
            id,
            spaceId,
            userId,
            input.type,
            input.title,
            input.body ?? null,
            occurredAt,
            targetAt,
            at
          )
          .run(),
      catch: () => new InternalError({}),
    });

    return milestoneToApi({
      id,
      space_id: spaceId,
      created_by_user_id: userId,
      type: input.type,
      title: input.title,
      body: input.body ?? null,
      occurred_at: occurredAt,
      target_at: targetAt,
      created_at: at,
    });
  });
