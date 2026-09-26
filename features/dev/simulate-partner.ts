import AsyncStorage from '@react-native-async-storage/async-storage';
import { momentSchema } from '@aoi/shared';

import type { CreateMomentInput, Moment } from '@/features/moments/types';

/**
 * One-phone two-user testing: there is no second device to receive a
 * partner post from, so dev builds can plant one. Stub-only in practice
 * (local moments), `__DEV__`-gated at the call site, never linked from UI.
 *
 * Planted posts persist in AsyncStorage so the unread flow survives the
 * reload it needs: plant, reload, and the fresh screen lands on the post
 * because the cursor predates it. Clear them when done playing June.
 */

export const SIMULATE_PARTNER_POST_KEY = '__aoiSimulatePartnerPost';
export const CLEAR_SIMULATED_POSTS_KEY = '__aoiClearSimulatedPosts';

const SIMULATED_POSTS_KEY = 'aoi.dev.simulated-posts.v1';

export type SimulatePartnerPostOverrides = {
  title?: string;
  body?: string;
  occurredAt?: string;
};

export function buildSimulatedPartnerPost(
  partnerName: string | null | undefined,
  overrides: SimulatePartnerPostOverrides = {},
  now: Date = new Date(),
): CreateMomentInput {
  return {
    type: 'note',
    title: 'Thinking of you',
    body: 'Pretend this arrived while you were away.',
    occurredAt: now.toISOString(),
    ...overrides,
    // Locked after the spread: no override turns the post into yours.
    authorId: 'user_partner',
    authorRole: 'partner',
    authorName: partnerName ?? 'Partner',
  };
}

function isStoredMoment(value: unknown): value is Moment {
  return momentSchema.safeParse(value).success;
}

export async function loadSimulatedPosts(): Promise<Moment[]> {
  try {
    const raw = await AsyncStorage.getItem(SIMULATED_POSTS_KEY);
    if (!raw) {
      return [];
    }
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) {
      return [];
    }
    return parsed.filter(isStoredMoment);
  } catch {
    return [];
  }
}

export async function saveSimulatedPosts(posts: Moment[]): Promise<void> {
  try {
    await AsyncStorage.setItem(SIMULATED_POSTS_KEY, JSON.stringify(posts));
  } catch {
    // Dev fixtures must never break the app.
  }
}
