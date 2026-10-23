import * as SecureStore from 'expo-secure-store';

import { getAuthApi } from '@/features/auth/auth-api';
import { getAuthApiBaseUrl } from '@/features/auth/auth-config';
import { setApiTokens } from '@/features/api-client';

/**
 * E2E-only sign-in. Used by the E2E console route (app/dev-e2e.tsx) and
 * nowhere else — production UI never imports this module.
 *
 * What it does: exchanges the per-run E2E secret for a REAL session row on
 * the ISOLATED test backend (POST /v1/auth/e2e/session, which 404s unless
 * that backend runs with AOI_E2E_MODE=true), fetches the user through the
 * real session endpoint, and persists it through the same SecureStore entry
 * the SessionProvider restores from. Identity bootstrap only: the album
 * protocol, enrollment, media sealing, and recovery all run their real
 * code past this point. No mocked transport, no mocked SecureStore.
 */

export function isE2EMode(): boolean {
  return __DEV__ === true && process.env.EXPO_PUBLIC_E2E_MODE === 'true';
}

function e2eSecret(): string {
  const secret = process.env.EXPO_PUBLIC_E2E_SECRET;
  if (!secret) {
    throw new Error('EXPO_PUBLIC_E2E_SECRET is required in E2E mode.');
  }
  return secret;
}

export type E2ESignInResult = { ok: true } | { ok: false; error: string };

export async function signInE2E(email: string): Promise<E2ESignInResult> {
  if (!isE2EMode()) {
    return { ok: false, error: 'E2E sign-in is only available in E2E builds.' };
  }
  try {
    const baseUrl = getAuthApiBaseUrl();
    const minted = await fetch(`${baseUrl}/v1/auth/e2e/session`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, secret: e2eSecret() }),
    });
    if (!minted.ok) {
      return { ok: false, error: `Test backend refused sign-in: ${minted.status}.` };
    }
    const { token } = (await minted.json()) as { token: string; userId: string };

    const user = await getAuthApi().getSession(token);
    const tokens = { accessToken: token };
    // The same entry SessionProvider restores (see SESSION_STORAGE_KEY in
    // features/session/session-context.tsx). Written here so restoreSession()
    // hydrates the live provider without a reload.
    await SecureStore.setItemAsync('aoi.session.v1', JSON.stringify({ user, tokens }));
    setApiTokens(tokens);
    return { ok: true };
  } catch {
    return { ok: false, error: 'Could not reach the test backend.' };
  }
}
