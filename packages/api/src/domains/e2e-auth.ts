import { Effect } from 'effect';

import { Db, type DbService } from '../effects/d1';
import { Config, type ConfigService } from '../effects/config';
import { newId, type IdService } from '../effects/id';
import { nowMs, type ClockService } from '../effects/clock';
import {
  internal,
  notFound,
  unauthorized,
  type NotFoundError,
  type UnauthorizedError,
  type InternalError,
} from './errors';

/**
 * E2E-only session bootstrap.
 *
 * Mints a real `user_sessions` row for a pre-provisioned test account so a
 * Maestro-driven test build can sign in without a native Google/Apple sheet.
 * This authenticates IDENTITY only: everything past this point — the album
 * protocol, enrollment, media sealing, recovery — runs its real code.
 *
 * Availability is the flag, not the route table: the handler refuses with 404
 * unless `AOI_E2E_MODE=true`, and with 401 unless the caller proves the
 * per-run `AOI_E2E_SECRET`. Production Workers never set either, so the
 * endpoint is unreachable there by construction. Only the isolated E2E
 * backend (scripts/e2e-backend.mjs) enables it.
 */
export const mintE2ESessionProgram = (
  email: string,
  secret: string
): Effect.Effect<
  { token: string; userId: string },
  NotFoundError | UnauthorizedError | InternalError,
  DbService | ConfigService | ClockService | IdService
> =>
  Effect.gen(function* () {
    const config = yield* Config;
    if (config.get('AOI_E2E_MODE') !== 'true') {
      return yield* Effect.fail(notFound('Not found'));
    }
    const expected = config.get('AOI_E2E_SECRET');
    if (!expected || secret.length !== expected.length) {
      return yield* Effect.fail(unauthorized('Invalid test credentials'));
    }
    let different = 0;
    for (let index = 0; index < expected.length; index += 1) {
      different |= secret.charCodeAt(index) ^ expected.charCodeAt(index);
    }
    if (different !== 0) {
      return yield* Effect.fail(unauthorized('Invalid test credentials'));
    }

    const db = yield* Db;
    const user = yield* Effect.tryPromise({
      try: () =>
        db.d1
          .prepare('select id from users where email = ?')
          .bind(email)
          .first<{ id: string }>(),
      catch: () => internal(),
    });
    if (!user) {
      return yield* Effect.fail(notFound('Unknown test account'));
    }

    const at = yield* nowMs;
    const id = yield* newId;
    const token = `${crypto.randomUUID()}${crypto.randomUUID()}`.replaceAll('-', '');
    const yearMs = 365 * 24 * 60 * 60 * 1000;
    yield* Effect.tryPromise({
      try: () =>
        db.d1
          .prepare(
            'insert into user_sessions (id, user_id, token, expires_at, created_at, updated_at) values (?, ?, ?, ?, ?, ?)'
          )
          .bind(id, user.id, token, at + yearMs, at, at)
          .run(),
      catch: () => internal(),
    });

    return { token, userId: user.id };
  });
