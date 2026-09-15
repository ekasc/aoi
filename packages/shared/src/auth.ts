import { z } from 'zod';

import { userSchema } from './user';

export const AUTH_PROVIDERS = ['apple', 'google'] as const;

export const authProviderSchema = z.enum(AUTH_PROVIDERS);

export type AuthProvider = z.infer<typeof authProviderSchema>;

export const OAUTH_PLATFORMS = ['ios', 'android'] as const;

export const oauthPlatformSchema = z.enum(OAUTH_PLATFORMS);

export type OAuthPlatform = z.infer<typeof oauthPlatformSchema>;

export const oauthStartRequestSchema = z.object({
  provider: authProviderSchema,
  platform: oauthPlatformSchema,
  clientId: z.string(),
  redirectUri: z.string(),
  codeChallenge: z.string().optional(),
  codeChallengeMethod: z.literal('S256').optional(),
  nonce: z.string().optional(),
});

export type OAuthStartRequest = z.infer<typeof oauthStartRequestSchema>;

export const oauthStartResponseSchema = z.object({
  authorizationUrl: z.string(),
  state: z.string(),
  codeVerifier: z.string().optional(),
});

export type OAuthStartResponse = z.infer<typeof oauthStartResponseSchema>;

export const oauthCallbackRequestSchema = z.object({
  provider: authProviderSchema,
  platform: oauthPlatformSchema,
  code: z.string(),
  state: z.string(),
  codeVerifier: z.string().optional(),
});

export type OAuthCallbackRequest = z.infer<typeof oauthCallbackRequestSchema>;

export const oauthNativeCallbackRequestSchema = z.object({
  provider: z.literal('apple'),
  platform: z.literal('ios'),
  idToken: z.string(),
  nonce: z.string(),
  displayName: z.string().optional(),
});

export type OAuthNativeCallbackRequest = z.infer<
  typeof oauthNativeCallbackRequestSchema
>;

/**
 * Google native idToken exchange (Better Auth idToken branch). The client
 * obtains a Google idToken (expo-auth-session) and posts it here; the server
 * verifies it against Google's keys before minting a session.
 */
export const oauthGoogleIdTokenRequestSchema = z.object({
  provider: z.literal('google'),
  idToken: z.string(),
  nonce: z.string().optional(),
  displayName: z.string().optional(),
});

export type OAuthGoogleIdTokenRequest = z.infer<
  typeof oauthGoogleIdTokenRequestSchema
>;

export const oauthCallbackResponseSchema = z.object({
  accessToken: z.string(),
  refreshToken: z.string(),
  expiresInSec: z.number(),
  user: userSchema,
});

export type OAuthCallbackResponse = z.infer<typeof oauthCallbackResponseSchema>;

export const sessionResponseSchema = z.object({
  authenticated: z.boolean(),
  user: userSchema,
  expiresAt: z.string(),
});

export type SessionResponse = z.infer<typeof sessionResponseSchema>;

export const refreshRequestSchema = z.object({
  refreshToken: z.string(),
});

export type RefreshRequest = z.infer<typeof refreshRequestSchema>;

export const refreshResponseSchema = z.object({
  accessToken: z.string(),
  refreshToken: z.string(),
  expiresInSec: z.number(),
});

export type RefreshResponse = z.infer<typeof refreshResponseSchema>;

export const logoutRequestSchema = z.object({
  refreshToken: z.string().optional(),
});

export type LogoutRequest = z.infer<typeof logoutRequestSchema>;
