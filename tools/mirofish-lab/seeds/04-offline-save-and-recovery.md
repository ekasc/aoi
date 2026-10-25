---
seed_version: seeds-v1
status: verified
aoi_commit: 048f78383a2ff423a8b3c1f0532c4514b387708f
sources:
  - path: features/composer/send-pipeline.ts
    sha256: 68cbe824c4fd5c817d30abe6107473a9168d409438f705cb01fc14efbdb19ad3
  - path: features/composer/composer-machine.ts
    sha256: 33652888dda418e3fa9baa64ae0e7c5075d37569ccb0de041e7bf974e4e58e94
  - path: features/composer/secure-draft-store.ts
    sha256: 46c6c6ea6174f82540d025b7bd1cf665c11f02fe82a21fde1422078b670578ed
  - path: features/moments/moments-context.tsx
    sha256: c8c8fd44f3abe4136778020eed51884d831e00f2733e2a57e925d45c49ce8d00
  - path: tests/unit/hooks/moments-context-remote.test.tsx
    sha256: 2f128b880b932c6fcc96996dbe43febadd8e1603d5560b33cee7bc6afc20a792
  - path: tests/unit/composer/composer-send.test.ts
    sha256: bdaec56277866d52447fc31db4eb0617bcc2613fac197bad1c0baaa38521c807
  - path: docs/product/first-use-acceptance.md
    sha256: 61dca1d66da19e2376242baf2b3421dd2f9e29814f47a233fd86b46ea9bf8a9f
---

# Offline, pending, failed, and retried saves

> **Simulation input only.** Every person, quote, and situation in this
> document is fictional. Nothing here is a customer record, a production
> memory, an access token, a recovery phrase, or a real location. MiroFish may
> discuss these workflows, but a simulated statement is a user belief, never
> proof that Aoi behaves that way.

**Purpose.** What survives a lost connection, how the composer distinguishes states, and what the tests actually prove.

## Verified in current source

- The composer has an explicit state machine with draft, preparing, sending, sent, pending, and failed outcomes (`features/composer/composer-machine.ts`).
- A send failure preserves the draft and exposes retry/remove rather than silently discarding it (`features/composer/send-pipeline.ts`, composer tests).
- The remote moments context merges pages and reconciliation data rather than replacing the local list wholesale (`features/moments/moments-context.tsx`, `tests/unit/hooks/moments-context-remote.test.tsx`).
- A create with the same `clientId` is idempotent at the API boundary, which is the server-side guard against duplicate retries (`packages/api/src/domains/moments.ts`).
- The first-use checklist requires that offline work is preserved, pending/failed is distinct from saved, and retry produces one memory without duplicates (`docs/product/first-use-acceptance.md`).

## Documented intent (not proof of current behavior)

- Closing the app or losing signal should not lose a draft that the person believes was kept.
- A retry after reconnect should converge to one memory.
- A failed read must not be presented as an empty archive.

## Unresolved or contradicted

- No test establishes the full two-phone offline loop; most evidence is unit-level with controlled dependencies.
- The exact behavior when storage is full during an upload is not asserted end to end.

## Fictional situation material for MiroFish

- A person writes offline, sees a pending badge, force-closes the app, and reopens it.
- A timeout is followed by three retry taps.
- A person switches from Wi-Fi to mobile data while a video upload is in flight.

## Source files

- `features/composer/send-pipeline.ts`
- `features/composer/composer-machine.ts`
- `features/composer/secure-draft-store.ts`
- `features/moments/moments-context.tsx`
- `tests/unit/hooks/moments-context-remote.test.tsx`
- `tests/unit/composer/composer-send.test.ts`
- `docs/product/first-use-acceptance.md`

A simulated statement about any item above is a hypothesis. Only an executed Aoi test with recorded evidence may be reported as reproduced behavior.
