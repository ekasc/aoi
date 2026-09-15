import { Effect } from 'effect';

import type { SpaceActivityItem, SpaceActivityResponse, SpaceActivityKind } from '@aoi/shared';

import { nowMs } from '../effects/clock';
import { Db, type DbService } from '../effects/d1';
import { Logger, type LoggerService } from '../effects/logger';
import type { ClockService } from '../effects/clock';
import { BadRequestError, InternalError, badRequest } from './errors';
import { getActiveSpaceId } from './spaces';
/**
 * Activity domain — the space change log. Provenance, not history:
 * - read window is clamped to 7 days (never widened, even by `since`),
 * - capped at 50 rows per read,
 * - tombstone-only kinds (`moment_deleted` / `moment_edited`),
 * - rows are pruned inline on read (best-effort housekeeping that must
 *   never fail the request); the cron sweep is the authoritative purge.
 */

export const ACTIVITY_MAX_AGE_DAYS = 7;
export const ACTIVITY_LIMIT = 50;
export const MS_PER_DAY = 24 * 60 * 60 * 1000;

interface ActivityRow {
  id: string;
  kind: string;
  actor_name: string;
  occurred_at: number;
}

export function activityRowToApi(row: ActivityRow): SpaceActivityItem {
  return {
    id: row.id,
    kind: row.kind as SpaceActivityKind,
    actorName: row.actor_name,
    occurredAt: new Date(row.occurred_at).toISOString(),
  };
}

export const listActivityProgram = (
  userId: string,
  query: { since?: string }
): Effect.Effect<SpaceActivityResponse, BadRequestError | InternalError, DbService | LoggerService | ClockService> =>
  Effect.gen(function* () {
    const spaceId = yield* getActiveSpaceId(userId);
    if (!spaceId) {
      return { activity: [] };
    }

    const at = yield* nowMs;
    const oldestAllowed = at - ACTIVITY_MAX_AGE_DAYS * MS_PER_DAY;

    const requestedSince = query.since ? Date.parse(query.since) : null;
    if (query.since !== undefined && !Number.isFinite(requestedSince)) {
      return yield* Effect.fail(badRequest('Invalid since parameter'));
    }
    const windowStart =
      requestedSince !== null && requestedSince > oldestAllowed ? requestedSince : oldestAllowed;

    const db = yield* Db;
    const rows = yield* Effect.tryPromise({
      try: () =>
        db.d1
          .prepare(
            `select a.id, a.kind, u.name as actor_name, a.occurred_at
             from space_activity a
             join users u on u.id = a.actor_user_id
             where a.space_id = ? and a.occurred_at >= ?
             order by a.occurred_at desc, a.id desc
             limit ?`
          )
          .bind(spaceId, windowStart, ACTIVITY_LIMIT)
          .all<ActivityRow>(),
      catch: () => new InternalError({}),
    });

    // Defensive clamp: never return rows outside the retention window.
    const activity = (rows.results ?? [])
      .filter((row) => row.occurred_at >= windowStart)
      .map(activityRowToApi);

    // Inline retention purge — housekeeping only; a failure is logged, never
    // propagated (the read above already succeeded).
    yield* Effect.tryPromise({
      try: () =>
        db.d1
          .prepare('delete from space_activity where space_id = ? and occurred_at < ?')
          .bind(spaceId, oldestAllowed)
          .run(),
      catch: () => new Error('activity purge failed'),
    }).pipe(
      Effect.catchAll((error) =>
        Effect.flatMap(Logger, (logger) => {
          logger.warn('activity: inline purge failed', {
            error: error instanceof Error ? error.message : 'unknown',
          });
          return Effect.void;
        })
      )
    );

    return { activity };
  });
