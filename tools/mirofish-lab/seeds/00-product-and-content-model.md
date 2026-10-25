---
seed_version: seeds-v1
status: verified
aoi_commit: 048f78383a2ff423a8b3c1f0532c4514b387708f
sources:
  - path: PRODUCT.md
    sha256: ed50534f24aafe50353f2115ab377e7d4acb112d437668929bdc62ee54820a3a
  - path: docs/product/first-use-acceptance.md
    sha256: 61dca1d66da19e2376242baf2b3421dd2f9e29814f47a233fd86b46ea9bf8a9f
  - path: docs/product/relationship-home-and-archive.md
    sha256: b7880500c07bd9ca767571ed9614e1112c59c3a462be1d6a3af64a2eea9e99ac
  - path: app/(app)/(tabs)/_layout.tsx
    sha256: 6fee7a053f4c6eae475f939fb3f2000df08770b83a39131937fce9a4eff1935b
  - path: packages/shared/src/space.ts
    sha256: 3b366a5c64ce90806c23ade9f82e74615293d0e3e1531e798ef5117b7ec8cda1
---

# Aoi: product and content model

> **Simulation input only.** Every person, quote, and situation in this
> document is fictional. Nothing here is a customer record, a production
> memory, an access token, a recovery phrase, or a real location. MiroFish may
> discuss these workflows, but a simulated statement is a user belief, never
> proof that Aoi behaves that way.

**Purpose.** What Aoi is, the four destinations, and the two-person space constraint.

## Verified in current source

- Aoi is a private space for exactly two people to save memories and make plans together (`docs/product/first-use-acceptance.md`).
- The authenticated tab layout exposes Memories, Us, Plans, and Space (`app/(app)/(tabs)/_layout.tsx`). The task brief calls the fourth destination Lists; the checked-in tab is Space, and Plans/Lists content lives behind it.
- A relationship space has one creator and at most one active partner. Storage enforces one active membership per user and one active partner per space (`packages/api/src/domains/spaces.ts`, partial unique indexes).
- A space is not a group. Invitations admit one partner, and the partner slot never becomes reusable after someone has joined (`joinSpaceProgram`, `packages/api/src/domains/spaces.ts`).
- Memory authorship is viewer-relative: the API returns `authorRole: "you"` for the caller and `"partner"` for the other member (`momentToApi`, `packages/api/src/domains/moments.ts`).

## Documented intent (not proof of current behavior)

- The first useful action is saving one memory, possibly before the partner joins (`docs/product/first-use-acceptance.md`).
- Us and Memories are separate destinations with different content: sky photos versus dated memories (`docs/product/relationship-home-and-archive.md`).
- Plans and collections are shared planning surfaces; goals do not automatically become memories (`docs/product/relationship-home-and-archive.md`).

## Unresolved or contradicted

- The product brief refers to a Lists tab while the checked-in navigation calls the fourth destination Space. This lab models what the source actually exposes and does not assume a Lists route exists.
- No source establishes that adding a photo in one destination publishes it to the other.

## Fictional situation material for MiroFish

- Fictional couples must be modelled as two accounts in one space, never as a larger group.
- A conversation may reveal that someone expects one shared login. That expectation is a hypothesis about confusion, not a product fact.

## Source files

- `PRODUCT.md`
- `docs/product/first-use-acceptance.md`
- `docs/product/relationship-home-and-archive.md`
- `app/(app)/(tabs)/_layout.tsx`
- `packages/shared/src/space.ts`

A simulated statement about any item above is a hypothesis. Only an executed Aoi test with recorded evidence may be reported as reproduced behavior.
