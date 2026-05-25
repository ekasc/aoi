# Aoi Mobile App

Aoi is a private relationship app for two people. This repo is the Expo + TypeScript client.

## Current Product Scope (Mar 2026)

- OAuth provider sign in (Google + Apple)
- Session restore/logout using secure token storage
- Relationship space onboarding (create or join)
- Optional milestone import
- Theme selection
- Main app tabs (timeline, calendar, profile, settings)

## Backend Integration

- Backend runtime: TypeScript + Bun (repo: `../go/aoi-go`)
- DB: Postgres (Neon)
- Object storage: Cloudflare R2

## Auth API Contract

The app expects these routes:

- `POST /v1/auth/oauth/start`
- `POST /v1/auth/oauth/callback`
- `POST /v1/auth/oauth/native/callback`
- `GET /v1/auth/session`
- `POST /v1/auth/logout`

Flow mapping:

- Google (iOS + Android): Authorization Code + PKCE (`S256`)
- Apple iOS: native Sign in with Apple, then `oauth/native/callback`
- Apple Android: browser `start` + `callback` with `state` + `nonce`

## Environment Variables

Default behavior is stub auth (`EXPO_PUBLIC_AUTH_STUB_MODE=true` when unset).

When using real backend auth (`EXPO_PUBLIC_AUTH_STUB_MODE=false`), set:

- `EXPO_PUBLIC_AUTH_API_BASE_URL`
- `EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID`
- `EXPO_PUBLIC_GOOGLE_ANDROID_CLIENT_ID`
- `EXPO_PUBLIC_APPLE_ANDROID_CLIENT_ID`

## Local Commands

```bash
bun install
bun run lint
bun run typecheck
bun run test:unit
```

## Mobile E2E (App-Level)

Maestro smoke test (stub mode) is in `e2e/maestro/auth-stub-smoke.yaml`.

1. Install Maestro CLI (one-time): `brew install mobile-dev-inc/tap/maestro`
2. Start iOS app in stub mode:
   `EXPO_PUBLIC_AUTH_STUB_MODE=true bun run ios`
3. Run E2E:
   `bun run test:e2e:mobile:stub`

Expected result: tap `Continue with Google` and land on `Set up your shared space`.
