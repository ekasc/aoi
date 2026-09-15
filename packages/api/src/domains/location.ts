import { Effect } from 'effect';

import {
  getLocationFreshnessMs,
  isLocationShareFresh,
  type CurrentLocationResponse,
  type LocationConsentRequest,
  type LocationConsentResponse,
  type LocationShareMode,
  type LocationShareRequest,
  type PartnerLocationShare,
} from '@aoi/shared';

import { nowMs, type ClockService } from '../effects/clock';
import { newId, type IdService } from '../effects/id';
import { Db, type DbService } from '../effects/d1';
import { Logger, type LoggerService } from '../effects/logger';
import { enqueueJob, type JobQueueService } from '../services/job-queue';
import { getActiveSpaceId } from './spaces';
import {
  BadRequestError,
  ForbiddenError,
  InternalError,
  badRequest,
  forbidden,
} from './errors';

/**
 * Location domain — optional, consensual, bounded sharing; never tracking.
 *
 * Consent model (non-negotiable):
 * - BOTH partners must explicitly opt in before any location flows. Consent
 *   is `space_members.location_consent_at` (nullable timestamp).
 * - Either partner can stop at any time — one tap, no confirmation.
 * - The server keeps ONLY the single latest live position per user,
 *   ephemeral: upsert-on-report, deleted outright on stop/expire. No
 *   history, no trails, and coordinates never appear in logs or errors.
 * - The GET path re-checks the partner's consent and reads the row in one
 *   single atomic statement, so a revocation mid-GET cannot serve one last
 *   fix.
 */

export interface LocationShareRow {
  id: string;
  user_id: string;
  space_id: string;
  mode: string;
  destination: string | null;
  latitude: number;
  longitude: number;
  accuracy_meters: number | null;
  reported_at: number;
  consumed_at: number | null;
}

export interface LocationSpaceContext {
  youConsented: boolean;
  partnerConsented: boolean;
  partnerUserId: string | null;
}

/** Read both members' consent state for a space (caller included). */
function getLocationSpaceContext(
  spaceId: string,
  userId: string
): Effect.Effect<LocationSpaceContext | null, InternalError, DbService> {
  return Effect.flatMap(Db, (s) =>
    Effect.tryPromise({
      try: async () => {
        const members = await s.d1
          .prepare(
            `select user_id, role, location_consent_at from space_members
             where space_id = ? and state = 'active'`
          )
          .bind(spaceId)
          .all<{ user_id: string; role: string; location_consent_at: number | null }>();
        const rows = members.results ?? [];
        if (rows.length === 0) return null;
        const you = rows.find((row) => row.user_id === userId);
        const partner = rows.find((row) => row.user_id !== userId);
        if (!you) return null;
        return {
          youConsented: you.location_consent_at !== null,
          partnerConsented: (partner?.location_consent_at ?? null) !== null,
          partnerUserId: partner?.user_id ?? null,
        };
      },
      catch: () => new InternalError({}),
    })
  );
}

/** Expire-purge stale shares for a space (best-effort, fire-and-forget). */
function sweepExpiredShares(
  spaceId: string
): Effect.Effect<void, never, DbService | ClockService> {
  return Effect.flatMap(Db, (s) =>
    Effect.map(nowMs, (at) => {
      void (async () => {
        try {
          const rows = await s.d1
            .prepare(
              `select id, mode, reported_at from location_shares
               where space_id = ?`
            )
            .bind(spaceId)
            .all<{ id: string; mode: string; reported_at: number }>();
          for (const row of rows.results ?? []) {
            const mode = row.mode as LocationShareMode;
            if (!isLocationShareFresh(mode, row.reported_at, at)) {
              await s.d1.prepare('delete from location_shares where id = ?').bind(row.id).run();
            }
          }
        } catch {
          // best-effort only — never breaks a request
        }
      })();
    })
  ).pipe(Effect.catchAll(() => Effect.void));
}

/** Serialize a share row to the partner-facing shape (never logged). */
function shareToApi(row: LocationShareRow): PartnerLocationShare {
  return {
    mode: row.mode as LocationShareMode,
    latitude: row.latitude,
    longitude: row.longitude,
    accuracyMeters: row.accuracy_meters,
    reportedAt: new Date(row.reported_at).toISOString(),
    destination:
      row.destination === null
        ? null
        : (JSON.parse(row.destination) as PartnerLocationShare['destination']),
  };
}

// ── GET current location ─────────────────────────────────────────────────
// Only ever the partner's position. Null whenever nothing qualifies (no
// consent on either side, no row, stale row, consumed grant) — a calm 200.

export const getLocationProgram = (
  userId: string
): Effect.Effect<CurrentLocationResponse, InternalError, DbService | ClockService | LoggerService> =>
  Effect.gen(function* () {
    const spaceId = yield* getActiveSpaceId(userId);
    if (!spaceId) {
      return { location: null, youConsented: false, partnerConsented: false };
    }

    const context = yield* getLocationSpaceContext(spaceId, userId);
    if (!context || !context.partnerUserId) {
      return { location: null, youConsented: false, partnerConsented: false };
    }

    const { youConsented, partnerConsented, partnerUserId } = context;
    if (!youConsented || !partnerConsented) {
      return { location: null, youConsented, partnerConsented };
    }

    // Consent re-check + row read in ONE statement (atomic): a revocation
    // that lands mid-GET cannot serve one last fix. The read is
    // space-scoped as well.
    const db = yield* Db;
    const at = yield* nowMs;
    const joined = yield* Effect.tryPromise({
      try: () =>
        db.d1
          .prepare(
            `select sm.location_consent_at as consent_at,
                    ls.id as share_id, ls.user_id as share_user_id,
                    ls.space_id as share_space_id, ls.mode, ls.destination,
                    ls.latitude, ls.longitude, ls.accuracy_meters,
                    ls.reported_at, ls.consumed_at
             from space_members sm
             left join location_shares ls
               on ls.user_id = sm.user_id and ls.space_id = sm.space_id
             where sm.space_id = ? and sm.user_id = ? and sm.state = 'active'
             limit 1`
          )
          .bind(spaceId, partnerUserId)
          .first<{
            consent_at: number | null;
            share_id: string | null;
            share_user_id: string | null;
            share_space_id: string | null;
            mode: string | null;
            destination: string | null;
            latitude: number | null;
            longitude: number | null;
            accuracy_meters: number | null;
            reported_at: number | null;
            consumed_at: number | null;
          }>(),
      catch: () => new InternalError({}),
    });

    if (
      !joined ||
      joined.consent_at === null ||
      joined.share_id === null ||
      joined.mode === null ||
      joined.reported_at === null
    ) {
      return { location: null, youConsented, partnerConsented };
    }

    const share: LocationShareRow = {
      id: joined.share_id,
      user_id: joined.share_user_id!,
      space_id: joined.share_space_id!,
      mode: joined.mode,
      destination: joined.destination,
      latitude: joined.latitude!,
      longitude: joined.longitude!,
      accuracy_meters: joined.accuracy_meters,
      reported_at: joined.reported_at,
      consumed_at: joined.consumed_at,
    };

    if (!isLocationShareFresh(share.mode as LocationShareMode, share.reported_at, at)) {
      // Expire-purge: the row outlived its window, deleted outright.
      yield* Effect.tryPromise({
        try: () => db.d1.prepare('delete from location_shares where id = ?').bind(share.id).run(),
        catch: () => new InternalError({}),
      });
      return { location: null, youConsented, partnerConsented };
    }

    if (share.mode === 'on_request_granted') {
      if (share.consumed_at !== null) {
        return { location: null, youConsented, partnerConsented };
      }
      // Consume atomically: the scoped UPDATE only matches while
      // consumed_at IS NULL, so two racing reads can never both be served.
      const consume = yield* Effect.tryPromise({
        try: () =>
          db.d1
            .prepare(
              `update location_shares set consumed_at = ?
               where id = ? and consumed_at is null`
            )
            .bind(at, share.id)
            .run(),
        catch: () => new InternalError({}),
      });
      if ((consume.meta?.changes ?? 0) === 0) {
        return { location: null, youConsented, partnerConsented };
      }
    }

    return { location: shareToApi(share), youConsented, partnerConsented };
  });

// ── POST share (upsert the caller's latest position) ────────────────────
// Writes ONLY when both partners have consented; `reportedAt` is always
// server-assigned. Granting (mode on_request_granted) notifies the partner
// so their app fetches GET.

export const shareLocationProgram = (
  userId: string,
  input: LocationShareRequest
): Effect.Effect<{ ok: true }, BadRequestError | ForbiddenError | InternalError, DbService | JobQueueService | ClockService | IdService | LoggerService> =>
  Effect.gen(function* () {
    const spaceId = yield* getActiveSpaceId(userId);
    if (!spaceId) {
      return yield* Effect.fail(badRequest('You must have an active space to share your location'));
    }

    const context = yield* getLocationSpaceContext(spaceId, userId);
    if (!context) {
      return yield* Effect.fail(badRequest('You must have an active space to share your location'));
    }
    if (!context.youConsented || !context.partnerConsented) {
      return yield* Effect.fail(forbidden('Both partners need to opt in before sharing locations'));
    }

    yield* sweepExpiredShares(spaceId);

    const at = yield* nowMs;
    const id = yield* newId;
    const db = yield* Db;
    yield* Effect.tryPromise({
      try: () =>
        db.d1
          .prepare(
            `insert into location_shares
               (id, user_id, space_id, mode, destination, latitude,
                longitude, accuracy_meters, reported_at, consumed_at, created_at, updated_at)
             values (?, ?, ?, ?, ?, ?, ?, ?, ?, null, ?, ?)
             on conflict (user_id) do update set
               space_id = excluded.space_id,
               mode = excluded.mode,
               destination = excluded.destination,
               latitude = excluded.latitude,
               longitude = excluded.longitude,
               accuracy_meters = excluded.accuracy_meters,
               reported_at = excluded.reported_at,
               consumed_at = null,
               updated_at = excluded.updated_at`
          )
          .bind(
            id,
            userId,
            spaceId,
            input.mode,
            input.destination ? JSON.stringify(input.destination) : null,
            input.latitude,
            input.longitude,
            input.accuracyMeters ?? null,
            at,
            at,
            at
          )
          .run(),
      catch: () => new InternalError({}),
    });

    if (input.mode === 'on_request_granted') {
      yield* enqueueJob({ type: 'push.deliver', kind: 'location_granted', spaceId, fromUserId: userId });
    }

    return { ok: true as const };
  });

// ── DELETE share (stop) ──────────────────────────────────────────────────
// One tap, idempotent, no confirmation. Deletes the caller's row outright
// and lets the partner know (kind location_stopped) when there was one.

export const stopSharingProgram = (
  userId: string
): Effect.Effect<{ ok: true }, InternalError, DbService | JobQueueService | LoggerService> =>
  Effect.gen(function* () {
    const spaceId = yield* getActiveSpaceId(userId);
    if (!spaceId) {
      return { ok: true as const };
    }

    const db = yield* Db;
    const result = yield* Effect.tryPromise({
      try: () =>
        db.d1
          .prepare(
            'delete from location_shares where user_id = ? and space_id = ?'
          )
          .bind(userId, spaceId)
          .run(),
      catch: () => new InternalError({}),
    });

    if ((result.meta?.changes ?? 0) > 0) {
      yield* enqueueJob({ type: 'push.deliver', kind: 'location_stopped', spaceId, fromUserId: userId });
    }

    return { ok: true as const };
  });

// ── POST consent (opt in / out) ─────────────────────────────────────────
// Revoking consent also deletes any share row and tells the partner.

export const updateConsentProgram = (
  userId: string,
  input: LocationConsentRequest
): Effect.Effect<LocationConsentResponse, BadRequestError | ForbiddenError | InternalError, DbService | JobQueueService | ClockService | LoggerService> =>
  Effect.gen(function* () {
    const spaceId = yield* getActiveSpaceId(userId);
    if (!spaceId) {
      return yield* Effect.fail(badRequest('You must have an active space to update location consent'));
    }

    const context = yield* getLocationSpaceContext(spaceId, userId);
    if (!context) {
      return yield* Effect.fail(badRequest('You must have an active space to update location consent'));
    }

    const at = yield* nowMs;
    const db = yield* Db;
    yield* Effect.tryPromise({
      try: () =>
        db.d1
          .prepare(
            `update space_members set location_consent_at = ?
             where space_id = ? and user_id = ? and state = 'active'`
          )
          .bind(input.consented ? at : null, spaceId, userId)
          .run(),
      catch: () => new InternalError({}),
    });

    if (!input.consented) {
      const result = yield* Effect.tryPromise({
        try: () =>
          db.d1
            .prepare('delete from location_shares where user_id = ? and space_id = ?')
            .bind(userId, spaceId)
            .run(),
        catch: () => new InternalError({}),
      });
      if ((result.meta?.changes ?? 0) > 0) {
        yield* enqueueJob({ type: 'push.deliver', kind: 'location_stopped', spaceId, fromUserId: userId });
      }
    } else {
      yield* sweepExpiredShares(spaceId);
    }

    return {
      youConsented: input.consented,
      partnerConsented: context.partnerConsented,
    };
  });

// ── POST request (ask the partner for a one-time share) ─────────────────
// Mutuality: you can only ask if you also consented. The push carries kind
// + nothing else — coordinates never enter a payload.

export const requestLocationProgram = (
  userId: string
): Effect.Effect<{ ok: true }, BadRequestError | ForbiddenError | InternalError, DbService | JobQueueService | ClockService | LoggerService> =>
  Effect.gen(function* () {
    const spaceId = yield* getActiveSpaceId(userId);
    if (!spaceId) {
      return yield* Effect.fail(badRequest('You must have an active space to request a location'));
    }

    const context = yield* getLocationSpaceContext(spaceId, userId);
    if (!context) {
      return yield* Effect.fail(badRequest('You must have an active space to request a location'));
    }
    if (!context.youConsented) {
      return yield* Effect.fail(forbidden('You can only ask when you have opted in yourself'));
    }
    if (!context.partnerConsented) {
      return yield* Effect.fail(forbidden('Your partner also needs to opt in before you can ask'));
    }

    yield* sweepExpiredShares(spaceId);
    yield* enqueueJob({ type: 'push.deliver', kind: 'location_request', spaceId, fromUserId: userId });

    return { ok: true as const };
  });

export { getLocationFreshnessMs };
