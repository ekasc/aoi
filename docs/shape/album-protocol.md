# The shared album's key protocol

Status: proposed. The code at `457168f` does not implement this. It implements
a different and smaller thing, described in the first section, and that gap is
the reason this document exists.

An audit of the branch found the primitives sound and the protocol unfinished.
AES-GCM with fresh 96-bit nonces, independent random media keys, degenerate
X25519 rejection, secrets in device-only SecureStore: all fine. What is missing
is the state machine around them. AOI can encrypt bytes correctly today and
still fail both promises the feature is built on, because the archive key is
derived from the devices that happen to exist rather than from the Space.

## What exists now

The archive key is `HKDF(X25519(myDevice.agreement, theirDevice.agreement))`.
Four consequences, all of them load-bearing:

Replacing a phone changes the archive key, because the new phone has a new
agreement key. Old ciphertext becomes unreadable.

The session path takes whichever foreign identity the server hands back and
agrees with it, with no check. The fingerprint and cross-signing code exists
and is called only from tests. A server that substitutes its own key gets a
space key it can compute.

The recovery phrase derives its own key, `spaceKeyFromRecoverySeed`, which
nothing encrypts with. Recovery of the existing archive is not implemented in
any form.

The enrolment path is disconnected. `authoriseDevice` and `restoreSpaceKey`
have no non-test callers.

There is a fifth, subtler one. `authoriseDevice` derives the envelope's
wrapping key with `spaceKeyFor(authoriser, recipient.agreementPublicKey)`, and
for the two-device case that is the same expression that produces the archive
key. So the envelope encrypts the space key under the space key. It round-trips
and the tests are green, which is exactly how a degenerate layer survives: it
is self-consistent. It provides no separation, and it is the clearest evidence
that the protocol was written after the primitives rather than before them.

## Trust model

The server is a storage provider that may be compromised, curious, or
compelled. It is not trusted to see plaintext, to decide which devices are
cryptographically authorised to decrypt the Space, or to be the only witness to
the Space's history.

Those are different authorities and the document keeps them apart. The server
still owns AOI accounts and Space membership at the application layer: who can
sign in, whose rows exist, what the app renders. That is ordinary product
authority. What it must not hold is the cryptographic authority to admit a
device to the archive.

Two things are trusted:

1. A device that was authorised by another trusted device, transitively back
   to the Space's first device.
2. The recovery secret, which bootstraps a device when no trusted device
   remains.

Nothing else. A device is never trusted because the server said so.

Each device holds an Ed25519 signing key and an X25519 agreement key,
generated on device, stored in SecureStore, never uploaded. There is no
long-lived per-person identity. A person is whoever holds a trusted device or
the recovery secret, and inventing a durable cryptographic person would only
move the replacement problem one level up without solving it. The principle:
model what you can actually verify, which is devices plus a recovery secret,
rather than an identity that has to survive hardware you do not control.

## The Space key

The Space has one random 32-byte `spaceKey`, generated once by the device that
creates the Space. It never changes for the life of generation 1. Everything
else distributes it:

```
                  spaceKey (random, stable)
                        |
        +---------------+----------------+
        |               |                |
   mediaKey A      mediaKey B      recovery envelope
        |               |          (spaceKey under
     photo A         photo B        the recovery key)

device A <--- X25519 ---> device B
                    |
              envelope wrapping key
                    |
              spaceKey sealed for B
```

Media keys stay random and per-photo. X25519 stops being the source of the
archive key and becomes only a way to seal the archive key for one device at a
time. That single change is what makes replacement, enrolment, and recovery
possible at all.

Every derivation gets its own HKDF info string. One string per purpose:
`aoi/space-key/v1` is now only ever the Space key's own name, `aoi/envelope/v1`
for envelope wrapping, `aoi/recovery/v1` for the recovery secret. The current
code reuses one string for the archive key and for envelope wrapping, and that
reuse is what allowed the degenerate envelope above.

## Device records

The Space's authority is a set of device records carrying a monotonic revision
each, written by the device it describes and authorised by a trusted device or
by recovery. It is not an append-only log: a record is mutable and the revision
is what orders writes. Keeping every historical revision would buy real
rollback detection and cost real storage, and v1 takes the cheaper side.

```
deviceRecord {
  deviceId
  spaceId
  generation
  signingPublicKey
  agreementPublicKey
  authorisedBy        // a deviceId, or 'recovery'
  authorisation       // signature over this record by the authoriser
  revision            // monotonic per deviceId
  createdAt
}
```

The server stores records and serves them. It cannot mint one, because it
cannot produce the authorising signature.

The API becomes per-device rather than one shared bag:

```
PUT /v1/spaces/current/album/devices/:deviceId
```

The server binds the record to the authenticated user and rejects a write
whose `revision` is not greater than the stored one. One row, one writer, so
no device can rewrite another's history. The current single-blob backup is what
lets a stale snapshot overwrite a partner's entry, and no amount of merging on
the server fixes that, because the server cannot tell a stale snapshot from a
fresh one.

## The envelope

The object that carries the space key to one device. Pinned here before any
code is written, because this is where an implementation and its tests drift
apart:

```
spaceKeyEnvelope {
  spaceId
  generation
  recipientDeviceId
  authoriserDeviceId
  recipientRevision      // the recipient record revision this was cut for
  nonce                  // 96-bit, random per envelope
  ciphertext             // spaceKey, sealed
}
```

Wrapping key:

```
wrappingKey = HKDF-SHA256(
  ikm    = X25519(authoriser.agreement.private, recipient.agreement.public),
  salt   = none,
  info   = 'aoi/envelope/v1' || spaceId || generation
                         || recipientDeviceId || recipientRevision,
  length = 32,
)
```

AEAD:

```
AES-256-GCM(
  key       = wrappingKey,
  nonce     = the envelope's nonce,
  plaintext = spaceKey,
  aad       = 'aoi/envelope/v1' || spaceId || generation
              || recipientDeviceId || authoriserDeviceId || recipientRevision,
)
```

The info string and the AAD carry the same binding, and both name the purpose.
Reusing one HKDF info string for the archive key and for envelope wrapping is
what produced the degenerate envelope in the current code, so the purpose
belongs in the derivation rather than in a comment beside it.

Binding `recipientRevision` makes an envelope valid for exactly one revision of
the recipient's record. When the recipient rewrites its record, the authoriser
cuts a new envelope. Slightly more work, and it removes a class of replay.

## Enrolling a device

The out-of-band comparison is the whole security property. Without it, the
server decides who your partner is.

```
new device: generate keys, publish a pending record
                     |
        server relays only public keys
                     |
both screens show   verificationFingerprint(trusted.signing, new.signing)
                     |
             humans compare
                     |
trusted device: sign the record, seal the spaceKey for the new device
                     |
new device: verify the authoriser's signature, unwrap, hold the spaceKey
```

Four details that matter.

The compared code covers both signing keys, so each side learns exactly which
key it is trusting. `verificationFingerprint` already sorts both inputs, so
both screens show the same string, which is the property that makes reading it
aloud work.

The envelope is sealed under `HKDF(X25519(trusted.agreement, new.agreement))`
with AAD covering the canonical record bytes. A server that swaps the envelope
onto a different device record breaks the AAD and the unwrap fails.

The new device verifies the authorising signature against the key the human
just confirmed, not against whatever the server listed. This is the step the
current `establishAlbumSession` skips, and skipping it is the entire finding.

The first device is its own root. It generates the space key, writes its own
record with `authorisedBy: 'self'`, and publishes a recovery envelope at the
same time. A Space with one device is a normal state, not an incomplete one.

## Recovery

The phrase is a key-encryption key, never an archive key. Two derivations,
domain separated:

```
entropy(24 words) -> recoveryWrapKey  -> seals spaceKey in the recovery envelope
                  -> recoverySigningKey -> signs records authorisedBy: 'recovery'
```

The `recoverySigningKey` has a public half published in the Space's creation
record, so every device can verify a recovery-bootstrapped record. Without it,
a recovered device could hold the key but could not prove to anyone else that
it was allowed to.

This is the honest cost, and it should be written on the screen that shows the
phrase: whoever holds the phrase can read the archive and can add devices to
it. That is already true of any recovery scheme for a shared key. Pretending
the phrase only restores read access while the signing half is derivable from
it would be a worse lie than the one the current privacy copy tells.

## Removing a device

Removal writes a signed tombstone. It does not revoke access to anything the
removed device already holds, because the space key is shared and unrotated.
Say so in the UI rather than implying otherwise.

Real revocation means a new generation: generate a new random space key and
rewrap every media key under it. A removed device is then excluded because it
never receives a generation-2 envelope, not because the API declines to serve
it objects. The server sits outside the trust boundary, so a rule the server
enforces is not a guarantee.

The honest limit: rotation cannot revoke knowledge. A device that already held
generation 1 still holds generation 1's key, and rewrapping old media does not
make it forget. If a malicious server kept the old wrapped material, that device
can still open everything sealed under generation 1.

So the guarantee is exactly this and no stronger: rotation excludes a removed
device from future generations. It does not revoke plaintext or keys the device
already possessed. v1 ships the tombstone and the generation field and does not
implement the rewrap.

Version the key format now even though rotation is not implemented. `generation`
belongs in the wrapped key and in the media record from the first release. The
principle: no routine rotation for an archive, because opening a five-year-old
photo matters more than forward secrecy, but a version field costs nothing and
retrofitting one costs a migration.

## Authenticating media metadata

Ciphertext integrity is not archive integrity. The server currently holds
`createdAt`, `personTag`, dimensions, `byteLength`, uploader, and the
wrapped-key association in the clear, all unauthenticated, so it can remix the
archive without reading a pixel: swap two records' wrapped keys to produce
wrong-key failures, reorder time, reassign whose photo it is.

The record becomes:

```
mediaRecord {
  mediaId
  spaceId
  generation
  revision
  state                 // live | deleted
  wrappedKey
  sealedNonce
  byteLength
  mimeType
  width, height
  personTag
  uploaderDeviceId
  createdAt
  signature             // by uploaderDeviceId over the canonical bytes above
}
```

Three changes, each doing one job.

The media ciphertext's AAD covers `mediaId` and `generation`, so a ciphertext
cannot be moved to another record and still decrypt.

The uploader signs a manifest over the canonical record bytes. Any device can
then verify the metadata instead of trusting the server's list. Detection beats
failure here: a bad AAD gives an indistinguishable decrypt error, and the whole
point of signing is to be able to say what went wrong. Signing buys
authenticity, not freshness, which is why `revision` is inside the signed bytes.

Deletion is a signed tombstone, not an absence. A row that is simply missing is
indistinguishable from a row the server chose not to send.

## Rollback

Two protections, and they are not the same.

Writes: the server rejects `revision <= stored`, for device records and for
media records alike, so nothing rolls a row backward through the API.

Reads: the server can still serve an old revision, and no server-side rule
prevents that. A client detects it by persisting the highest revision it has
observed, per `deviceId` and per `mediaId`, and rejecting a lower one. A delete
is a signed tombstone at a higher revision than the live record, so a
resurrected row is a lower revision and fails the same check.

The limit, stated plainly. This catches rollback of a record the client has
already seen. It does not catch omission, which is the server dropping a
`mediaId` from the list entirely, because there is no authenticated head over
the whole set. Detecting omission needs a transparency structure this product
does not need. A freshly restored device can detect neither, because it has no
memory and no second witness. Both are accepted for v1, and both belong in the
threat model rather than in a footnote.

## What the server can and cannot do

Cannot: read photos, media keys, the space key, or the phrase. Cannot forge a
device signature or a recovery signature. Cannot add a device that a human has
not confirmed.

Can: deny service; drop or withhold rows; serve stale records, detectable only
by a device that remembers a higher revision; learn that photos exist, when
they were added, how large they are, their MIME type, and their person tag;
correlate devices by network address.

## Plaintext on the device

The native store writes decrypted JPEGs to
`Paths.document/album-cache/<spaceId>` and keeps them for the life of the
install. That is inside the app sandbox and is a reasonable floor, but it is
only acceptable if the lifecycle is explicit: purge on sign-out, on leaving the
Space, on device removal, and on account deletion. Today `dispose()` is a
deliberate no-op and nothing purges.

## Invariants

1. Every valid device in a Space derives the same `spaceKey`.
2. The server cannot authorise a device by itself.
3. Losing one device does not lose the archive.
4. Losing every device requires the recovery secret, and that secret restores
   the existing archive rather than starting a new one.

Each needs a test that fails if the property is broken, not a test that the
function returns something. Concretely: a test that a device enrolled through
the flow reads a photo uploaded before it existed; a test that a server
substituting its own identity is rejected; a test that a phrase typed into a
fresh install opens media sealed before the phrase was written.

## Migration

The branch has not shipped, so the cheapest correct move is to define
generation 1 cleanly and delete the device-derived derivation rather than
carrying it. If the app has users by the time this lands, the old key is
generation 0, readable but not writable, and new uploads use generation 1.

## Open questions

Whether removal should ever trigger a real rewrap, or whether the tombstone is
the permanent answer.

Whether the recovery secret should authorise device addition, or only restore
the key. The design above has it do both, because a phrase that cannot add a
device is a phrase that strands you when your last trusted device dies.

Whether the enrolment comparison should be a number read aloud or a QR code
scanned between phones. The number works with one phone and a partner on a
call; the QR works with two phones in one room and is faster.
