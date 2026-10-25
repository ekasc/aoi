---
seed_version: seeds-v1
status: verified
aoi_commit: 048f78383a2ff423a8b3c1f0532c4514b387708f
sources:
  - path: features/session/session-context.tsx
    sha256: 3dacf2b09117b29e6f96c7397352e5a70ad25e32e5e28d2e03b66e3221e7df15
  - path: features/space/space-context.tsx
    sha256: 501f2b23866264744b99c4f54a0f1be8c08a2c59785081388fb30ac3dcf32f30
  - path: features/space/remote-space-repository.ts
    sha256: 6e7a3a2ec7b060c9653ae0d98432b2daf936566441386fbbedfe8dc32d9c193c
  - path: packages/api/src/domains/spaces.ts
    sha256: e1489530a8035b42f7bd8ee8d3f35c7fe9bf5812d2943f44d667afb9a0c66816
  - path: packages/api/src/domains/auth.ts
    sha256: efdc5f81dfd5a92d73a522035f195e2f85e57c036a14acf5637de9097f8ce181
  - path: tests/unit/space/space-context-refresh.test.tsx
    sha256: 8c134b87d9d9a0b4fb39e597d404b4efa92a436802eddc51eeb672ba428a5c55
  - path: docs/product/first-use-acceptance.md
    sha256: 61dca1d66da19e2376242baf2b3421dd2f9e29814f47a233fd86b46ea9bf8a9f
---

# Membership, account switching, leaving, and stale responses

> **Simulation input only.** Every person, quote, and situation in this
> document is fictional. Nothing here is a customer record, a production
> memory, an access token, a recovery phrase, or a real location. MiroFish may
> discuss these workflows, but a simulated statement is a user belief, never
> proof that Aoi behaves that way.

**Purpose.** The session and space state layer, including the explicit stale-refresh guard and the gaps around mutations.

## Verified in current source

- Session restoration republishes API tokens before remote reads, so a restored session does not silently make unauthenticated requests (`features/session/session-context.tsx`).
- Signing out clears the stored session, tokens, and API token plumbing, and unregisters this device's push token while the access token is still valid (`signOut`).
- Space hydration, foreground refresh, and the create/join/update/leave/regenerate mutations are scoped to the signed-in user id, so a response from a previous account cannot write the next account's space state (`activeUser` guard, `features/space/space-context.tsx`).
- A failed manual refresh keeps the current space and rejects to the caller so the UI can report it (`refreshSpace`).
- Leaving flips the caller's membership to `left`; shared history remains for the other member. The last member leaving archives the space (`leaveSpaceProgram`, `packages/api/src/domains/spaces.ts`).
- A space that has ever had a partner is permanently bound to that pairing. A different person cannot join via a fresh or rotated code, and the former partner cannot rejoin (`joinSpaceProgram`).

## Documented intent (not proof of current behavior)

- Responses from a previous account must never overwrite the newly signed-in account's space.
- A person should not see another account's space, memories, or media after switching accounts.
- Leaving should be explained: the partner keeps history, and the leaver loses access.

## Unresolved or contradicted

- No source shows how the creator is told that a departed partner's slot can never be refilled; the invitation control can still be opened while `partnerJoined` is false.
- The UI exposes "Edit relationship" to both members, while `PATCH /v1/spaces/current` is creator-only. The partner receives a generic save failure.

## Fictional situation material for MiroFish

- A person begins joining a space, then signs out and signs in with a different account before the request completes.
- A partner leaves; the remaining person tries to invite someone new using a freshly generated code.
- A joiner opens "Edit relationship", changes the anniversary date, and saves.
- A person restores a session after the access token expired.

## Source files

- `features/session/session-context.tsx`
- `features/space/space-context.tsx`
- `features/space/remote-space-repository.ts`
- `packages/api/src/domains/spaces.ts`
- `packages/api/src/domains/auth.ts`
- `tests/unit/space/space-context-refresh.test.tsx`
- `docs/product/first-use-acceptance.md`

A simulated statement about any item above is a hypothesis. Only an executed Aoi test with recorded evidence may be reported as reproduced behavior.
