import { createMiddleware } from 'hono/factory';
import { db } from '../db/index.js';
import { spaceMembers } from '../db/schema.js';
import { eq, and } from 'drizzle-orm';
import { forbidden, notFound } from '../lib/errors.js';

declare module 'hono' {
  interface ContextVariableMap {
    spaceId: string;
    memberRole: 'you' | 'partner';
  }
}

/** Require the user to be an active member of the given space. */
export const spaceMemberMiddleware = createMiddleware(async (c, next) => {
  const userId = c.var.userId;
  const spaceId = c.req.param('spaceId') || c.req.query('spaceId');

  if (!spaceId) {
    throw notFound('Space ID required');
  }

  const membership = await db
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

  if (membership.length === 0) {
    throw forbidden('You are not a member of this space');
  }

  c.set('spaceId', spaceId);
  c.set('memberRole', membership[0].role as 'you' | 'partner');
  await next();
});
