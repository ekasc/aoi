import { Effect } from 'effect';

import type { RegisterPushTokenRequest, RegisterPushTokenResponse } from '@aoi/shared';

import { nowMs, type ClockService } from '../effects/clock';
import { newId, type IdService } from '../effects/id';
import { Db, type DbService } from '../effects/d1';
import { InternalError } from './errors';

/**
 * Push token registry. Tokens are device-scoped:
 * - re-registering the same token refreshes it (single upsert, no
 *   read-then-write race);
 * - a token re-registered by a different user is reassigned to them;
 * - per-user registrations are capped (oldest trimmed by lastSeenAt);
 * - unregister is scoped to the caller — identical response whether or not
 *   the token existed (no existence leaks).
 */

export const MAX_PUSH_TOKENS_PER_USER = 200;

export const registerPushTokenProgram = (
  userId: string,
  input: RegisterPushTokenRequest
): Effect.Effect<RegisterPushTokenResponse, InternalError, DbService | ClockService | IdService> =>
  Effect.gen(function* () {
    const db = yield* Db;
    const id = yield* newId;
    const at = yield* nowMs;
    const platform = input.platform ?? 'unknown';

    yield* Effect.tryPromise({
      try: () =>
        db.d1
          .prepare(
            `insert into push_tokens (id, user_id, expo_push_token, platform, created_at, last_seen_at)
             values (?, ?, ?, ?, ?, ?)
             on conflict (expo_push_token) do update set
               user_id = excluded.user_id,
               platform = excluded.platform,
               last_seen_at = excluded.last_seen_at`
          )
          .bind(id, userId, input.expoPushToken, platform, at, at)
          .run(),
      catch: () => new InternalError({}),
    });

    // Cap per-user registrations: keep the 200 most-recently-seen tokens.
    yield* Effect.tryPromise({
      try: () =>
        db.d1
          .prepare(
            `delete from push_tokens where user_id = ? and id not in (
               select id from push_tokens where user_id = ? order by last_seen_at desc limit ?
             )`
          )
          .bind(userId, userId, MAX_PUSH_TOKENS_PER_USER)
          .run(),
      catch: () => new InternalError({}),
    });

    const row = yield* Effect.tryPromise({
      try: () =>
        db.d1
          .prepare('select id, platform from push_tokens where expo_push_token = ? limit 1')
          .bind(input.expoPushToken)
          .first<{ id: string; platform: string }>(),
      catch: () => new InternalError({}),
    });

    return { id: row?.id ?? id, platform: (row?.platform as RegisterPushTokenResponse['platform']) ?? platform };
  });

export const unregisterPushTokenProgram = (
  userId: string,
  expoPushToken: string
): Effect.Effect<{ ok: true }, InternalError, DbService> =>
  Effect.gen(function* () {
    const db = yield* Db;
    yield* Effect.tryPromise({
      try: () =>
        db.d1
          .prepare('delete from push_tokens where user_id = ? and expo_push_token = ?')
          .bind(userId, expoPushToken)
          .run(),
      catch: () => new InternalError({}),
    });
    return { ok: true as const };
  });
