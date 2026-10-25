---
seed_version: seeds-v1
status: verified
aoi_commit: 048f78383a2ff423a8b3c1f0532c4514b387708f
sources:
  - path: features/album/protocol-client.ts
    sha256: 78c8118155c8d62299a260ec1d53e89852b3511e89edad63fd915efe2c4c5f27
  - path: features/album/protocol-trust.ts
    sha256: 01fe73393179d8331cb0e83c4e8382413c005b0e3c7dd8ac6ba267b6ffea6f77
  - path: features/album/protocol-recovery.ts
    sha256: 211c9876a093f47290c81b7ffcd6bfe915588a003633cf57009d8e1428c3202e
  - path: features/album/recovery.ts
    sha256: f6c9e6b4f3967ee53b971c7701fe2786cc804f043dac5a6b0a654daf701b2417
  - path: app/(app)/album/recovery-phrase.tsx
    sha256: 43cfc10d15f10b04e00f3ad1736c55b590f5c7f7d05d6edb2b64a3bf12143211
  - path: app/(app)/album/restore.tsx
    sha256: 4361fbf8c08409fd112a5aaceff6cca930a357fa2289ff1937abd90104e6fea9
  - path: tests/integration/album-protocol-boundary.test.ts
    sha256: 71578dc843fd6bc2526c8aa6c8b93fec61b5997a9b189ce0368e4225f202e13e
  - path: TESTING.md
    sha256: 8758caa10b0e1f216e8098b354ac99a4fe0798d83d9b1ecf9bbd58950b98452d
---

# Album device authorization, recovery phrases, and restoration

> **Simulation input only.** Every person, quote, and situation in this
> document is fictional. Nothing here is a customer record, a production
> memory, an access token, a recovery phrase, or a real location. MiroFish may
> discuss these workflows, but a simulated statement is a user belief, never
> proof that Aoi behaves that way.

**Purpose.** The encrypted album protocol, enrollment, device trust, recovery, and what remains device-only.

## Verified in current source

- The shared album is a separate encrypted protocol with device identities, signatures, trust anchors, enrollment approval, and tombstones (`features/album/protocol-*.ts`, `TESTING.md`).
- Enrollment and recovery are explicit state transitions; the integration boundary suite exercises claim, approve, accept, media publish/retrieve/decrypt, deletion persistence, and recovery with a replacement identity (`tests/integration/album-protocol-boundary.test.ts`).
- Restoring from a typed recovery phrase keeps the typed phrase on failure rather than discarding it; the UI has explicit error and retry states (`tests/unit/album/album-error-retry.test.tsx`).
- A device that is not enrolled cannot read the archive; the boundary tests assert unauthorized identities receive 404/401.
- Recovery phrases and keys are device/secret material. The lab must never generate, copy, or log a real phrase.

## Documented intent (not proof of current behavior)

- A replacement phone can restore access with the phrase, and an interrupted restore can be retried.
- Old or lost devices do not silently retain access after replacement.
- The archive survives a device wipe when recovery material is available.

## Unresolved or contradicted

- The product path for a person who has neither the phrase nor another trusted device is not established in source.
- The E2E recovery flows require an authorized device environment; no simulator or emulator is started by this lab.

## Fictional situation material for MiroFish

- A person replaces a phone and restores while on a slow connection.
- A person cannot find the paper phrase and asks whether the partner can approve the new phone.
- An old phone is sold; the person expects it to lose access immediately.

## Source files

- `features/album/protocol-client.ts`
- `features/album/protocol-trust.ts`
- `features/album/protocol-recovery.ts`
- `features/album/recovery.ts`
- `app/(app)/album/recovery-phrase.tsx`
- `app/(app)/album/restore.tsx`
- `tests/integration/album-protocol-boundary.test.ts`
- `TESTING.md`

A simulated statement about any item above is a hypothesis. Only an executed Aoi test with recorded evidence may be reported as reproduced behavior.
