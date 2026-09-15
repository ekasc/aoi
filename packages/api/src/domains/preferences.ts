import { Effect } from 'effect';

import type { UpdateUserPreferencesRequest, UserPreferences } from '@aoi/shared';

import { nowMs, type ClockService } from '../effects/clock';
import { Db, type DbService } from '../effects/d1';
import { InternalError } from './errors';

/**
 * Preferences domain — per-user UI preferences (theme). Get returns the
 * default when no row exists; update is an idempotent upsert.
 */

export const getPreferencesProgram = (
  userId: string
): Effect.Effect<UserPreferences, InternalError, DbService> =>
  Effect.flatMap(Db, (s) =>
    Effect.tryPromise({
      try: async () => {
        const row = await s.d1
          .prepare('select theme_id from user_preferences where user_id = ? limit 1')
          .bind(userId)
          .first<{ theme_id: string }>();
        return { themeId: (row?.theme_id as UserPreferences['themeId']) ?? 'sunset-shore' };
      },
      catch: () => new InternalError({}),
    })
  );

export const updatePreferencesProgram = (
  userId: string,
  input: UpdateUserPreferencesRequest
): Effect.Effect<UserPreferences, InternalError, DbService | ClockService> =>
  Effect.gen(function* () {
    const db = yield* Db;
    const at = yield* nowMs;

    yield* Effect.tryPromise({
      try: () =>
        db.d1
          .prepare(
            `insert into user_preferences (user_id, theme_id, updated_at)
             values (?, ?, ?)
             on conflict (user_id) do update set
               theme_id = excluded.theme_id,
               updated_at = excluded.updated_at`
          )
          .bind(userId, input.themeId ?? 'sunset-shore', at)
          .run(),
      catch: () => new InternalError({}),
    });

    const row = yield* Effect.tryPromise({
      try: () =>
        db.d1
          .prepare('select theme_id from user_preferences where user_id = ? limit 1')
          .bind(userId)
          .first<{ theme_id: string }>(),
      catch: () => new InternalError({}),
    });

    return { themeId: (row?.theme_id as UserPreferences['themeId']) ?? 'sunset-shore' };
  });
