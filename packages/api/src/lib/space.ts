import { and, eq } from 'drizzle-orm';
import { db } from '../db/index.js';
import { spaceMembers } from '../db/schema.js';

/**
 * Resolve the user's active space id. A user belongs to exactly one active
 * space at a time; returns null when they have none. Shared by every route
 * that hangs work off "the current space".
 */
export async function getActiveSpaceId(userId: string): Promise<string | null> {
  const membership = await db
    .select()
    .from(spaceMembers)
    .where(
      and(eq(spaceMembers.userId, userId), eq(spaceMembers.state, 'active'))
    )
    .limit(1);

  return membership.length > 0 ? membership[0].spaceId : null;
}
