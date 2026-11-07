import type { PushTokenPlatform } from '@aoi/shared';

import { apiFetch, getApiSessionGeneration } from '@/features/api-client';

// Tracks the token registered during this session so sign-out can unregister
// it. Never persisted — the server is the source of truth.
let lastRegistration: { token: string; owner: number } | null = null;
let operations = Promise.resolve();

function assertSession(owner: number) {
  if (owner !== getApiSessionGeneration()) {
    throw Object.assign(new Error('The account changed before push registration completed.'), { code: 'SESSION_CHANGED' });
  }
}

function inSession(operation: (owner: number) => Promise<void>): Promise<void> {
  const owner = getApiSessionGeneration();
  const pending = operations.then(() => {
    assertSession(owner);
    return operation(owner);
  });
  // A late DELETE must finish before a newer POST can reach the server.
  operations = pending.catch(() => {});
  return pending;
}

export function getLastRegisteredPushToken(): string | null {
  return lastRegistration?.owner === getApiSessionGeneration() ? lastRegistration.token : null;
}

export async function registerPushToken(
  expoPushToken: string,
  platform: PushTokenPlatform
): Promise<void> {
  await inSession(async (owner) => {
    await apiFetch('/v1/push/tokens', {
      method: 'POST',
      body: JSON.stringify({ expoPushToken, platform }),
    });
    assertSession(owner);
    lastRegistration = { token: expoPushToken, owner };
  });
}

/**
 * Remove this device's token (e.g. on sign-out). Quietly no-ops when nothing
 * was registered this session or the request fails — tender-error policy.
 * The attempted token lets logout retry cleanup atomically.
 */
export async function unregisterPushToken(): Promise<string | undefined> {
  let attemptedToken: string | undefined;
  try {
    await inSession(async (owner) => {
      const registration = lastRegistration;
      if (!registration || registration.owner !== owner) return;
      attemptedToken = registration.token;
      try {
        await apiFetch('/v1/push/tokens', {
          method: 'DELETE',
          body: JSON.stringify({ expoPushToken: registration.token }),
        });
      } finally {
        if (lastRegistration === registration) lastRegistration = null;
      }
    });
  } catch {
    // Logout retries cleanup atomically when it can reach the server.
  }
  return attemptedToken;
}
