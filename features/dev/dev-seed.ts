/**
 * Dev-only seeded session.
 *
 * The supported way to run the REAL app tree (tabs, navigation, every
 * screen) against the mock world: set `EXPO_PUBLIC_DEV_SEED=full` (or
 * `empty` / `pending` / `failed`), start the dev server, and the app boots
 * signed in as Maya with June's space and the rich media seeds. No separate
 * preview route, no navigation bypassed — the tab bar, back buttons, and
 * every screen behave exactly as in production.
 *
 * `EXPO_PUBLIC_DEV_SEED=setup` is the pre-space world: a real session and NO
 * space, so the app boots on the Space setup wizard and stays there. It clears
 * any space a previous seed left behind, which would otherwise redirect
 * straight past setup into the app.
 *
 * How it works: before the session/space providers hydrate, this writes a
 * real session into SecureStore and a real space into AsyncStorage — the
 * same records a genuine sign-in would produce. The providers then restore
 * them through their normal paths, so nothing downstream knows it is seeded.
 * The moments stub layer additionally swaps its fixtures via the preview
 * variant store (`useDevSeed` in the app layout).
 *
 * Safety: `__DEV__`-gated and flag-gated. With the flag unset this module
 * does nothing, so normal dev and production are untouched.
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import * as SecureStore from 'expo-secure-store';

import {
  getDevSeedVariant,
  resetPreviewComposerStore,
  type PreviewVariant,
} from '@/features/dev/preview';
import { seedDevCollections } from '@/features/dev/dev-seed-collections';
import { seedDevSkyPhotos } from '@/features/dev/dev-seed-sky';
import type { RelationshipSpace } from '@/features/space/types';

const SESSION_STORAGE_KEY = 'aoi.session.v1';
const SPACE_USER_KEY_PREFIX = 'aoi.space.by-user.v1.';

export const DEV_SEED_USER_ID = 'preview-maya';
export const DEV_SEED_SPACE_ID = 'preview-space';

const DEV_SEED_SESSION = {
  user: {
    id: DEV_SEED_USER_ID,
    email: 'maya@example.com',
    displayName: 'Maya',
  },
  tokens: {
    accessToken: 'preview-token',
    refreshToken: 'preview-refresh',
    expiresAt: '2030-01-01T00:00:00.000Z',
  },
};

const DEV_SEED_SPACE: RelationshipSpace = {
  id: DEV_SEED_SPACE_ID,
  name: 'Maya & June',
  createdByUserId: DEV_SEED_USER_ID,
  yourName: 'Maya',
  partnerName: 'June',
  relationshipStartDate: '2022-06-14',
  inviteCode: 'PREVIEW1',
  partnerJoined: true,
  inviteExpiresAt: null,
  createdAt: '2022-06-14T00:00:00.000Z',
  updatedAt: '2026-09-01T00:00:00.000Z',
};

let seedPromise: Promise<void> | null = null;

/**
 * Writes the seeded session + space once per app launch. Idempotent and
 * safe to await from multiple callers. Resolves immediately when the flag
 * is unset.
 */
export function ensureDevSeed(): Promise<void> {
  const variant = getDevSeedVariant();
  if (!__DEV__ || !variant) {
    return Promise.resolve();
  }
  if (!seedPromise) {
    seedPromise = (async () => {
      try {
        await SecureStore.setItemAsync(
          SESSION_STORAGE_KEY,
          JSON.stringify(DEV_SEED_SESSION)
        );
      } catch {
        // Web has no secure store. The session cannot be written there, but the
        // rest of the seed still has to run: the space and the lists live in
        // AsyncStorage, which web does have. Aborting here left the dev preview
        // routes empty on web for no reason.
      }
      const spaceKey = `${SPACE_USER_KEY_PREFIX}${DEV_SEED_USER_ID}`;
      if (variant === 'setup') {
        // The pre-space world. A space left by an earlier `full` seed would
        // make the app restore straight into the tabs and skip setup, so this
        // variant has to clear it, not merely decline to write one.
        await AsyncStorage.removeItem(spaceKey);
      } else {
        await AsyncStorage.setItem(spaceKey, JSON.stringify(DEV_SEED_SPACE));
      }
      // The couple's lists live in the stub collections repository, which the
      // Ours screen reads on mount. Seed them here so the catalogue is present
      // deterministically rather than racing the provider.
      if (variant !== 'empty' && variant !== 'setup') {
        await seedDevCollections(DEV_SEED_SPACE_ID);
        // The Us sky reads the encrypted album, so the mock photos must go
        // through the real session/seal/upload path to appear there.
        await seedDevSkyPhotos(DEV_SEED_SPACE_ID, DEV_SEED_USER_ID);
      }
      // Pending rows (unsent/failed memories) live in the composer store,
      // which the composer provider hydrates on mount — seed it here so the
      // variant's rows are present deterministically, no race.
      await resetPreviewComposerStore(variant);
    })().catch(() => {
      // Best-effort: a failed seed just means the app boots signed out.
      seedPromise = null;
    });
  }
  return seedPromise;
}

/** True when the dev seed flag is set (dev builds only). */
export function isDevSeeded(): boolean {
  return __DEV__ && getDevSeedVariant() !== null;
}

export type { PreviewVariant };
