# Brief: overhaul of the Us screen

## Scope
Full overhaul of `app/(app)/(tabs)/together.tsx` only (the Us / Together tab: sky title card, waiting card, squeeze, Letters + Reflection rows).
Explicitly out of scope: the Letters, Reflection/question, moment-detail, and Memories routes it links to; `MemorySky` internals except for props/layout usage; backend, data layer, and navigation structure.

## Goals
1. More emotional / intimate feel — the screen should feel like "us", not a dashboard.
2. (Implied, to confirm in review) Clearer waiting-state hierarchy and calmer layout in service of #1.

## Audience
Both new couples (empty state: just names + start date, no archive yet) and long-term couples (rich archive of moments/letters). Primary context: daily check-in on phone, iOS and Android.

## Required content
- Keep the sky (`MemorySky` + pair names + days-together title card) as the emotional anchor.
- Rethink everything else below the sky: waiting/focal card, squeeze gesture, Letters + Reflection entries, spacing and hierarchy. Copy TBD in review; no new mandatory assets.

## Constraints
- Expo React Native + Expo Router; reuse existing tokens in `constants/theme.ts` (no new palette without approval).
- Keep the a11y contract (`pnpm run a11y:audit` must pass): labelled press targets, 44px targets, decorative images marked, live regions for async status.
- Respect reduced motion (`useReducedMotion`), no new native deps without approval, no `allowFontScaling={false}`.

## Viewports
- iphone (iOS) + pixel (Android) for device coverage, plus chrome-laptop as desktop minimum for review bundle.
