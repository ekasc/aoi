# P9B store/dashboard checklist — external setup code cannot perform

Each item names the exact config key from the codebase. Nothing here is
done by merging code; every line needs a human with dashboard/store access.

## OAuth
- [ ] Google Cloud: web OAuth client → `GOOGLE_CLIENT_ID` (worker secret) must equal app `EXPO_PUBLIC_GOOGLE_CLIENT_ID`.
- [ ] Google Cloud: iOS OAuth client → app `EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID`.
- [ ] Apple Developer: Services ID → `APPLE_CLIENT_ID`; ES256 client secret → `APPLE_CLIENT_SECRET`; native bundle `com.ekasc.aoi` → `APPLE_APP_BUNDLE_ID`.
- [ ] Better Auth: `BETTER_AUTH_SECRET` (≥16 chars, random) + `APP_BASE_URL` (production worker URL) + `BETTER_AUTH_URL` (canonical public origin).

## Push
- [ ] Apple: APNs Auth Key (.p8) uploaded to Expo (EAS credentials) for bundle `com.ekasc.aoi`.
- [ ] Google: `google-services.json` for package `com.ekasc.aoi` (FCM).
- [ ] Verify: backgrounded device receives a squeeze push on tapping (see `e2e/MANUAL.md`).

## RevenueCat
- [ ] Products + offering created; entitlement id matches `EXPO_PUBLIC_REVENUECAT_ENTITLEMENT_ID` (default `plus`) AND worker `REVENUECAT_PLUS_ENTITLEMENT_ID`.
- [ ] iOS public SDK key → app `EXPO_PUBLIC_REVENUECAT_IOS_KEY`.
- [ ] Android public SDK key → app `EXPO_PUBLIC_REVENUECAT_ANDROID_KEY`.
- [ ] Webhook → `POST {worker}/v1/billing/revenuecat/webhook` with the static Authorization value stored as worker `REVENUECAT_WEBHOOK_SECRET`.
- [ ] Sandbox purchase on a test Space flips both members to Plus after refresh.

## Worker
- [ ] `CORS_ORIGIN` = production app origin (NOT `https://aoi.example`).
- [ ] `APP_BASE_URL` = production worker URL (https).
- [ ] Optional direct-PUT path only if needed: `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET`.
- [ ] Run `features/legal/release-config.ts` worker validation against the production env map before first deploy (all items must clear).

## Legal
- [ ] Real privacy policy URL → app `EXPO_PUBLIC_PRIVACY_URL`.
- [ ] Real terms URL → app `EXPO_PUBLIC_TERMS_URL`.
- [ ] Support destination → app `EXPO_PUBLIC_SUPPORT_URL` (https or mailto).
- [ ] Until set, Space renders no legal rows (by design — never placeholder links).

## Store listing
- [ ] App icon + splash: current assets are Expo-template era (see asset manifest A6) — replace or formally accept.
- [ ] Landing video was removed for unknown provenance; confirm the paper landing is the intended public face.
- [ ] Privacy policy URL + support contact entered in App Store Connect (Apple requirement).
- [ ] Data-collection answers match the manifest: photos/voice/location-free; contacts/calendar never leave device except via API.

## Data
- [ ] Production D1 backup taken.
- [ ] `drizzle-d1` 0000→0005 applied in journal order to production (validated locally by `d1-constraints` chain test; no down-migrations exist — backup is the rollback).
- [ ] First production webhook delivery observed 200 in worker logs.
