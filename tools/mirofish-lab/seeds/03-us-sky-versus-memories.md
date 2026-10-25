---
seed_version: seeds-v1
status: verified
aoi_commit: 048f78383a2ff423a8b3c1f0532c4514b387708f
sources:
  - path: app/(app)/(tabs)/together.tsx
    sha256: e3b18aa20edd188c11a22c466cd611b7f835f6cead81a35c0f7d879884472a98
  - path: components/home/memory-sky.tsx
    sha256: e3bb4016fbb079f07ea6edd43ef082935af1deb18f12214eccee60cc30bb1b06
  - path: features/home/day-sky.ts
    sha256: f98c8397c27579cf3bf4e35de08970f098c5ca1f29c84edd99264c22748a6fc4
  - path: features/album/sky-photo-repository.ts
    sha256: d92d2e90e6ff8b57ab9051c355a6ad8259d0bacf820ca628929ecb2a3280386a
  - path: features/moments/moments-context.tsx
    sha256: c8c8fd44f3abe4136778020eed51884d831e00f2733e2a57e925d45c49ce8d00
  - path: docs/product/relationship-home-and-archive.md
    sha256: b7880500c07bd9ca767571ed9614e1112c59c3a462be1d6a3af64a2eea9e99ac
---

# Us photo sky versus the dated memory archive

> **Simulation input only.** Every person, quote, and situation in this
> document is fictional. Nothing here is a customer record, a production
> memory, an access token, a recovery phrase, or a real location. MiroFish may
> discuss these workflows, but a simulated statement is a user belief, never
> proof that Aoi behaves that way.

**Purpose.** Why the sky and Memories are separate, what each action changes, and where ambiguity remains.

## Verified in current source

- Us renders a relationship sky and chronological shared activity from the shared moments store; Memories is the complete reading and media-browsing destination (`docs/product/relationship-home-and-archive.md`).
- Sky photos are stored through a separate sky-photo repository and are not dated memories (`features/album/sky-photo-repository.ts`).
- A published memory with a future occurrence date remains in the archive but does not light today's sky (`docs/product/relationship-home-and-archive.md`).
- Us does not add a second notification schedule, and on-this-day is an editorial heading over the existing same-month/day rule.
- Free and Plus see the same relationship home; the sky is not an entitlement branch.

## Documented intent (not proof of current behavior)

- A person should be able to predict where an added photo will appear without knowing the implementation.
- Encryption and partner-sharing behavior are visible before choosing sky photos.
- The archive and the sky are complementary, not duplicates.

## Unresolved or contradicted

- The source intentionally keeps sky photos and dated memories separate; no migration or cross-posting exists. The product documentation calls the relationship between the two paths unresolved for usability.
- Whether the sky icon and label are understood is untested.

## Fictional situation material for MiroFish

- A person adds a photo in Us and then searches Memories for it.
- A person saves a memory with a photo and expects the sky to change immediately.
- A person assumes deleting a sky photo deletes the underlying camera-roll copy.

## Source files

- `app/(app)/(tabs)/together.tsx`
- `components/home/memory-sky.tsx`
- `features/home/day-sky.ts`
- `features/album/sky-photo-repository.ts`
- `features/moments/moments-context.tsx`
- `docs/product/relationship-home-and-archive.md`

A simulated statement about any item above is a hypothesis. Only an executed Aoi test with recorded evidence may be reported as reproduced behavior.
