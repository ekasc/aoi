import { createRemoteJWKSet, jwtVerify } from 'jose';
import type { JWTPayload } from 'jose';

import { internal, badRequest } from './errors.js';

// ── Google's JWKS endpoint ────────────────────────────────────────────────
// createRemoteJWKSet auto-fetches and caches keys from Google's certs endpoint.
// The `cooldownDuration` controls how often it re-fetches (default 30s).
const GOOGLE_JWKS = createRemoteJWKSet(
  new URL('https://www.googleapis.com/oauth2/v3/certs'),
  { cooldownDuration: 300_000 }, // 5 min cache
);

// ── Token exchange response ───────────────────────────────────────────────

export interface GoogleTokenResponse {
  access_token: string;
  expires_in: number;
  id_token: string;
  refresh_token?: string;
  scope: string;
  token_type: string;
}

export interface GoogleIdTokenClaims extends JWTPayload {
  sub: string;        // Google user ID (unique per Google account, per client)
  email?: string;
  email_verified?: boolean;
  name?: string;
  picture?: string;
  given_name?: string;
  family_name?: string;
  aud: string;        // audience = client ID
  azp?: string;       // authorized presenter
}

// ── Exchange authorization code for tokens ────────────────────────────────

export async function exchangeGoogleCode(
  code: string,
  redirectUri: string,
  codeVerifier: string | undefined,
  clientId: string,
  clientSecret: string,
): Promise<GoogleTokenResponse> {
  const body = new URLSearchParams({
    code,
    client_id: clientId,
    client_secret: clientSecret,
    redirect_uri: redirectUri,
    grant_type: 'authorization_code',
  });

  if (codeVerifier) {
    body.set('code_verifier', codeVerifier);
  }

  let response: Response;
  try {
    response = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: body.toString(),
    });
  } catch {
    throw internal('Failed to reach Google token endpoint');
  }

  if (!response.ok) {
    const errorBody = await response.json().catch(() => null);
    const errorDesc = errorBody?.error_description ?? errorBody?.error ?? `HTTP ${response.status}`;
    throw badRequest(`Google token exchange failed: ${errorDesc}`);
  }

  const data: GoogleTokenResponse = await response.json();

  if (!data.id_token) {
    throw internal('Google did not return an id_token');
  }

  return data;
}

// ── Verify Google id_token and extract claims ─────────────────────────────

export async function verifyGoogleIdToken(
  idToken: string,
  expectedClientId: string,
): Promise<GoogleIdTokenClaims> {
  try {
    const { payload } = await jwtVerify(idToken, GOOGLE_JWKS, {
      algorithms: ['RS256'],
      audience: expectedClientId,
      issuer: ['https://accounts.google.com', 'accounts.google.com'],
    });

    return payload as GoogleIdTokenClaims;
  } catch (err) {
    const message = err instanceof Error ? err.message : 'unknown error';
    throw badRequest(`Google id_token verification failed: ${message}`);
  }
}

// ── Combined: exchange + verify ───────────────────────────────────────────

export async function authenticateWithGoogle(
  code: string,
  redirectUri: string,
  codeVerifier: string | undefined,
  clientId: string,
  clientSecret: string,
): Promise<{
  providerSubject: string;
  email: string;
  displayName: string;
  avatarUrl?: string;
}> {
  const tokenResponse = await exchangeGoogleCode(
    code,
    redirectUri,
    codeVerifier,
    clientId,
    clientSecret,
  );

  const claims = await verifyGoogleIdToken(tokenResponse.id_token, clientId);

  return {
    providerSubject: claims.sub,
    email: claims.email ?? '',
    displayName: claims.name ?? claims.email?.split('@')[0] ?? 'Google User',
    avatarUrl: claims.picture,
  };
}
