---
seed_version: seeds-v1
status: verified
aoi_commit: 048f78383a2ff423a8b3c1f0532c4514b387708f
sources:
  - path: packages/shared/src/plus.ts
    sha256: d231a72fc5eea72285cd2ebfdb6c4f7dfcdf860b8b30d3b1f444c59b8c60faa4
  - path: packages/api/src/domains/plus.ts
    sha256: bfd5f017558e3247a7d7c028065a1440aeef4690636050f4f27feafb1435190b
  - path: packages/api/src/routes/session-plus.ts
    sha256: 2c8b5456f63494375e2cdbfa58d97eae2db02cb5179c3fd5b50e621ce21a8544
  - path: features/subscription/subscription-context.tsx
    sha256: 749769dce5ceb93b5055214374dfef1bef5d360ead91fdc46122485e79216058
  - path: app/(app)/paywall.tsx
    sha256: 37ae0f6c044d69df8b1c2a06e1475a63f2221d597cd15466c4c40e281461e66e
  - path: docs/product/relationship-home-and-archive.md
    sha256: b7880500c07bd9ca767571ed9614e1112c59c3a462be1d6a3af64a2eea9e99ac
---

# Plus entitlement, shared benefits, purchase failure, and storage limits

> **Simulation input only.** Every person, quote, and situation in this
> document is fictional. Nothing here is a customer record, a production
> memory, an access token, a recovery phrase, or a real location. MiroFish may
> discuss these workflows, but a simulated statement is a user belief, never
> proof that Aoi behaves that way.

**Purpose.** What the Space-level entitlement actually grants and what both members observe.

## Verified in current source

- Plus is Space-level, not per person. One entitlement covers both active members, and both read the same authoritative row (`packages/shared/src/plus.ts`, `packages/api/src/domains/plus.ts`).
- Free includes shared notes, the sky, the day count, the relationship home, everyday resurfacing, chronological reading, gallery, existing chapters, plans, responses, and Little things. Privacy and export are not paywalled (`docs/product/relationship-home-and-archive.md`).
- The implemented Plus benefits are a media ceiling from 250 MiB to 5 GiB per Space, removal of the one-active-future-letter limit, and PDF chapter keepsakes (`mediaLimitForSpace`, `futureLetterLimitForSpace`).
- The backend entitlement row is authoritative. Client RevenueCat state is for purchase/restore UX only and cannot grant features by itself (`packages/shared/src/plus.ts`).
- Verified webhook events are deduplicated, stale events cannot regress a newer state, expiry is read-time, and a transfer moves the entitlement without leaving two Spaces Plus (`packages/api/src/domains/plus.ts`).
- A grant with no active Space is ignored; an ambiguous or unknown provider identity is ignored; a non-member can never read another Space's Plus row (`getSpacePlusProgram`).

## Documented intent (not proof of current behavior)

- Both members see the same limits and the same entitlement state.
- A failed or cancelled purchase changes nothing; the paywall explains renewal and store management.
- Storage limits are shown truthfully and are never described as unlimited.

## Unresolved or contradicted

- No source establishes how quickly a partner's screen reflects a newly purchased entitlement without reopening the app.
- The exact UX when a purchase succeeds at the store but the webhook is delayed is not covered by a two-phone test.

## Fictional situation material for MiroFish

- One member buys Plus and immediately expects the partner's storage ceiling to change.
- A purchase sheet is cancelled; the person expects no charge and no change.
- Storage is nearly full and one member deletes a memory; the other expects the freed space immediately.

## Source files

- `packages/shared/src/plus.ts`
- `packages/api/src/domains/plus.ts`
- `packages/api/src/routes/session-plus.ts`
- `features/subscription/subscription-context.tsx`
- `app/(app)/paywall.tsx`
- `docs/product/relationship-home-and-archive.md`

A simulated statement about any item above is a hypothesis. Only an executed Aoi test with recorded evidence may be reported as reproduced behavior.
