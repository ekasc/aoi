import { Effect } from 'effect';

import type { RevenueCatWebhookEvent, SpacePlusResponse } from '@aoi/shared';
import {
  FREE_FUTURE_LETTERS,
  FREE_MEDIA_BYTES,
  PLUS_GRANT_EVENT_TYPES,
  PLUS_REVOKE_EVENT_TYPES,
  futureLetterLimitForSpace,
  mediaLimitForSpace,
  revenueCatWebhookBodySchema,
} from '@aoi/shared';

import { Db } from '../effects/d1';
import type { DbService } from '../effects/d1';
import type { D1PreparedStatement, D1Result } from '../env';
import { nowMs } from '../effects/clock';
import type { ClockService } from '../effects/clock';
import { logInfo } from '../effects/logger';
import type { LoggerService } from '../effects/logger';
import { Config, require_ as requireConfig } from '../effects/config';
import type { ConfigService } from '../effects/config';
import { getActiveSpaceId } from './spaces';
import { secretsEqual } from '../lib/crypto';
import { InternalError, UnauthorizedError, badRequest } from './errors';
import type { BadRequestError } from './errors';
import { WEBHOOK_EVENT_RETENTION_MS } from '../db/d1-schema';

/**
 * Space Plus entitlement authority (P8A).
 *
 * Ownership rule (deterministic, enforced from membership lifecycle state):
 * - a verified provider event attaches to the purchaser's CURRENT active
 *   Space at processing time — the partner in that Space shares Plus by
 *   reading the same row;
 * - the row then STICKS to that Space until expiry/revocation: the
 *   purchaser leaving, joining, or creating another Space never moves it,
 *   so one active subscription can never entitle two unrelated Spaces;
 * - a later grant for the same purchaser refreshes the STUCK row in place
 *   (expiry extension included) instead of opening a second row;
 * - only when no live row exists for the purchaser does a grant attach to
 *   their current active Space (a grant with no active Space is ignored —
 *   there is nothing truthful to entitle);
 * - TRANSFER moves a known entitlement atomically (source revoke + dest
 *   grant in one batch) and never leaves two Spaces Plus;
 * - expiry is read-time (`expires_at > now`); no cron required;
 * - account deletion flips membership to `left` but leaves the row until
 *   provider expiry — the remaining partner keeps the paid period, exactly
 *   like a leave. No joint deletion, ever.
 *
 * Identity rule: the purchaser is resolved from the provider identity set
 * (app_user_id, original_app_user_id, aliases[]) against Aoi user rows.
 * Zero matches → ignore; more than one distinct user → ambiguous, ignore.
 * Anonymous provider ids (`$RCAnonymousID:…`) can never match a row, so
 * they can never become an Aoi user by accident.
 *
 * Ordering + idempotency: the dedupe insert and the entitlement write(s)
 * commit in ONE atomic D1 batch — a 5xx always means nothing was recorded,
 * so a provider retry re-applies as a live delivery instead of being
 * discarded as a "duplicate". A delivery applies to a row only when its
 * event_timestamp_ms is NEWER than the row watermark; equal timestamps
 * apply in provider delivery order (RevenueCat supplies no finer ordering
 * than the timestamp, and lexical UUID order is meaningless). Strictly
 * older timestamps are stale no-ops. The watermark lives on the row across
 * status changes and is consulted for inactive/expired rows too, so an
 * older renewal can never resurrect an entitlement a newer
 * expiration/revocation already ended. Every guard is re-checked inside
 * the batch SQL itself (`last_event_at_ms <= ?` / conditional upserts), so
 * concurrent deliveries cannot regress each other between read and write —
 * a guarded write that touches 0 rows reports stale. Processed ids older
 * than the retention window are pruned on every delivery (bounded storage;
 * the provider retry schedule spans hours, retention spans weeks).
 */

export const PLUS_ENTITLEMENT_FALLBACK_ID = 'plus';

interface EntitlementRow {
  space_id: string;
  purchaser_user_id: string;
  provider: string;
  entitlement_id: string;
  product_id: string | null;
  expires_at: number | null;
  status: string;
  last_event_id: string;
  last_event_at_ms: number;
}

export type WebhookOutcome =
  | { readonly applied: true; readonly spaceId: string }
  | { readonly applied: false; readonly reason: 'duplicate' | 'stale' | 'no_space' | 'ignored' };

/**
 * Resolve provider identity candidates to the distinct Aoi user ids that
 * actually exist. Empty/blank candidates are dropped before lookup.
 */
const resolveAoiUsers = (
  db: DbService,
  candidates: readonly (string | null | undefined)[]
): Effect.Effect<string[], InternalError> => {
  const ids = [...new Set(candidates.filter((c): c is string => typeof c === 'string' && c.length > 0))];
  if (ids.length === 0) {
    return Effect.succeed([]);
  }
  return Effect.tryPromise({
    try: async () => {
      const placeholders = ids.map(() => '?').join(',');
      const rows = await db.d1
        .prepare(`select id from users where id in (${placeholders})`)
        .bind(...ids)
        .all<{ id: string }>();
      return [...new Set((rows.results ?? []).map((row) => row.id))];
    },
    catch: () => new InternalError({}),
  });
};

const liveRowForPurchaser = (
  db: DbService,
  purchaserUserId: string,
  now: number
): Effect.Effect<EntitlementRow | null, InternalError> =>
  Effect.tryPromise({
    try: async () =>
      db.d1
        .prepare(
          `select space_id, purchaser_user_id, provider, entitlement_id, product_id,
                  expires_at, status, last_event_id, last_event_at_ms
           from space_plus_entitlements
           where purchaser_user_id = ? and status = 'active'
             and (expires_at is null or expires_at > ?) limit 1`
        )
        .bind(purchaserUserId, now)
        .first<EntitlementRow>(),
    catch: () => new InternalError({}),
  });

/**
 * Newest entitlement row for a purchaser in ANY status (active, inactive,
 * or read-time expired). Ordering watermarks survive expiry/revocation on
 * the row — without this, an older renewal arriving after a newer
 * expiration would find "no live row" and resurrect the entitlement.
 */
const latestRowForPurchaser = (
  db: DbService,
  purchaserUserId: string
): Effect.Effect<EntitlementRow | null, InternalError> =>
  Effect.tryPromise({
    try: async () =>
      db.d1
        .prepare(
          `select space_id, purchaser_user_id, provider, entitlement_id, product_id,
                  expires_at, status, last_event_id, last_event_at_ms
           from space_plus_entitlements
           where purchaser_user_id = ? order by last_event_at_ms desc limit 1`
        )
        .bind(purchaserUserId)
        .first<EntitlementRow>(),
    catch: () => new InternalError({}),
  });

/**
 * Atomic commit for one webhook delivery: the dedupe insert and the
 * entitlement write(s) succeed or fail TOGETHER in one D1 batch (D1
 * executes a batch in a single implicit transaction — same primitive as
 * `effects/d1.batch`, which the transfer path already relies on).
 *
 * - success → the entitlement results (dedupe stripped);
 * - batch conflict on the dedupe PK (a concurrent delivery of the same
 *   event won the race) → `{ duplicate: true }`;
 * - any other batch failure → InternalError (500). The batch is atomic,
 *   so the dedupe row rolled back with it: the provider retry arrives as
 *   a live delivery, never a discarded "duplicate".
 */
const commitDelivery = (
  db: DbService,
  eventId: string,
  now: number,
  writes: readonly D1PreparedStatement[]
): Effect.Effect<{ entitlement: D1Result[] } | { duplicate: true }, InternalError> =>
  Effect.tryPromise({
    try: async () => {
      const dedupe = db.d1
        .prepare('insert into processed_webhook_events (event_id, received_at) values (?, ?)')
        .bind(eventId, now);
      try {
        const results = await db.d1.batch([dedupe, ...writes]);
        return { entitlement: results.slice(1) };
      } catch {
        const seen = await db.d1
          .prepare('select 1 as one from processed_webhook_events where event_id = ?')
          .bind(eventId)
          .first<{ one: number }>();
        if (seen) return { duplicate: true } as const;
        throw new InternalError({});
      }
    },
    catch: (e) => (e instanceof InternalError ? e : new InternalError({})),
  });

const DUPLICATE_OUTCOME = { applied: false, reason: 'duplicate' } as const;

/**
 * Terminal acknowledgement with no entitlement write (unknown purchaser,
 * wrong entitlement, unhandled type, grant with no space…): still records
 * the delivery id race-safely so the provider stops retrying what would
 * never apply.
 */
const recordOnly = (
  db: DbService,
  eventId: string,
  now: number,
  outcome: WebhookOutcome
): Effect.Effect<WebhookOutcome, InternalError> =>
  Effect.map(commitDelivery(db, eventId, now, []), (r) => ('duplicate' in r ? DUPLICATE_OUTCOME : outcome));

/**
 * Apply one RevenueCat webhook delivery. The delivery is authenticated here
 * (static dashboard secret, timing-safe compare) — never trust
 * client-supplied entitlement claims, only verified provider events.
 *
 * Failure semantics (all safe):
 * - missing/unconfigured secret → 500 (fail closed, never accept blind);
 * - wrong secret → 401;
 * - unparseable body → 400 (no state change; RC retries exhaust harmlessly);
 * - well-formed but inapplicable (unknown/ambiguous user, entitlement,
 *   type, stale, duplicate, grant with no active space, ambiguous
 *   transfer) → 200 with applied:false so RC does not retry what would
 *   never apply.
 */
export const processRevenueCatWebhook = (
  authHeader: string | null | undefined,
  body: unknown
): Effect.Effect<
  WebhookOutcome,
  InternalError | UnauthorizedError | BadRequestError,
  DbService | ClockService | LoggerService | ConfigService
> =>
  Effect.gen(function* () {
    const secret = yield* requireConfig('REVENUECAT_WEBHOOK_SECRET');
    const presented = (authHeader ?? '').startsWith('Bearer ')
      ? (authHeader as string).slice('Bearer '.length).trim()
      : (authHeader ?? '').trim();
    if (!secretsEqual(presented, secret)) {
      return yield* Effect.fail(
        new UnauthorizedError({ message: 'Invalid webhook authorization' })
      );
    }

    const parsed = revenueCatWebhookBodySchema.safeParse(body);
    if (!parsed.success) {
      return yield* Effect.fail(badRequest('Invalid webhook payload'));
    }
    const event = parsed.data.event;

    const plusEntitlementId =
      (yield* Effect.map(Config, (c) => c.get('REVENUECAT_PLUS_ENTITLEMENT_ID')))?.trim() ||
      PLUS_ENTITLEMENT_FALLBACK_ID;

    const now = yield* nowMs;
    const db = yield* Db;

    // Bounded retention: drop processed ids far older than any plausible
    // redelivery (best-effort; unrelated to this delivery's atomicity).
    yield* Effect.tryPromise({
      try: () =>
        db.d1
          .prepare('delete from processed_webhook_events where received_at < ?')
          .bind(now - WEBHOOK_EVENT_RETENTION_MS)
          .run(),
      catch: () => new InternalError({}),
    });
    // Fast-path dedupe: redeliveries skip resolution work. The race
    // (two live deliveries of one id) is settled by the atomic commit —
    // the loser re-reads here-equivalent state and reports duplicate.
    const alreadySeen = yield* Effect.tryPromise({
      try: () =>
        db.d1
          .prepare('select 1 as one from processed_webhook_events where event_id = ?')
          .bind(event.id)
          .first<{ one: number }>(),
      catch: () => new InternalError({}),
    });
    if (alreadySeen) {
      return { applied: false, reason: 'duplicate' } as const;
    }

    // Purchaser identity across the provider identity set.
    const purchasers = yield* resolveAoiUsers(db, [
      event.app_user_id,
      event.original_app_user_id,
      ...(event.aliases ?? []),
    ]);
    if (purchasers.length === 0) {
      // Unknown purchaser: nothing truthful to entitle. Acknowledged (the
      // id is recorded) so it is not retried forever.
      yield* logInfo('plus: webhook for unknown purchaser ignored', {});
      return yield* recordOnly(db, event.id, now, { applied: false, reason: 'ignored' } as const);
    }
    if (purchasers.length > 1) {
      // Ambiguous: the identity set spans distinct Aoi users. Fail closed.
      yield* logInfo('plus: webhook with ambiguous purchaser ignored', {});
      return yield* recordOnly(db, event.id, now, { applied: false, reason: 'ignored' } as const);
    }
    const purchaserUserId = purchasers[0];

    const referencesPlus =
      event.entitlement_id === plusEntitlementId ||
      (event.entitlement_ids ?? []).includes(plusEntitlementId);
    if (!referencesPlus) {
      yield* logInfo('plus: webhook without our entitlement ignored', {});
      return yield* recordOnly(db, event.id, now, { applied: false, reason: 'ignored' } as const);
    }

    if (event.type === 'TRANSFER') {
      return yield* applyTransfer(db, now, event, purchaserUserId, plusEntitlementId);
    }

    const isGrant = (PLUS_GRANT_EVENT_TYPES as readonly string[]).includes(event.type);
    const isRevoke = (PLUS_REVOKE_EVENT_TYPES as readonly string[]).includes(event.type);
    if (!isGrant && !isRevoke) {
      // Unknown/unguarded types (CANCELLATION keeps the paid period running
      // to expiry, BILLING_ISSUE stays in grace): acknowledge, change nothing.
      yield* logInfo('plus: webhook type needs no state change', {});
      return yield* recordOnly(db, event.id, now, { applied: false, reason: 'ignored' } as const);
    }

    // Ordering watermark across ALL of this purchaser's rows — live or
    // ended. A stale delivery is acknowledged (provider stops retrying)
    // without touching state.
    const liveRow = yield* liveRowForPurchaser(db, purchaserUserId, now);
    const latestRow = yield* latestRowForPurchaser(db, purchaserUserId);
    const watermark = Math.max(liveRow?.last_event_at_ms ?? -1, latestRow?.last_event_at_ms ?? -1);
    if (event.event_timestamp_ms < watermark) {
      return yield* recordOnly(db, event.id, now, { applied: false, reason: 'stale' } as const);
    }

    if (liveRow) {
      // Refresh in place — the row never moves Spaces (see ownership rule).
      // The watermark predicates re-check the race inside the batch: a
      // concurrent newer delivery commits first → 0 changes → stale.
      const expiresAt = isRevoke ? event.event_timestamp_ms : (event.expiration_at_ms ?? liveRow.expires_at);
      const status = isRevoke ? 'inactive' : liveRow.status;
      const committed = yield* commitDelivery(db, event.id, now, [
        db.d1
          .prepare(
            `update space_plus_entitlements
             set product_id = ?, expires_at = ?, status = ?,
                 last_event_id = ?, last_event_at_ms = ?, updated_at = ?
             where space_id = ?
               and last_event_at_ms <= ?
               and (select coalesce(max(last_event_at_ms), -1) from space_plus_entitlements
                    where purchaser_user_id = ?) <= ?`
          )
          .bind(
            event.product_id ?? liveRow.product_id,
            expiresAt,
            status,
            event.id,
            event.event_timestamp_ms,
            now,
            liveRow.space_id,
            event.event_timestamp_ms,
            purchaserUserId,
            event.event_timestamp_ms
          ),
      ]);
      if ('duplicate' in committed) {
        return { applied: false, reason: 'duplicate' } as const;
      }
      if ((committed.entitlement[0]?.meta?.changes ?? 0) === 0) {
        return { applied: false, reason: 'stale' } as const;
      }
      yield* logInfo('plus: entitlement refreshed in place', {});
      return { applied: true, spaceId: liveRow.space_id } as const;
    }

    // No live row: a revoke ends nothing live. When it is still the newest
    // statement about this purchaser, advance the preserved watermark on
    // the ended row (row stays inactive) so an older grant arriving later
    // cannot resurrect it.
    if (isRevoke) {
      if (latestRow && latestRow.last_event_at_ms <= event.event_timestamp_ms) {
        const committed = yield* commitDelivery(db, event.id, now, [
          db.d1
            .prepare(
              `update space_plus_entitlements
               set last_event_id = ?, last_event_at_ms = ?, updated_at = ?
               where space_id = ? and last_event_at_ms <= ?`
            )
            .bind(event.id, event.event_timestamp_ms, now, latestRow.space_id, event.event_timestamp_ms),
        ]);
        if ('duplicate' in committed) {
          return { applied: false, reason: 'duplicate' } as const;
        }
      } else {
        return yield* recordOnly(db, event.id, now, { applied: false, reason: 'ignored' } as const);
      }
      return { applied: false, reason: 'ignored' } as const;
    }
    const spaceId = yield* getActiveSpaceId(purchaserUserId);
    if (!spaceId) {
      yield* logInfo('plus: grant with no active space ignored', {});
      return yield* recordOnly(db, event.id, now, { applied: false, reason: 'no_space' } as const);
    }

    // Attach to the purchaser's current active Space. The upsert is
    // conditional on both watermarks: a concurrent newer row for this
    // purchaser, or a newer row already on the destination Space, skips
    // the write (0 changes → stale) instead of regressing it.
    const expiresAt = event.expiration_at_ms ?? null;
    const attached = yield* commitDelivery(db, event.id, now, [
      db.d1
        .prepare(
          `insert into space_plus_entitlements
             (space_id, purchaser_user_id, provider, entitlement_id, product_id,
              expires_at, status, last_event_id, last_event_at_ms, created_at, updated_at)
           select ?, ?, 'revenuecat', ?, ?, ?, 'active', ?, ?, ?, ?
           where (select coalesce(max(last_event_at_ms), -1) from space_plus_entitlements
                  where purchaser_user_id = ?) <= ?
           on conflict(space_id) do update set
             purchaser_user_id = excluded.purchaser_user_id,
             provider = excluded.provider,
             entitlement_id = excluded.entitlement_id,
             product_id = excluded.product_id,
             expires_at = excluded.expires_at,
             status = 'active',
             last_event_id = excluded.last_event_id,
             last_event_at_ms = excluded.last_event_at_ms,
             updated_at = excluded.updated_at
           where excluded.last_event_at_ms >= space_plus_entitlements.last_event_at_ms`
        )
        .bind(
          spaceId,
          purchaserUserId,
          plusEntitlementId,
          event.product_id ?? null,
          expiresAt,
          event.id,
          event.event_timestamp_ms,
          now,
          now,
          purchaserUserId,
          event.event_timestamp_ms
        ),
    ]);
    if ('duplicate' in attached) {
      return { applied: false, reason: 'duplicate' } as const;
    }
    if ((attached.entitlement[0]?.meta?.changes ?? 0) === 0) {
      return { applied: false, reason: 'stale' } as const;
    }
    yield* logInfo('plus: entitlement attached', {});
    return { applied: true, spaceId } as const;
  });

/**
 * TRANSFER handler. Invariant: one provider subscription must never leave
 * two unrelated Spaces Plus. The source revoke and destination grant run in
 * ONE atomic batch; anything ambiguous fails closed with no writes at all.
 * Known-entitlement metadata (expiry/product) rides along when the event
 * omits it. A transfer with no known source row only grants when the event
 * itself proves a paid period (expiration_at_ms present) for an unambiguous
 * destination with an active Space — otherwise nothing is fabricated.
 */
const applyTransfer = (
  db: DbService,
  now: number,
  event: RevenueCatWebhookEvent,
  _purchaserUserId: string,
  plusEntitlementId: string
): Effect.Effect<WebhookOutcome, InternalError, DbService | LoggerService> =>
  Effect.gen(function* () {
    const destinations = yield* resolveAoiUsers(db, event.transferred_to ?? []);
    if (destinations.length !== 1) {
      yield* logInfo('plus: transfer with ambiguous destination ignored', {});
      return yield* recordOnly(db, event.id, now, { applied: false, reason: 'ignored' } as const);
    }
    const destinationUserId = destinations[0];

    const sources = yield* resolveAoiUsers(db, event.transferred_from ?? []);
    // Liveness is per-row, but ambiguity is about distinct Spaces — ask
    // distinctly so two live rows can never collapse into one blind move.
    const sourceSpaces = yield* Effect.tryPromise({
      try: async () => {
        if (sources.length === 0) return [];
        const placeholders = sources.map(() => '?').join(',');
        const rows = await db.d1
          .prepare(
            `select distinct space_id from space_plus_entitlements
             where purchaser_user_id in (${placeholders}) and status = 'active'
               and (expires_at is null or expires_at > ?)`
          )
          .bind(...sources, now)
          .all<{ space_id: string }>();
        return (rows.results ?? []).map((row) => row.space_id);
      },
      catch: () => new InternalError({}),
    });
    if (sourceSpaces.length > 1) {
      yield* logInfo('plus: transfer with ambiguous source ignored', {});
      return yield* recordOnly(db, event.id, now, { applied: false, reason: 'ignored' } as const);
    }
    const sourceRow =
      sourceSpaces.length === 1
        ? yield* Effect.tryPromise({
          try: () =>
            db.d1
              .prepare(
                `select space_id, purchaser_user_id, provider, entitlement_id, product_id,
                        expires_at, status, last_event_id, last_event_at_ms
                 from space_plus_entitlements where space_id = ? limit 1`
              )
              .bind(sourceSpaces[0])
              .first<EntitlementRow>(),
          catch: () => new InternalError({}),
        })
        : null;

    const destinationSpaceId = yield* getActiveSpaceId(destinationUserId);
    if (!destinationSpaceId) {
      // Nowhere truthful to grant: leave the source row untouched rather
      // than destroying paid access with no destination.
      yield* logInfo('plus: transfer with spaceless destination ignored', {});
      return yield* recordOnly(db, event.id, now, { applied: false, reason: 'no_space' } as const);
    }

    if (sourceRow) {
      if (event.event_timestamp_ms < sourceRow.last_event_at_ms) {
        return yield* recordOnly(db, event.id, now, { applied: false, reason: 'stale' } as const);
      }
      const expiresAt = event.expiration_at_ms ?? sourceRow.expires_at;
      const productId = event.product_id ?? sourceRow.product_id;
      if (sourceRow.space_id === destinationSpaceId) {
        // Same Space on both ends: refresh in place, adopting the new owner.
        const committed = yield* commitDelivery(db, event.id, now, [
          db.d1
            .prepare(
              `update space_plus_entitlements
               set purchaser_user_id = ?, product_id = ?, expires_at = ?,
                   last_event_id = ?, last_event_at_ms = ?, updated_at = ?
               where space_id = ? and last_event_at_ms <= ?`
            )
            .bind(
              destinationUserId,
              productId,
              expiresAt,
              event.id,
              event.event_timestamp_ms,
              now,
              sourceRow.space_id,
              event.event_timestamp_ms
            ),
        ]);
        if ('duplicate' in committed) {
          return { applied: false, reason: 'duplicate' } as const;
        }
        if ((committed.entitlement[0]?.meta?.changes ?? 0) === 0) {
          return { applied: false, reason: 'stale' } as const;
        }
        yield* logInfo('plus: transfer refreshed within one space', {});
        return { applied: true, spaceId: sourceRow.space_id } as const;
      }
      // Destination may already carry a newer row — never regress it.
      const destRow = yield* Effect.tryPromise({
        try: () =>
          db.d1
            .prepare(
              `select last_event_id, last_event_at_ms from space_plus_entitlements where space_id = ? limit 1`
            )
            .bind(destinationSpaceId)
            .first<Pick<EntitlementRow, 'last_event_id' | 'last_event_at_ms'>>(),
        catch: () => new InternalError({}),
      });
      if (destRow && event.event_timestamp_ms < destRow.last_event_at_ms) {
        return yield* recordOnly(db, event.id, now, { applied: false, reason: 'stale' } as const);
      }
      // Source revoke + destination grant in ONE atomic batch with the
      // dedupe insert. The destination write is additionally gated on the
      // source row: it applies only when the source update did (the source
      // subquery reads the post-update row inside the same batch), so a
      // conflicting transfer that already moved the source can never
      // fabricate a second live row here.
      const moved = yield* commitDelivery(db, event.id, now, [
        db.d1
          .prepare(
            `update space_plus_entitlements
             set status = 'inactive', last_event_id = ?, last_event_at_ms = ?, updated_at = ?
             where space_id = ? and last_event_at_ms <= ?`
          )
          .bind(event.id, event.event_timestamp_ms, now, sourceRow.space_id, event.event_timestamp_ms),
        db.d1
          .prepare(
            `insert into space_plus_entitlements
               (space_id, purchaser_user_id, provider, entitlement_id, product_id,
                expires_at, status, last_event_id, last_event_at_ms, created_at, updated_at)
             select ?, ?, 'revenuecat', ?, ?, ?, 'active', ?, ?, ?, ?
             where (select last_event_at_ms from space_plus_entitlements where space_id = ?) <= ?
             on conflict(space_id) do update set
               purchaser_user_id = excluded.purchaser_user_id,
               provider = excluded.provider,
               entitlement_id = excluded.entitlement_id,
               product_id = excluded.product_id,
               expires_at = excluded.expires_at,
               status = 'active',
               last_event_id = excluded.last_event_id,
               last_event_at_ms = excluded.last_event_at_ms,
               updated_at = excluded.updated_at
             where excluded.last_event_at_ms >= space_plus_entitlements.last_event_at_ms
               and (select last_event_at_ms from space_plus_entitlements where space_id = ?)
                   <= excluded.last_event_at_ms`
          )
          .bind(
            destinationSpaceId,
            destinationUserId,
            plusEntitlementId,
            productId,
            expiresAt,
            event.id,
            event.event_timestamp_ms,
            now,
            now,
            sourceRow.space_id,
            event.event_timestamp_ms,
            sourceRow.space_id
          ),
      ]);
      if ('duplicate' in moved) {
        return { applied: false, reason: 'duplicate' } as const;
      }
      const [sourceChanges, destChanges] = moved.entitlement.map((r) => r.meta?.changes ?? 0);
      if (sourceChanges === 0) {
        // A newer event moved the source first; the destination gate held
        // with it, so nothing changed.
        return { applied: false, reason: 'stale' } as const;
      }
      if (destChanges === 0) {
        // Source legitimately revoked, but the destination already carries
        // its own newer entitlement — kept, never regressed.
        yield* logInfo('plus: transfer revoked source; destination kept newer row', {});
        return { applied: true, spaceId: destinationSpaceId } as const;
      }
      yield* logInfo('plus: transfer moved atomically', {});
      return { applied: true, spaceId: destinationSpaceId } as const;
    }

    // No known source row: grant only on provider-proof of a paid period.
    if (event.expiration_at_ms === undefined) {
      yield* logInfo('plus: sourceless transfer without expiry ignored', {});
      return yield* recordOnly(db, event.id, now, { applied: false, reason: 'ignored' } as const);
    }
    const granted = yield* commitDelivery(db, event.id, now, [
      db.d1
        .prepare(
          `insert into space_plus_entitlements
             (space_id, purchaser_user_id, provider, entitlement_id, product_id,
              expires_at, status, last_event_id, last_event_at_ms, created_at, updated_at)
           select ?, ?, 'revenuecat', ?, ?, ?, 'active', ?, ?, ?, ?
           where (select coalesce(max(last_event_at_ms), -1) from space_plus_entitlements
                  where purchaser_user_id = ?) <= ?
           on conflict(space_id) do update set
             purchaser_user_id = excluded.purchaser_user_id,
             provider = excluded.provider,
             entitlement_id = excluded.entitlement_id,
             product_id = excluded.product_id,
             expires_at = excluded.expires_at,
             status = 'active',
             last_event_id = excluded.last_event_id,
             last_event_at_ms = excluded.last_event_at_ms,
             updated_at = excluded.updated_at
           where excluded.last_event_at_ms >= space_plus_entitlements.last_event_at_ms`
        )
        .bind(
          destinationSpaceId,
          destinationUserId,
          plusEntitlementId,
          event.product_id ?? null,
          event.expiration_at_ms,
          event.id,
          event.event_timestamp_ms,
          now,
          now,
          destinationUserId,
          event.event_timestamp_ms
        ),
    ]);
    if ('duplicate' in granted) {
      return { applied: false, reason: 'duplicate' } as const;
    }
    if ((granted.entitlement[0]?.meta?.changes ?? 0) === 0) {
      return { applied: false, reason: 'stale' } as const;
    }
    yield* logInfo('plus: sourceless transfer granted on provider proof', {});
    return { applied: true, spaceId: destinationSpaceId } as const;
  });

/**
 * Authoritative Plus read for the caller's Space. Both active members of
 * the same Space observe the identical row. Callers without an active Space
 * (or with an expired/inactive row) observe inactive — which reveals nothing
 * about any other Space.
 *
 * Usage fields ride along so Space UI/paywall can show truthful limits
 * without a second round trip. Downgrade-safe by construction: existing
 * content is only ever READ here, never hidden or removed.
 */
export const getSpacePlusProgram = (
  userId: string
): Effect.Effect<SpacePlusResponse, InternalError, DbService | ClockService> =>
  Effect.gen(function* () {
    const now = yield* nowMs;
    const spaceId = yield* getActiveSpaceId(userId);
    if (!spaceId) {
      return {
        isPlus: false,
        status: 'inactive',
        expiresAt: null,
        mediaUsedBytes: 0,
        mediaLimitBytes: FREE_MEDIA_BYTES,
        activeFutureLetters: 0,
        futureLetterLimit: FREE_FUTURE_LETTERS,
      } as const;
    }
    const db = yield* Db;
    const usage = yield* readSpaceUsage(db.d1, spaceId, now);
    return {
      isPlus: usage.isPlus,
      status: usage.isPlus ? ('active' as const) : ('inactive' as const),
      expiresAt: usage.expiresAt,
      mediaUsedBytes: usage.mediaUsedBytes,
      mediaLimitBytes: usage.mediaLimitBytes,
      activeFutureLetters: usage.activeFutureLetters,
      futureLetterLimit: usage.futureLetterLimit,
    };
  });

/**
 * Single shared usage computation for one Space: Plus liveness plus the
 * counted usage both enforcement paths rely on. `db` is the raw D1 binding
 * (callers already hold Db) so media/letters enforcement and the read path
 * can never disagree on what "used" means.
 *
 * Media counts photo + voice rows with upload_state in (pending, complete)
 * that are not soft-deleted, by authoritative stored size_bytes (reconciled
 * to the real object size at complete-time). Pending intents reserve their
 * declared size, so in-flight uploads count against quota; abandoned ones
 * release when the staged cron purges them.
 */
export interface SpaceUsage {
  readonly isPlus: boolean;
  readonly expiresAt: string | null;
  readonly mediaUsedBytes: number;
  readonly mediaLimitBytes: number;
  readonly activeFutureLetters: number;
  readonly futureLetterLimit: number | null;
}

export const readSpaceUsage = (
  d1: {
    prepare(sql: string): {
      bind(...values: unknown[]): {
        first<T = unknown>(): Promise<T | null>;
      };
    };
  },
  spaceId: string,
  now: number
): Effect.Effect<SpaceUsage, InternalError> =>
  Effect.tryPromise({
    try: async () => {
      const plusRow = await d1
        .prepare(`select status, expires_at from space_plus_entitlements where space_id = ? limit 1`)
        .bind(spaceId)
        .first<{ status: string; expires_at: number | null }>();
      const live =
        !!plusRow &&
        plusRow.status === 'active' &&
        (plusRow.expires_at === null || plusRow.expires_at > now);
      const mediaRow = await d1
        .prepare(
          `select coalesce(sum(size_bytes), 0) as used from media_objects
           where space_id = ? and deleted_at is null and upload_state in ('pending', 'complete')`
        )
        .bind(spaceId)
        .first<{ used: number }>();
      const lettersRow = await d1
        .prepare(`select count(*) as active from letters where space_id = ? and opened_at is null`)
        .bind(spaceId)
        .first<{ active: number }>();
      return {
        isPlus: live,
        expiresAt:
          plusRow && plusRow.expires_at !== null ? new Date(plusRow.expires_at).toISOString() : null,
        mediaUsedBytes: mediaRow?.used ?? 0,
        mediaLimitBytes: mediaLimitForSpace(live),
        activeFutureLetters: lettersRow?.active ?? 0,
        futureLetterLimit: futureLetterLimitForSpace(live),
      };
    },
    catch: () => new InternalError({}),
  });
