---
seed_version: seeds-v1
status: verified
aoi_commit: 048f78383a2ff423a8b3c1f0532c4514b387708f
sources:
  - path: app/(auth)/sign-in.tsx
    sha256: 5d177896661c4af279edeefae9d053508e1fa37286df67b36d4d1d88252ec08b
  - path: app/(auth)/space-setup.tsx
    sha256: 617e02c9016b3dcc1b5699d97ae23a96af0603251bc047d406561ef91bcbe96f
  - path: components/setup/use-onboarding-flow.ts
    sha256: b491734d1cf9cc4a0c6e491f3c01b07045a06733c99bbd3e73a904c190c4e9ab
  - path: components/setup/onboarding-wizard.tsx
    sha256: 4316d38a873ec444433832827ff89074c53f68c0a216f95fab3bc6693753c49c
  - path: components/space/partner-invitation.tsx
    sha256: fb1fb076f29dbd110a3c1e01bcb443e77cd473d12cdc15e69045512e952fc13d
  - path: packages/api/src/domains/spaces.ts
    sha256: e1489530a8035b42f7bd8ee8d3f35c7fe9bf5812d2943f44d667afb9a0c66816
  - path: packages/shared/src/space.ts
    sha256: 3b366a5c64ce90806c23ade9f82e74615293d0e3e1531e798ef5117b7ec8cda1
  - path: docs/product/first-use-acceptance.md
    sha256: 61dca1d66da19e2376242baf2b3421dd2f9e29814f47a233fd86b46ea9bf8a9f
---

# Onboarding, creating versus joining, and invitations

> **Simulation input only.** Every person, quote, and situation in this
> document is fictional. Nothing here is a customer record, a production
> memory, an access token, a recovery phrase, or a real location. MiroFish may
> discuss these workflows, but a simulated statement is a user belief, never
> proof that Aoi behaves that way.

**Purpose.** How a person creates a space, invites a partner, joins, and what the server treats as membership.

## Verified in current source

- Sign-in and setup are separate steps. Setup offers explicit create and join choices before the identity form (`app/(auth)/space-setup.tsx`, `components/setup/use-onboarding-flow.ts`).
- Creating a space issues a six-character-style invite code through `generateInviteCode`; the server stores a normalized form and a 30-day expiry (`INVITE_TTL_MS`, `packages/api/src/domains/spaces.ts`).
- Joining normalizes the entered code, rejects an unknown code as 404, an already-redeemed code as 400, an expired code as 400, the creator joining their own space as 409, and a space whose partner slot is already bound as 403 (`joinSpaceProgram`).
- The join write is one D1 batch: guarded invite redemption, partner membership insert, partner-name update, and one-time partner binding. Concurrent redeemers cannot both win (`joinSpaceProgram`).
- `partnerJoined` is the reliable membership signal. `inviteCode` is empty when no live unredeemed invite exists, and `inviteExpiresAt` carries the expiry (`spaceSchema`, `loadSpaceWithInvite`).
- The invitation sheet regenerates an expired code before sharing and never claims that opening the share sheet means the partner joined (`components/space/partner-invitation.tsx`).
- Account and the first-memory prompt are the stable invitation entry points; the sheet reports membership from a server read, including a manual status check (`docs/product/first-use-acceptance.md`, `PartnerInvitation`).

## Documented intent (not proof of current behavior)

- Sharing an invitation does not connect accounts until the other person signs in with their own account and joins.
- A person should understand whether they created a space or joined one, and where to go next while waiting.
- An expired displayed code must never be copyable as a valid invitation.

## Unresolved or contradicted

- Source does not show a user-facing explanation of the permanent partner binding after a partner leaves. The invitation control remains reachable while `partnerJoined` is false.
- No source establishes how quickly a partner-status refresh is expected to appear on a second phone without push.

## Fictional situation material for MiroFish

- A creator shares a code before the partner installs the app and assumes the accounts are already connected.
- A joiner reads "create a space" as the normal next step and accidentally creates a second space.
- A code is used after 30 days and the person does not know that expiry exists.
- One person finishes setup alone; the other person expects to see the same memories immediately after signing in.

## Source files

- `app/(auth)/sign-in.tsx`
- `app/(auth)/space-setup.tsx`
- `components/setup/use-onboarding-flow.ts`
- `components/setup/onboarding-wizard.tsx`
- `components/space/partner-invitation.tsx`
- `packages/api/src/domains/spaces.ts`
- `packages/shared/src/space.ts`
- `docs/product/first-use-acceptance.md`

A simulated statement about any item above is a hypothesis. Only an executed Aoi test with recorded evidence may be reported as reproduced behavior.
