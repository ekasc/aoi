import { Hono } from 'hono';
import type { Context } from 'hono';
import { z } from 'zod';
import { zValidator } from '@hono/zod-validator';
import { and, eq, isNotNull, isNull, lt, or } from 'drizzle-orm';
import {
  LOCATION_ACCURACY_MAX_METERS,
  LOCATION_DESTINATION_NAME_MAX_LENGTH,
  LOCATION_DESTINATION_RADIUS_MAX_METERS,
  LOCATION_LIVE_FRESHNESS_MINUTES,
  LOCATION_SHARE_MODES,
  isLocationShareFresh,
  type CurrentLocationResponse,
} from '@aoi/shared';
import { db } from '../db/index.js';
import { locationShares, spaceMembers, spaces, users } from '../db/schema.js';
import { badRequest, forbidden } from '../lib/errors.js';
import { locationShareRowToApi } from '../lib/db.js';
import { getActiveSpaceId } from '../lib/space.js';
import { notifyPartnerInSpace } from '../lib/push.js';
import { rateLimit } from '../middleware/rate-limit.js';

const locationRouter = new Hono();

/**
 * Optional, consensual, bounded location sharing.
 *
 * Privacy rules enforced here (see CONTEXT.md / TODOS §2):
 * - BOTH partners must be opted in before any position flows (both-consent
 *   gate). Consent lives on `space_members.location_consent_at` — the
 *   simplest correct design: the member row already exists, consent is one
 *   nullable timestamp, revocation clears it.
 * - Only the single latest position per user is stored (unique user id on
 *   `location_shares`); STOP deletes the row outright. No history, ever.
 * - Coordinates NEVER appear in logs or error strings: every validation
 *   failure returns one fixed word-only message via `validationHook`, and no
 *   handler logs request content.
 * - Archived spaces are hard-off for location sharing.
 */

// ── Validation (word-only error messages — never echo numbers) ───────────

const INVALID_LOCATION = 'Invalid location';
const INVALID_DESTINATION = 'Invalid destination';

function validationHook(
  result: { success: boolean },
  c: Context
): Response | undefined {
  if (result.success) {
    return undefined;
  }

  // One calm, fixed message. Zod issue details (which can carry numeric
  // bounds) never reach the client, a log, or an error string.
  return c.json(
    { error: { code: 'BAD_REQUEST', message: INVALID_LOCATION } },
    400
  );
}

// Custom messages everywhere: zod defaults echo numeric bounds, and error
// strings must never contain anything resembling coordinates.
const latitudeSchema = (message: string) =>
  z
    .number({ invalid_type_error: message })
    .finite()
    .gte(-90, message)
    .lte(90, message);

const longitudeSchema = (message: string) =>
  z
    .number({ invalid_type_error: message })
    .finite()
    .gte(-180, message)
    .lte(180, message);

const locationDestinationSchema = z.object({
  name: z
    .string()
    .trim()
    .min(1, INVALID_DESTINATION)
    .max(LOCATION_DESTINATION_NAME_MAX_LENGTH, INVALID_DESTINATION),
  latitude: latitudeSchema(INVALID_DESTINATION),
  longitude: longitudeSchema(INVALID_DESTINATION),
  radiusMeters: z
    .number({ invalid_type_error: INVALID_DESTINATION })
    .finite()
    .positive(INVALID_DESTINATION)
    .max(LOCATION_DESTINATION_RADIUS_MAX_METERS, INVALID_DESTINATION),
});

const shareLocationSchema = z
  .object({
    mode: z.enum(LOCATION_SHARE_MODES, {
      errorMap: () => ({ message: INVALID_LOCATION }),
    }),
    latitude: latitudeSchema(INVALID_LOCATION),
    longitude: longitudeSchema(INVALID_LOCATION),
    accuracyMeters: z
      .number({ invalid_type_error: INVALID_LOCATION })
      .finite()
      .positive(INVALID_LOCATION)
      .max(LOCATION_ACCURACY_MAX_METERS, INVALID_LOCATION)
      .optional(),
    destination: locationDestinationSchema.optional(),
  })
  .refine((input) => input.mode !== 'until_arrive' || input.destination, {
    message: INVALID_DESTINATION,
  });

const consentSchema = z.object({
  consented: z.boolean({ invalid_type_error: INVALID_LOCATION }),
});

// ── Space context helper ─────────────────────────────────────────────────

type LocationSpaceContext = {
  archived: boolean;
  youConsented: boolean;
  partnerConsented: boolean;
  partnerUserId: string | null;
};

const NO_SPACE_RESPONSE: CurrentLocationResponse = {
  location: null,
  youConsented: false,
  partnerConsented: false,
};

/**
 * Membership + consent context for the caller's current space. Returns null
 * when the caller is not an active member (existence-leak-safe: every route
 * then answers as if nothing exists).
 */
async function getLocationSpaceContext(
  spaceId: string,
  userId: string
): Promise<LocationSpaceContext | null> {
  const [space] = await db
    .select({ archivedAt: spaces.archivedAt })
    .from(spaces)
    .where(eq(spaces.id, spaceId))
    .limit(1);

  if (!space) {
    return null;
  }

  const members = await db
    .select({
      userId: spaceMembers.userId,
      locationConsentAt: spaceMembers.locationConsentAt,
    })
    .from(spaceMembers)
    .where(
      and(eq(spaceMembers.spaceId, spaceId), eq(spaceMembers.state, 'active'))
    );

  const caller = members.find((member) => member.userId === userId);

  if (!caller) {
    return null;
  }

  const partner = members.find((member) => member.userId !== userId) ?? null;

  return {
    archived: space.archivedAt !== null,
    youConsented: caller.locationConsentAt !== null,
    partnerConsented: partner !== null && partner.locationConsentAt !== null,
    partnerUserId: partner?.userId ?? null,
  };
}

// ── TTL sweeper ──────────────────────────────────────────────────────────
// GET deletes a stale row when it happens to meet one, but if nobody GETs
// (force-quit, an unopened one-time grant) the row would linger at rest.
// Every share/report and opt-in gives the space a best-effort sweep, so an
// expired location leaves no record even when nobody is looking. A failed
// sweep must never break a request.

async function sweepExpiredLocationShares(spaceId: string): Promise<void> {
  const cutoff = new Date(
    Date.now() - LOCATION_LIVE_FRESHNESS_MINUTES * 60_000
  );

  try {
    await db
      .delete(locationShares)
      .where(
        and(
          eq(locationShares.spaceId, spaceId),
          or(
            lt(locationShares.reportedAt, cutoff),
            isNotNull(locationShares.consumedAt)
          )
        )
      );
  } catch {
    // Best effort only.
  }
}

// ── GET current partner location ─────────────────────────────────────────
// Returns the PARTNER's current share only when: both consented, a row
// exists, and it is fresh. Everything else answers `{ location: null }`
// with a calm 200 — never an error, never the caller's own row.
//
// Freshness: live / until_arrive reports stay servable for
// LOCATION_LIVE_FRESHNESS_MINUTES; a one-time grant
// (on_request_granted) for LOCATION_GRANT_FRESHNESS_MINUTES and ONE read
// only — serving it marks it consumed (see below). Stale rows are deleted
// outright on sight (expire-purge): a location that has expired leaves no
// record behind.

locationRouter.get('/v1/spaces/current/location', async (c) => {
  const userId = c.var.userId;

  const spaceId = await getActiveSpaceId(userId);
  if (!spaceId) {
    return c.json(NO_SPACE_RESPONSE);
  }

  const context = await getLocationSpaceContext(spaceId, userId);
  if (!context || context.archived) {
    return c.json(NO_SPACE_RESPONSE);
  }

  const { youConsented, partnerConsented, partnerUserId } = context;

  if (!youConsented || !partnerConsented || !partnerUserId) {
    return c.json({ location: null, youConsented, partnerConsented });
  }

  // Consent re-check + row read in ONE transaction: a revocation that lands
  // mid-GET cannot serve one last fix (the consent gate above is a fast
  // path; this is the atomic one). The read is space-scoped as well.
  const share = await db.transaction(async (tx) => {
    const [member] = await tx
      .select({ locationConsentAt: spaceMembers.locationConsentAt })
      .from(spaceMembers)
      .where(
        and(
          eq(spaceMembers.spaceId, spaceId),
          eq(spaceMembers.userId, partnerUserId),
          eq(spaceMembers.state, 'active')
        )
      )
      .limit(1);

    if (!member || member.locationConsentAt === null) {
      return null;
    }

    const [row] = await tx
      .select()
      .from(locationShares)
      .where(
        and(
          eq(locationShares.userId, partnerUserId),
          eq(locationShares.spaceId, spaceId)
        )
      )
      .limit(1);

    return row ?? null;
  });

  if (!share) {
    return c.json({ location: null, youConsented, partnerConsented });
  }

  const now = new Date();

  if (!isLocationShareFresh(share.mode, share.reportedAt.getTime(), now.getTime())) {
    // Expire-purge: the row outlived its window, so it is deleted outright.
    await db.delete(locationShares).where(eq(locationShares.id, share.id));
    return c.json({ location: null, youConsented, partnerConsented });
  }

  if (share.mode === 'on_request_granted') {
    if (share.consumedAt !== null) {
      // One-time consumption rule: a grant is served exactly once. After
      // that it reads as nothing — it can never be polled repeatedly.
      return c.json({ location: null, youConsented, partnerConsented });
    }

    // Consume atomically: the scoped UPDATE only matches while consumed_at
    // IS NULL, so two racing reads can never both be served.
    const [consumed] = await db
      .update(locationShares)
      .set({ consumedAt: now })
      .where(
        and(eq(locationShares.id, share.id), isNull(locationShares.consumedAt))
      )
      .returning({ id: locationShares.id });

    if (!consumed) {
      return c.json({ location: null, youConsented, partnerConsented });
    }
  }

  return c.json({
    location: locationShareRowToApi(share),
    youConsented,
    partnerConsented,
  });
});

// ── POST share (upsert the caller's latest position) ────────────────────
// Writes ONLY when both partners have consented; `reportedAt` is always
// server-assigned. Granting a request (mode on_request_granted) notifies
// the partner with kind location_granted so their app fetches GET.

locationRouter.post(
  '/v1/spaces/current/location/share',
  zValidator('json', shareLocationSchema, validationHook),
  async (c) => {
    const userId = c.var.userId;

    const spaceId = await getActiveSpaceId(userId);
    if (!spaceId) {
      throw badRequest('You must have an active space to share your location');
    }

    const context = await getLocationSpaceContext(spaceId, userId);
    if (!context) {
      throw badRequest('You must have an active space to share your location');
    }

    if (context.archived) {
      throw forbidden('Location sharing is not available in this space');
    }

    if (!context.youConsented || !context.partnerConsented) {
      throw forbidden('Both partners need to opt in before sharing locations');
    }

    void sweepExpiredLocationShares(spaceId);

    const input = c.req.valid('json');
    const now = new Date();

    const values = {
      spaceId,
      mode: input.mode,
      destination: input.destination ?? null,
      latitude: input.latitude,
      longitude: input.longitude,
      accuracyMeters: input.accuracyMeters ?? null,
      reportedAt: now,
      updatedAt: now,
    };

    await db
      .insert(locationShares)
      .values({ ...values, userId, consumedAt: null })
      .onConflictDoUpdate({
        target: [locationShares.userId],
        // A fresh report always resets consumption — a new grant is a new
        // one-time share.
        set: { ...values, consumedAt: null },
      });

    if (input.mode === 'on_request_granted') {
      const [sender] = await db
        .select({ displayName: users.displayName })
        .from(users)
        .where(eq(users.id, userId))
        .limit(1);

      await notifyPartnerInSpace(
        spaceId,
        userId,
        'location_granted',
        sender?.displayName
      );
    }

    return c.json({ ok: true }, 201);
  }
);

// ── DELETE share (stop) ──────────────────────────────────────────────────
// One tap, idempotent, no confirmation. Deletes the caller's row outright
// and lets the partner know (kind location_stopped) when there was one.

locationRouter.delete('/v1/spaces/current/location/share', async (c) => {
  const userId = c.var.userId;

  const spaceId = await getActiveSpaceId(userId);
  if (!spaceId) {
    // Nothing to stop — identical response either way (no existence leaks).
    return c.json({ ok: true });
  }

  const [removed] = await db
    .delete(locationShares)
    .where(
      and(eq(locationShares.userId, userId), eq(locationShares.spaceId, spaceId))
    )
    .returning({ id: locationShares.id });

  if (removed) {
    await notifyPartnerInSpace(spaceId, userId, 'location_stopped');
  }

  return c.json({ ok: true });
});

// ── POST consent (opt in / out) ──────────────────────────────────────────
// Revoking consent also deletes any share row and tells the partner
// (kind location_stopped). One tap either way, no guilt copy.

locationRouter.post(
  '/v1/spaces/current/location/consent',
  zValidator('json', consentSchema, validationHook),
  async (c) => {
    const userId = c.var.userId;

    const spaceId = await getActiveSpaceId(userId);
    if (!spaceId) {
      throw badRequest('You must have an active space to update location consent');
    }

    const context = await getLocationSpaceContext(spaceId, userId);
    if (!context) {
      throw badRequest('You must have an active space to update location consent');
    }

    if (context.archived) {
      throw forbidden('Location sharing is not available in this space');
    }

    const { consented } = c.req.valid('json');
    const now = new Date();

    await db
      .update(spaceMembers)
      .set({ locationConsentAt: consented ? now : null })
      .where(
        and(
          eq(spaceMembers.spaceId, spaceId),
          eq(spaceMembers.userId, userId),
          eq(spaceMembers.state, 'active')
        )
      );

    if (!consented) {
      const [removed] = await db
        .delete(locationShares)
        .where(
          and(
            eq(locationShares.userId, userId),
            eq(locationShares.spaceId, spaceId)
          )
        )
        .returning({ id: locationShares.id });

      if (removed) {
        await notifyPartnerInSpace(spaceId, userId, 'location_stopped');
      }
    } else {
      void sweepExpiredLocationShares(spaceId);
    }

    return c.json({
      youConsented: consented,
      partnerConsented: context.partnerConsented,
    });
  }
);

// ── POST request (ask the partner for a one-time share) ─────────────────
// Mutuality: you can only ask if you also consented to share. Sends a push
// (kind location_request, sender name in the copy, NEVER coordinates).
// Gentle cap: 3 requests/min per sender.

const locationRequestRateLimit = rateLimit({
  max: 3,
  windowSec: 60,
  keyFn: (c) => `location-request:${c.var.userId ?? 'unknown'}`,
});

locationRouter.post(
  '/v1/spaces/current/location/request',
  locationRequestRateLimit,
  async (c) => {
    const userId = c.var.userId;

    const spaceId = await getActiveSpaceId(userId);
    if (!spaceId) {
      throw badRequest('You must have an active space to request a location');
    }

    const context = await getLocationSpaceContext(spaceId, userId);
    if (!context) {
      throw badRequest('You must have an active space to request a location');
    }

    if (context.archived) {
      throw forbidden('Location sharing is not available in this space');
    }

    if (!context.youConsented) {
      throw forbidden('You can only ask when you have opted in yourself');
    }

    // Never deliver a request push to a partner who revoked — mutuality is
    // checked at send time, not just on the client.
    if (!context.partnerConsented) {
      throw forbidden('Your partner also needs to opt in before you can ask');
    }

    void sweepExpiredLocationShares(spaceId);

    const [sender] = await db
      .select({ displayName: users.displayName })
      .from(users)
      .where(eq(users.id, userId))
      .limit(1);

    // Push carries kind + name only — coordinates never enter a payload.
    await notifyPartnerInSpace(
      spaceId,
      userId,
      'location_request',
      sender?.displayName
    );

    return c.json({ ok: true }, 202);
  }
);

export { locationRouter };
