import { Hono } from 'hono';
import { z } from 'zod';
import { zValidator } from '@hono/zod-validator';
import { eq } from 'drizzle-orm';
import { db } from '../db/index.js';
import { userPreferences } from '../db/schema.js';
import { notFound } from '../lib/errors.js';

const preferencesRouter = new Hono();

// ── Get preferences ──────────────────────────────────────────────────────

preferencesRouter.get('/v1/users/me/preferences', async (c) => {
  const userId = c.var.userId;

  const [prefs] = await db
    .select()
    .from(userPreferences)
    .where(eq(userPreferences.userId, userId))
    .limit(1);

  if (!prefs) {
    // Return defaults
    return c.json({ themeId: 'sunset-shore' });
  }

  return c.json({
    themeId: prefs.themeId,
  });
});

// ── Update preferences ───────────────────────────────────────────────────

const updatePrefsSchema = z.object({
  themeId: z.enum(['sunset-shore', 'sea-glass', 'deep-ocean']).optional(),
});

preferencesRouter.patch('/v1/users/me/preferences', zValidator('json', updatePrefsSchema), async (c) => {
  const userId = c.var.userId;
  const input = c.req.valid('json');

  // Upsert
  const [prefs] = await db
    .select()
    .from(userPreferences)
    .where(eq(userPreferences.userId, userId))
    .limit(1);

  if (prefs) {
    const updateData: Partial<typeof userPreferences.$inferInsert> = { updatedAt: new Date() };
    if (input.themeId) updateData.themeId = input.themeId;

    const [updated] = await db
      .update(userPreferences)
      .set(updateData)
      .where(eq(userPreferences.userId, userId))
      .returning();

    return c.json({ themeId: updated.themeId });
  } else {
    const [created] = await db
      .insert(userPreferences)
      .values({
        userId,
        themeId: input.themeId ?? 'sunset-shore',
      })
      .returning();

    return c.json({ themeId: created.themeId });
  }
});

export { preferencesRouter };
