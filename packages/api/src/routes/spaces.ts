import { Hono } from 'hono';
import { z } from 'zod';
import { zValidator } from '@hono/zod-validator';
import { eq, and, isNull, desc } from 'drizzle-orm';
import { db } from '../db/index.js';
import { spaces, spaceMembers, spaceInvites } from '../db/schema.js';
import { badRequest, notFound, forbidden, conflict } from '../lib/errors.js';
import { generateInviteCode, normalizeInviteCode } from '../lib/crypto.js';
import { spaceRowToApi } from '../lib/db.js';

const spacesRouter = new Hono();

// ── Get current space ───────────────────────────────────────────────────

spacesRouter.get('/v1/spaces/current', async (c) => {
  const userId = c.var.userId;

  const membership = await db
    .select()
    .from(spaceMembers)
    .where(
      and(eq(spaceMembers.userId, userId), eq(spaceMembers.state, 'active'))
    )
    .limit(1);

  if (membership.length === 0) {
    return c.json({ space: null, inviteCode: null });
  }

  const [space] = await db
    .select()
    .from(spaces)
    .where(and(eq(spaces.id, membership[0].spaceId), isNull(spaces.archivedAt)))
    .limit(1);

  if (!space) {
    return c.json({ space: null, inviteCode: null });
  }

  const [invite] = await db
    .select()
    .from(spaceInvites)
    .where(
      and(eq(spaceInvites.spaceId, space.id), isNull(spaceInvites.redeemedAt))
    )
    .limit(1);

  const partner = await db
    .select()
    .from(spaceMembers)
    .where(
      and(
        eq(spaceMembers.spaceId, space.id),
        eq(spaceMembers.state, 'active'),
        eq(spaceMembers.role, 'partner')
      )
    )
    .limit(1);

  return c.json({
    space: {
      ...spaceRowToApi(space),
      partnerName: space.name, // name is set to relationship name, partner name is extracted from members
      inviteCode: invite?.code ?? null,
    },
  });
});

// ── Create space ─────────────────────────────────────────────────────────

const createSpaceSchema = z.object({
  name: z.string().min(1).max(200),
  partnerName: z.string().min(1).max(200),
  relationshipStartDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Must be YYYY-MM-DD format'),
});

spacesRouter.post('/v1/spaces', zValidator('json', createSpaceSchema), async (c) => {
  const userId = c.var.userId;
  const { name, partnerName, relationshipStartDate } = c.req.valid('json');

  // Check user doesn't already have an active space
  const existing = await db
    .select()
    .from(spaceMembers)
    .where(
      and(eq(spaceMembers.userId, userId), eq(spaceMembers.state, 'active'))
    )
    .limit(1);

  if (existing.length > 0) {
    throw conflict('You already have an active space');
  }

  // Create space
  const [space] = await db
    .insert(spaces)
    .values({
      name,
      relationshipStartDate,
      createdByUserId: userId,
    })
    .returning();

  // Add creator as member with role 'you'
  await db.insert(spaceMembers).values({
    spaceId: space.id,
    userId,
    role: 'you',
    state: 'active',
  });

  // Generate invite code
  const code = generateInviteCode();
  const codeNormalized = normalizeInviteCode(code);

  await db.insert(spaceInvites).values({
    spaceId: space.id,
    code,
    codeNormalized,
    createdByUserId: userId,
    expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000), // 30 days
  });

  return c.json({
    space: {
      ...spaceRowToApi(space),
      partnerName,
      inviteCode: code,
    },
    inviteCode: code,
  }, 201);
});

// ── Join space ───────────────────────────────────────────────────────────

const joinSpaceSchema = z.object({
  inviteCode: z.string().min(1),
});

spacesRouter.post('/v1/spaces/join', zValidator('json', joinSpaceSchema), async (c) => {
  const userId = c.var.userId;
  const { inviteCode } = c.req.valid('json');
  const normalized = normalizeInviteCode(inviteCode);

  // Find invite
  const [invite] = await db
    .select()
    .from(spaceInvites)
    .where(eq(spaceInvites.codeNormalized, normalized))
    .limit(1);

  if (!invite) {
    throw notFound('Invalid invite code');
  }

  if (invite.redeemedAt) {
    throw badRequest('Invite code has already been used');
  }

  if (invite.expiresAt && new Date() > invite.expiresAt) {
    throw badRequest('Invite code has expired');
  }

  // Check user doesn't already have an active space
  const existing = await db
    .select()
    .from(spaceMembers)
    .where(
      and(eq(spaceMembers.userId, userId), eq(spaceMembers.state, 'active'))
    )
    .limit(1);

  if (existing.length > 0) {
    throw conflict('You are already in a space. Leave it first to join another.');
  }

  // Check space has partner slot available
  const memberCount = await db
    .select()
    .from(spaceMembers)
    .where(
      and(
        eq(spaceMembers.spaceId, invite.spaceId),
        eq(spaceMembers.state, 'active')
      )
    );

  if (memberCount.length >= 2) {
    throw conflict('This space already has two members');
  }

  // Add as partner
  await db.insert(spaceMembers).values({
    spaceId: invite.spaceId,
    userId,
    role: 'partner',
    state: 'active',
  });

  // Mark invite as redeemed
  await db
    .update(spaceInvites)
    .set({
      redeemedByUserId: userId,
      redeemedAt: new Date(),
    })
    .where(eq(spaceInvites.id, invite.id));

  // Fetch space
  const [space] = await db
    .select()
    .from(spaces)
    .where(eq(spaces.id, invite.spaceId))
    .limit(1);

  if (!space) {
    throw notFound('Space not found');
  }

  return c.json({
    space: spaceRowToApi(space),
  });
});

// ── Update space ─────────────────────────────────────────────────────────

const updateSpaceSchema = z.object({
  name: z.string().min(1).max(200).optional(),
  partnerName: z.string().min(1).max(200).optional(),
  relationshipStartDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Must be YYYY-MM-DD format').optional(),
});

spacesRouter.patch('/v1/spaces/current', zValidator('json', updateSpaceSchema), async (c) => {
  const userId = c.var.userId;

  const membership = await db
    .select()
    .from(spaceMembers)
    .where(
      and(eq(spaceMembers.userId, userId), eq(spaceMembers.state, 'active'))
    )
    .limit(1);

  if (membership.length === 0) {
    throw notFound('No active space');
  }

  const spaceId = membership[0].spaceId;
  const updates = c.req.valid('json');

  // Only space creator can update
  const [space] = await db
    .select()
    .from(spaces)
    .where(eq(spaces.id, spaceId))
    .limit(1);

  if (!space) {
    throw notFound('Space not found');
  }

  if (space.createdByUserId !== userId) {
    throw forbidden('Only the space creator can update space details');
  }

  const updateData: Partial<typeof spaces.$inferInsert> = {};
  if (updates.name) updateData.name = updates.name;
  if (updates.relationshipStartDate) updateData.relationshipStartDate = updates.relationshipStartDate;
  updateData.updatedAt = new Date();

  if (Object.keys(updateData).length > 1) {
    // has more than just updatedAt
    const [updated] = await db
      .update(spaces)
      .set(updateData)
      .where(eq(spaces.id, spaceId))
      .returning();

    return c.json({
      space: spaceRowToApi(updated),
    });
  }

  return c.json({
    space: spaceRowToApi(space),
  });
});

export { spacesRouter };
