import { Hono } from 'hono';
import { z, type ZodError } from 'zod';
import { zValidator } from '@hono/zod-validator';
import { eq, and, isNull, desc } from 'drizzle-orm';
import {
  LETTER_BODY_MAX_LENGTH,
  LETTER_CAPTION_MAX_LENGTH,
  LETTER_SEAL_MAX_HORIZON_DAYS,
  sortLettersNewestFirst,
} from '@aoi/shared';
import { db } from '../db/index.js';
import { letters, spaceMembers, users } from '../db/schema.js';
import { badRequest, notFound } from '../lib/errors.js';
import { letterRowToApi } from '../lib/db.js';
import { getActiveSpaceId } from '../lib/space.js';
import { notifyPartnerInSpace } from '../lib/push.js';

const lettersRouter = new Hono();

// Letters / time capsule: write a letter, seal it to a future day. Sealed
// letters are IMMUTABLE — there is deliberately no PATCH or DELETE route
// here. Unopened bodies never leave the server (serializer-enforced), and
// opening is a one-way atomic transition. Letter bodies are never logged;
// every error surfaced below is a fixed word-only string.

const DAY_MS = 24 * 60 * 60 * 1000;

// ── Helpers ──────────────────────────────────────────────────────────────

/**
 * Surface zod failures as the house ApiError shape with the schema's own
 * word-only messages (never numbers, never echoed dates).
 */
function throwFirstIssue(result: { success: boolean; error?: ZodError }): void {
  if (result.success) {
    return;
  }
  const message = result.error?.issues[0]?.message ?? "That letter can't be sealed yet";
  throw badRequest(message);
}

async function fetchLetterWithAuthor(letterId: string) {
  const rows = await db
    .select({
      id: letters.id,
      authorUserId: letters.authorUserId,
      authorName: users.displayName,
      caption: letters.caption,
      body: letters.body,
      sealedUntil: letters.sealedUntil,
      createdAt: letters.createdAt,
      openedAt: letters.openedAt,
      spaceId: letters.spaceId,
    })
    .from(letters)
    .innerJoin(users, eq(letters.authorUserId, users.id))
    .where(eq(letters.id, letterId))
    .limit(1);

  return rows[0] ?? null;
}

async function isSpaceMember(spaceId: string, userId: string): Promise<boolean> {
  const [membership] = await db
    .select()
    .from(spaceMembers)
    .where(
      and(
        eq(spaceMembers.spaceId, spaceId),
        eq(spaceMembers.userId, userId),
        eq(spaceMembers.state, 'active')
      )
    )
    .limit(1);

  return Boolean(membership);
}

// ── Seal a letter ────────────────────────────────────────────────────────
// Sealing is final: the row is written once and never touched again except
// by the open transition. The response already omits the body — the author
// cannot re-read what they just sealed.

const sealLetterSchema = z.object({
  caption: z
    .string({ required_error: 'Keep the caption to a few words' })
    .trim()
    .max(LETTER_CAPTION_MAX_LENGTH, 'Keep the caption to a few words')
    .optional(),
  body: z
    .string({ required_error: 'A letter needs a few words' })
    .trim()
    .min(1, 'A letter needs a few words')
    .max(LETTER_BODY_MAX_LENGTH, 'That letter is a little too long to seal'),
  sealedUntil: z.string({
    required_error: "That opening day doesn't look quite right",
  }).datetime({ offset: true, message: "That opening day doesn't look quite right" }),
});

lettersRouter.post(
  '/v1/spaces/current/letters',
  zValidator('json', sealLetterSchema, (result) => throwFirstIssue(result)),
  async (c) => {
    const userId = c.var.userId;

    const spaceId = await getActiveSpaceId(userId);
    if (!spaceId) {
      throw badRequest('You must have an active space to seal a letter');
    }

    const input = c.req.valid('json');
    const now = new Date();
    const sealedUntil = new Date(input.sealedUntil);

    // The seal must land strictly in the future…
    if (!(sealedUntil.getTime() > now.getTime())) {
      throw badRequest('A letter can only open in the future');
    }

    // …and within the horizon (word-only decline — never echo the date).
    const horizonMs = LETTER_SEAL_MAX_HORIZON_DAYS * DAY_MS;
    if (sealedUntil.getTime() > now.getTime() + horizonMs) {
      throw badRequest("That's farther away than letters can wait");
    }

    const [created] = await db
      .insert(letters)
      .values({
        spaceId,
        authorUserId: userId,
        caption: input.caption && input.caption.length > 0 ? input.caption : null,
        body: input.body,
        sealedUntil,
        createdAt: now,
      })
      .returning();

    // The partner hears that something was sealed — never what, never when.
    // Fire-and-forget like moments: push must never stall the seal.
    void notifyPartnerInSpace(spaceId, userId, 'letter_sealed');

    const [author] = await db
      .select({ displayName: users.displayName })
      .from(users)
      .where(eq(users.id, userId))
      .limit(1);

    return c.json(
      letterRowToApi(
        { ...created, authorName: author?.displayName ?? 'You' },
        userId,
        now
      ),
      201
    );
  }
);

// ── List the shelf ───────────────────────────────────────────────────────
// Every letter in the space, newest first. Unopened letters come back
// without a body — for the partner AND for the author who sealed them.

lettersRouter.get('/v1/spaces/current/letters', async (c) => {
  const userId = c.var.userId;

  const spaceId = await getActiveSpaceId(userId);
  if (!spaceId) {
    return c.json({ letters: [] });
  }

  const now = new Date();

  const rows = await db
    .select({
      id: letters.id,
      authorUserId: letters.authorUserId,
      authorName: users.displayName,
      caption: letters.caption,
      body: letters.body,
      sealedUntil: letters.sealedUntil,
      createdAt: letters.createdAt,
      openedAt: letters.openedAt,
    })
    .from(letters)
    .innerJoin(users, eq(letters.authorUserId, users.id))
    .where(eq(letters.spaceId, spaceId))
    .orderBy(desc(letters.createdAt), desc(letters.id));

  const items = sortLettersNewestFirst(
    rows.map((row) => letterRowToApi(row, userId, now))
  );

  return c.json({ letters: items });
});

// ── Open a letter ────────────────────────────────────────────────────────
// If it is due and still sealed, opening is one atomic UPDATE
// (`WHERE opened_at IS NULL`), so two people tapping at once never race:
// one writes, the other reads the opened row. Not due → a calm 400 with no
// body. Already open → an idempotent read. Non-members (and ids from other
// spaces) get a 404 — no existence leaks.

lettersRouter.post(
  '/v1/letters/:id/open',
  zValidator('param', z.object({ id: z.string().uuid() })),
  async (c) => {
    const userId = c.var.userId;
    const letterId = c.req.param('id');
    const now = new Date();

    const existing = await fetchLetterWithAuthor(letterId);

    if (!existing) {
      throw notFound('Letter not found');
    }

    const member = await isSpaceMember(existing.spaceId, userId);
    if (!member) {
      // Another space's letter is indistinguishable from no letter at all.
      throw notFound('Letter not found');
    }

    if (existing.openedAt !== null) {
      // Already open — reading it again is quiet and idempotent.
      return c.json(letterRowToApi(existing, userId, now));
    }

    if (now.getTime() < existing.sealedUntil.getTime()) {
      throw badRequest('Not yet time');
    }

    const [opened] = await db
      .update(letters)
      .set({ openedAt: now, openedByUserId: userId })
      .where(and(eq(letters.id, letterId), isNull(letters.openedAt)))
      .returning();

    if (opened) {
      return c.json(
        letterRowToApi(
          { ...opened, authorName: existing.authorName },
          userId,
          now
        )
      );
    }

    // Lost the race: someone else opened it between the check and the
    // write. Read the freshly opened row instead of failing (membership was
    // already established for this very letter, and letters never change
    // spaces — there is no update surface at all).
    const fresh = await fetchLetterWithAuthor(letterId);
    if (!fresh) {
      throw notFound('Letter not found');
    }

    return c.json(letterRowToApi(fresh, userId, now));
  }
);

export { lettersRouter };
