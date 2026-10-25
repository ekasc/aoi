---
seed_version: seeds-v1
status: verified
aoi_commit: 048f78383a2ff423a8b3c1f0532c4514b387708f
sources:
  - path: features/moments/moments-context.tsx
    sha256: c8c8fd44f3abe4136778020eed51884d831e00f2733e2a57e925d45c49ce8d00
  - path: features/moments/use-story-feed.ts
    sha256: c124c2fe057474c1541d34adfcad2b94e478753f1c630dc4cd44d5850a388e42
  - path: features/moments/ownership.ts
    sha256: fb2268d2ba3f072fc91eaf842a0a18cc0e1766193ee4850b1122950af7733c99
  - path: features/composer/send-pipeline.ts
    sha256: 68cbe824c4fd5c817d30abe6107473a9168d409438f705cb01fc14efbdb19ad3
  - path: features/composer/composer-machine.ts
    sha256: 33652888dda418e3fa9baa64ae0e7c5075d37569ccb0de041e7bf974e4e58e94
  - path: packages/api/src/domains/moments.ts
    sha256: 5018dfcdd841e812a6a62bb6f8ff3ea775285bbfea78b26bee5e8fd68d2de4a3
  - path: packages/shared/src/moment.ts
    sha256: c9925c8598c4c35718959ef23251a34f65f8f8dc011171348996ec0cc7e4b8e9
  - path: docs/product/first-use-acceptance.md
    sha256: 61dca1d66da19e2376242baf2b3421dd2f9e29814f47a233fd86b46ea9bf8a9f
---

# Shared memories, saving, editing, deleting, and authorship

> **Simulation input only.** Every person, quote, and situation in this
> document is fictional. Nothing here is a customer record, a production
> memory, an access token, a recovery phrase, or a real location. MiroFish may
> discuss these workflows, but a simulated statement is a user belief, never
> proof that Aoi behaves that way.

**Purpose.** The memory pipeline, idempotent saves, optimistic concurrency, tombstones, and viewer-relative attribution.

## Verified in current source

- A memory can be a note, photo, video, voice recording, or goal; the shared schema carries type, title, body, occurrence time, optional target time, media, and attachments (`packages/shared/src/moment.ts`).
- Creating with a `clientId` is idempotent via a partial unique key on `(space_id, client_id)` for live rows. A replay returns the first result rather than creating a second row (`createMomentProgram`).
- Editing and deleting use the observed `updatedAt` as a compare-and-swap. A stale write returns 409 with no activity row; a write scoped to another user is 403; a read of an already-deleted moment is 404 (`packages/api/src/domains/moments.ts`).
- Only the author may edit or delete their own memory. The API projects `isOwn` and a viewer-relative `authorName` (`"You"` for the caller, the other member's live name otherwise).
- Deleting a memory is a tombstone, not a hard delete. Attached media is released only when no other live moment references it, in the same batch as the tombstone (`momentToApi` / delete path).
- The composer preserves a failed or pending send and exposes retry/remove controls; a preview being visible is not the same as a completed server write (`features/composer/*`, `docs/product/first-use-acceptance.md`).

## Documented intent (not proof of current behavior)

- Both people can contribute asynchronously and see the same shared archive after refresh.
- A failed save must be distinguishable from a saved one, and retry must not duplicate.
- The other person cannot use controls that imply ownership of content they did not write.

## Unresolved or contradicted

- The exact user-visible distinction between "pending upload" and "saved memory with media still uploading" is spread across composer and feed state; no single contract string is asserted by the API tests.
- No source establishes how a partially uploaded attachment is presented to the partner.

## Fictional situation material for MiroFish

- Two people edit the same note at nearly the same time; one expects a merge and the other expects an error.
- A photo appears in the feed while its upload is still pending; the author closes the app.
- A partner opens a memory while the author deletes it.
- A retry is tapped several times after a timeout.

## Source files

- `features/moments/moments-context.tsx`
- `features/moments/use-story-feed.ts`
- `features/moments/ownership.ts`
- `features/composer/send-pipeline.ts`
- `features/composer/composer-machine.ts`
- `packages/api/src/domains/moments.ts`
- `packages/shared/src/moment.ts`
- `docs/product/first-use-acceptance.md`

A simulated statement about any item above is a hypothesis. Only an executed Aoi test with recorded evidence may be reported as reproduced behavior.
