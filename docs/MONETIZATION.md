# Monetization + Ship Runbook — Aoi Plus via RevenueCat

Status: code is in the repo and verified (`typecheck` clean, 403 unit tests pass).
What remains is dashboard setup + store builds. Estimate: ~2–3 hours of clicking + build waits.

## 1. How it works in code

- `features/subscription/` — `SubscriptionProvider` (RevenueCat SDK), `limits.ts` (free limits), `config.ts` (keys).
- `app/(app)/paywall.tsx` — paywall sheet (pulls live prices from RevenueCat, falls back to $4.99/mo · $39.99/yr).
- Settings → "Aoi Plus" card → paywall. Letters enforce the only hard gate: free = 1 active sealed letter, then soft-redirect to paywall.
- No keys set → dev mode: purchases simulate Plus locally via AsyncStorage. Ship-safe fallback, never crashes Expo Go (web/native-module guards built in).

## 2. RevenueCat setup (~20 min)

1. Create project at app.revenuecat.com → Apps → Add iOS app (bundle `com.ekasc.aoi`) + Android app (package `com.ekasc.aoi`).
2. Entitlements → create `plus` (exact id — code default `PLUS_ENTITLEMENT_ID`; override via `EXPO_PUBLIC_REVENUECAT_ENTITLEMENT_ID`).
3. Products → create:
   - `aoi_plus_monthly` — $4.99/mo, 1-week free trial recommended
   - `aoi_plus_yearly` — $39.99/yr, 1-week free trial recommended
   Wire each to App Store Connect / Play products of the same id (create those first — see §3).
4. Offerings → `default` offering containing both packages (monthly default, yearly alternate).
5. Copy API keys: iOS public SDK key → `EXPO_PUBLIC_REVENUECAT_IOS_KEY`, Android → `EXPO_PUBLIC_REVENUECAT_ANDROID_KEY`.

## 3. Store products

**Apple (App Store Connect → aoi → Subscriptions):**
- Subscription group "Aoi Plus" → monthly + yearly, ids `aoi_plus_monthly` / `aoi_plus_yearly`.
- Fill review notes: test account, where Plus is found (Settings → Aoi Plus), what free users keep.
- Apple requires a restore mechanism — paywall has "Restore purchase". Also add Privacy Policy + Terms URLs (App Store Connect fields + in-app link before submit).

**Google (Play Console → aoi → Subscriptions):**
- Same two base plans, same ids. Activate in an open/closed track before production.

## 4. Env (EAS Secrets — never commit keys)

```bash
eas secret:create --scope project --name EXPO_PUBLIC_REVENUECAT_IOS_KEY --value 'appl_…'
eas secret:create --scope project --name EXPO_PUBLIC_REVENUECAT_ANDROID_KEY --value 'goog_…'
# optional: eas secret:create --scope project --name EXPO_PUBLIC_REVENUECAT_ENTITLEMENT_ID --value plus
```

Local dev needs nothing — no keys = simulated Plus.

## 5. Build + submit

```bash
# sanity first
pnpm run lint && pnpm run typecheck && pnpm run test:unit

# cloud builds (no simulator needed)
eas build --platform ios --profile production
eas build --platform android --profile production

# submit (first time: run `eas submit` interactively to attach ASC / Play service credentials)
eas submit --platform ios --profile production
eas submit --platform android --profile production

# after approval — OTA for JS-only fixes (never for native changes)
eas update --channel production --message "copy tweaks"
```

Notes:
- `eas.json` production profile already exists; `autoIncrement` is on.
- First iOS submit needs an Apple Developer enrollment ($99/yr) + ASC API key; first Android submit needs a Play Console account ($25 once) + service-account JSON.
- Review risk is low: core app fully usable free, Plus only lifts limits; restore + cancel paths exist.

## 6. After revenue starts (do NOT block launch on these)

- RevenueCat → webhook to backend (`packages/api`) to persist `isPlus` server-side and share one subscription across both partners.
- Add "Why Plus?" education + trial analytics (paywall views → purchases).
- Consider partner-shared Plus: purchaser's `spaceId` grants Plus to the partner via webhook.
