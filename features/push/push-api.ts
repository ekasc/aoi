import type { PushTokenPlatform } from '@aoi/shared';

import { apiFetch } from '@/features/api-client';

// Tracks the token registered during this session so sign-out can unregister
// it. Never persisted — the server is the source of truth.
let lastRegisteredToken: string | null = null;

export function getLastRegisteredPushToken(): string | null {
  return lastRegisteredToken;
}

export async function registerPushToken(
  expoPushToken: string,
  platform: PushTokenPlatform
): Promise<void> {
  await apiFetch('/v1/push/tokens', {
    method: 'POST',
    body: JSON.stringify({ expoPushToken, platform }),
  });
  lastRegisteredToken = expoPushToken;
}

/**
 * Remove this device's token (e.g. on sign-out). Quietly no-ops when nothing
 * was registered this session or the request fails — tender-error policy.
 */
export async function unregisterPushToken(): Promise<void> {
  const expoPushToken = lastRegisteredToken;

  if (!expoPushToken) {
    return;
  }

  try {
    await apiFetch('/v1/push/tokens', {
      method: 'DELETE',
      body: JSON.stringify({ expoPushToken }),
    });
  } catch {
    // Deliberately silent — a leftover token only means an undelivered
    // quiet notification, never an error worth surfacing.
  } finally {
    lastRegisteredToken = null;
  }
}
