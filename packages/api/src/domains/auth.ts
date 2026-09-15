import { Effect } from 'effect';

import type { User } from '@aoi/shared';

import { Db, guardedUpdate } from '../effects/d1';
import { nowMs } from '../effects/clock';
import { Logger, logWarn, type LoggerService } from '../effects/logger';
import {
  BadRequestError,
  InternalError,
  NotFoundError,
  UnauthorizedError,
  badRequest,
  notFound,
} from './errors';
import { SESSION_TTL_SEC } from '../auth/better-auth';
import type { ClockService } from '../effects/clock';
import type { DbService } from '../effects/d1';

/**
 * Auth domain — the account/session lifecycle on D1.
 *
 * Better Auth owns sign-in (OAuth + idToken verification) and stores sessions
 * in `user_sessions`. These programs are the lifecycle operations the app
 * routes need: session resolution (Bearer token → user), refresh (touch +
 * extend), sign-out (revoke the row), and account deletion (identity purge
 * + revoke all sessions + leave the space, atomically).
 *
 * Session tokens are opaque strings in `user_sessions.token` (unique index).
 * Validation is a DB lookup against token + expiry + user-not-deleted — the
 * DB is the single source of truth, so revocation is immediate and races are
 * impossible.
 */

export interface SessionUser {
  id: string;
  email: string;
  displayName: string;
  avatarUrl?: string;
  createdAt: string;
}

export interface ResolvedSession {
  sessionId: string;
  userId: string;
  expiresAt: string;
  user: SessionUser;
}

export interface SessionRow {
  id: string;
  user_id: string;
  expires_at: number;
  email: string | null;
  name: string | null;
  image: string | null;
  created_at: number;
}

const SESSION_LOOKUP_SQL = `
  select s.id as id, s.user_id as user_id, s.expires_at as expires_at,
         u.email as email, u.name as name, u.image as image,
         u.created_at as created_at
  from user_sessions s
  join users u on u.id = s.user_id
  where s.token = ? and u.deleted_at is null
`;

function rowToSessionUser(row: SessionRow): SessionUser {
  return {
    id: row.user_id,
    email: row.email ?? '',
    displayName: row.name ?? '',
    avatarUrl: row.image ?? undefined,
    createdAt: new Date(row.created_at).toISOString(),
  };
}

/**
 * Resolve a Bearer session token to a live session + user. Returns null when
 * the token is unknown, expired, or the user is soft-deleted (all render as
 * 401 at the transport layer). Time reads the Clock service so tests pin it.
 */
export const resolveSessionByToken = (
  token: string
): Effect.Effect<ResolvedSession | null, InternalError, DbService | ClockService> =>
  Effect.gen(function* () {
    const now = yield* nowMs;
    const db = yield* Db;
    const row = yield* Effect.tryPromise({
      try: () => db.d1.prepare(SESSION_LOOKUP_SQL).bind(token).first<SessionRow>(),
      catch: () => new InternalError({}),
    });
    if (!row) return null;
    if (row.expires_at <= now) return null;
    return {
      sessionId: row.id,
      userId: row.user_id,
      expiresAt: new Date(row.expires_at).toISOString(),
      user: rowToSessionUser(row),
    };
  });

/**
 * Session read for GET /v1/auth/session. 401 on invalid/expired token.
 */
export const getSessionProgram = (
  token: string
): Effect.Effect<
  { authenticated: true; user: User; expiresAt: string },
  UnauthorizedError | InternalError,
  DbService | ClockService
> =>
  Effect.gen(function* () {
    const resolved = yield* resolveSessionByToken(token);
    if (!resolved) {
      return yield* Effect.fail(new UnauthorizedError({ message: 'Invalid or expired session' }));
    }
    return {
      authenticated: true,
      user: resolved.user,
      expiresAt: resolved.expiresAt,
    };
  });

/**
 * Refresh: the same opaque session credential is extended (Better Auth's
 * sliding-window model — there is no separate refresh token). Touching the
 * row is guarded (`expires_at > now`) so an already-expired session cannot be
 * revived; the client-facing contract keeps accessToken/refreshToken fields,
 * both carrying the session token.
 */
export const refreshSessionProgram = (
  token: string
): Effect.Effect<
  { accessToken: string; refreshToken: string; expiresInSec: number },
  UnauthorizedError | InternalError,
  DbService | ClockService
> =>
  Effect.gen(function* () {
    const resolved = yield* resolveSessionByToken(token);
    if (!resolved) {
      return yield* Effect.fail(new UnauthorizedError({ message: 'Invalid or expired session' }));
    }
    const now = yield* nowMs;
    const nextExpiry = now + SESSION_TTL_SEC * 1000;
    const updated = yield* guardedUpdate(
      'update user_sessions set expires_at = ?, updated_at = ? where id = ? and expires_at > ?',
      nextExpiry,
      now,
      resolved.sessionId,
      now
    );
    if (updated.changes === 0) {
      return yield* Effect.fail(new UnauthorizedError({ message: 'Invalid or expired session' }));
    }
    return {
      accessToken: token,
      refreshToken: token,
      expiresInSec: SESSION_TTL_SEC,
    };
  });

/**
 * Sign out: revoke the presented session row. Deleting the row (rather than
 * tombstoning) is exactly what Better Auth's sign-out does; the token dies
 * instantly because validation is a DB lookup.
 */
export const signOutProgram = (
  token: string
): Effect.Effect<{ ok: true }, InternalError, DbService> =>
  Effect.flatMap(Db, (s) =>
    Effect.tryPromise({
      try: async () => {
        await s.d1.prepare('delete from user_sessions where token = ?').bind(token).run();
        return { ok: true as const };
      },
      catch: () => new InternalError({}),
    })
  );

/**
 * Account deletion — a truthful "permanently delete account".
 *
 * Boundary (deliberate, pinned by session-account-deletion tests):
 * - PURGED (personal identity/data): email (unique freed, so the address
 *   can register again as a new, unlinked account), avatar, display name
 *   (tombstoned to 'Deleted member'), provider linkage + tokens
 *   (auth_accounts — re-login cannot resurrect: no account row to link,
 *   no email to match), every session (all devices, immediate: validation
 *   is a DB lookup), push registrations, preferences, and precise
 *   location shares (plus consent withdrawal on the member row).
 * - RETAINED (shared relationship content for the remaining partner):
 *   moments, letters, calendar, proposals, someday, weekly answers, media
 *   rows + bytes, spaces, invites, activity, the Plus row (the partner's
 *   paid period runs on), and the membership row itself (flipped to left
 *   — pairing history and the audit trail stay intact).
 * - The user row survives as an unlinked tombstone (id + deleted_at only)
 *   so content FKs stay valid. Content snapshots keep the names the
 *   partner already saw (moments author_name, spaces partner_name); live
 *   joins over the tombstone resolve as 'Deleted member'.
 *
 * Lifecycle/retry: the purge AND the last-member space archive commit in
 * ONE atomic batch — a 500 always means nothing changed (sessions intact,
 * same token retries cleanly). The archive is a guarded in-batch update
 * (`not exists` an active member, evaluated post-flip inside the same
 * transaction), so there is no split between "account gone" and "space
 * closed". Every statement is guarded/idempotent: a domain-level re-run
 * converges to the same state and still returns ok. Note the transport
 * truth: after a successful delete the credential is dead, so an HTTP
 * retry is a 401 — retries only happen pre-commit, where they are safe.
 *
 * Out of this slice by design: R2 media bytes are shared memories and
 * stay; staged (never-completed) uploads age out via the media cron.
 * Encrypted platform backups may briefly retain copies until they age
 * out, and app-store purchase records live with those providers.
 */
export const deleteAccountProgram = (
  userId: string
): Effect.Effect<
  { ok: true },
  InternalError,
  DbService | ClockService | LoggerService
> =>
  Effect.gen(function* () {
    const now = yield* nowMs;
    const db = yield* Db;
    const membership = yield* Effect.tryPromise({
      try: () =>
        db.d1
          .prepare("select space_id from space_members where user_id = ? and state = 'active' limit 1")
          .bind(userId)
          .first<{ space_id: string }>(),
      catch: () => new InternalError({}),
    });
    const statements = [
      db.d1.prepare('delete from user_sessions where user_id = ?').bind(userId),
      db.d1.prepare('delete from push_tokens where user_id = ?').bind(userId),
      db.d1.prepare('delete from location_shares where user_id = ?').bind(userId),
      db.d1.prepare('delete from user_preferences where user_id = ?').bind(userId),
      // Provider linkage + tokens: without this, the next OAuth sign-in
      // would link the old account row and resurrect the deleted identity.
      db.d1.prepare('delete from auth_accounts where user_id = ?').bind(userId),
      db.d1
        .prepare(
          `update space_members
           set state = 'left', left_at = ?, location_consent_at = null
           where user_id = ? and state = 'active'`
        )
        .bind(now, userId),
      // Tombstone the user row: id + deleted_at survive for FK
      // validity, everything identifying is scrubbed (email NULL also
      // frees the unique so the address can register anew, unlinked).
      db.d1
        .prepare(
          `update users
           set email = null, name = ?, image = null, email_verified = 0,
               deleted_at = ?, updated_at = ?
           where id = ? and deleted_at is null`
        )
        .bind('Deleted member', now, now, userId),
    ];
    if (membership?.space_id) {
      // Last-member close, decided post-flip inside the same transaction:
      // a concurrent join landing first keeps the space open (correct —
      // it is no longer abandoned).
      statements.push(
        db.d1
          .prepare(
            `update spaces set archived_at = ?, updated_at = ?
             where id = ? and archived_at is null
               and not exists (
                 select 1 from space_members where space_id = ? and state = 'active'
               )`
          )
          .bind(now, now, membership.space_id, membership.space_id)
      );
    }
    yield* Effect.tryPromise({
      try: () => db.batch(statements),
      catch: () => new InternalError({}),
    });
    yield* logWarn('auth: account deleted', { userId });
    return { ok: true as const };
  });

/**
 * Guard helper for routes that need a live user row (e.g. session).
 */
export const requireUserRow = (
  userId: string
): Effect.Effect<
  { id: string; email: string; name: string; image: string | null },
  NotFoundError | InternalError,
  DbService
> =>
  Effect.flatMap(Db, (s) =>
    Effect.tryPromise({
      try: async () => {
        const row = await s.d1
          .prepare('select id, email, name, image from users where id = ? and deleted_at is null')
          .bind(userId)
          .first<{ id: string; email: string | null; name: string; image: string | null }>();
        if (!row) return null;
        return { id: row.id, email: row.email ?? '', name: row.name, image: row.image };
      },
      catch: () => new InternalError({}),
    }).pipe(
      Effect.flatMap((row) =>
        row
          ? Effect.succeed(row)
          : Effect.fail(new NotFoundError({ message: 'User not found' }))
      )
    )
  );

/** Validate a required string is present (fixed word-only 400). */
export function requireToken(
  input: string | undefined
): Effect.Effect<string, BadRequestError, never> {
  if (!input || input.trim().length === 0) {
    return Effect.fail(badRequest('A session token is required'));
  }
  return Effect.succeed(input);
}
