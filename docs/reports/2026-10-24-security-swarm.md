# Security swarm — 2026-10-24

Three T3-owned security reviewers ran against Aoi `048f7838` and the current working tree. The first batch used Codex by mistake; that violates the DeepSeek-only policy. The two Codex tasks were blocked by the provider’s cybersecurity filter. Their scopes were rerun on `opencode-go/deepseek-v4.1-flash`, and the one Codex task that completed (abuse/business logic) is being rerun on DeepSeek. Open abuse findings from that Codex run are provisional until the DeepSeek rerun confirms them. A local OASIS security-focus run also produced 25 abuse-oriented scenarios.

No deployed service was contacted. Findings were reproduced with the in-memory Effect/D1/R2 harness or proven from source.

## Fixed in this pass

| # | Finding | Fix | Regression |
|---|---|---|---|
| 1 | **Keepsake export could send the viewer’s bearer token to an attacker host** because `uri.startsWith(apiBase)` treated `https://api.test.local.outside.test` as same-origin. | `classifyPhotoSource` now compares parsed URL origins; only true app-origin media is `authed`. | `tests/unit/export/keepsake-export.test.ts` host-prefix collision case. |
| 2 | **Invite rotation race could grant membership while returning an error.** The batch redeemed conditionally but inserted the member unconditionally. | Membership, partner-name, and partner-binding writes are all conditional on the same redemption winning in the batch. | Existing pairing/spaces suites. |
| 3 | **Rejected media could retain storage while leaving quota.** Sanitizer marked a failed row but kept the object; failed rows were excluded from usage. | Terminal failure now deletes the object with `deleteKeyConfirmed` and zeroes `size_bytes` only on confirmed deletion; failed rows are counted while bytes remain. | Media and quota suites. |
| 4 | **Any member could tombstone the partner’s media** by attaching it to their own moment and deleting that moment; deleting a note also released the partner’s photo reply. | Media release now requires `created_by_user_id = caller`; response media is released only when the caller owns it. | `session-media-lifecycle` non-owner delete case. |
| 5 | **A former member could complete an upload after leaving**, charging the remaining partner’s quota. | `completeUploadProgram` requires an active membership of the media’s space; non-members get 404. | Media lifecycle suites. |
| 6 | **403/404 existence oracle on another space’s memory.** | Membership is checked before ownership; non-members get 404 like a missing row; same-space non-owners still get 403. | `moments-concurrency` updated to 404. |
| 7 | **Failed last-member leave could leave a live invite** into a space with no active members. | Leave is one atomic batch: membership flip, location cleanup, invite revocation, archive-if-abandoned. | Space lifecycle/pairing suites. |
| 8 | **Enrolment fingerprint did not cover the agreement key** that actually receives the Space key. A malicious server could swap only that key. | `verificationFingerprint` hashes all supplied keys; `enrolmentFingerprint` and `joiningFingerprint` include signing **and** agreement keys. | Album protocol/screens. |
| 9 | **A revoked device could accept an enrolment offer** because the authoriser was checked by provenance, not current trust. | `acceptEnrolmentOffer` parses tombstones and uses `verifyDeviceTrust`. | Album protocol suite. |
| 10 | **A revoked device still reached `ready`** and could read/upload/delete because its own authority used provenance. | `establishProtocolArchive` checks its own device with `verifyDeviceTrust`. | Album protocol suite. |
| 11 | **Any member could tombstone the partner’s media** by deleting their own reference. | Media release requires the caller to own the media; response media is released only when the caller owns it. | `session-media-lifecycle` non-owner case. |
| 12 | **Failed last-member leave could leave a live invite** into an empty space. | Leave is one atomic batch: membership flip, location cleanup, invite revocation, archive-if-abandoned. | Space lifecycle/pairing suites. |
| 13 | **A former member could complete an upload after leaving** and charge the remaining partner. | Completion requires active membership of the media’s space. | Media lifecycle suites. |
| 14 | **403/404 existence oracle on another space’s memory.** | Membership is checked before ownership; non-members get 404; same-space non-owners get 403. | `moments-concurrency` expects 404. |
| 15 | **Enrolment fingerprint omitted the agreement key.** | `verificationFingerprint` hashes all keys; approver and joiner include signing + agreement. | Album protocol/screens. |
| 16 | **A revoked device could accept an enrolment offer.** | `acceptEnrolmentOffer` parses tombstones and uses `verifyDeviceTrust`. | Album protocol suite. |

## Confirmed, not fixed

| Severity | Finding | Location |
|---|---|---|
| High | Reusing an outstanding upload URL after leaving can replace a completed original with same-length bytes; originals are served without hash/ETag revalidation. | `domains/media.ts` presign/serve; `media-processing.ts` hash skip. |
| Medium | A second purchaser can overwrite the first purchaser’s still-valid Space subscription. | `domains/plus.ts` conflict handling. |
| Medium | A revocation event before the first grant loses its ordering watermark, so a later delayed grant can activate Plus. | `domains/plus.ts` no-row branch. |
| Medium | `putObject` treats 412 as success, so foreign bytes at a key can be published as ours. | `features/album/protocol-client.ts`; `protocol-archive.ts` finalize. |
| Medium | Web builds can write private keys, recovery entropy, and the creation bootstrap to AsyncStorage/localStorage without a dev-only gate. | `protocol-local-state.ts`, `local-key-store.ts`, `app.json` web output. |
| Low | Deletion revision is caller-supplied and can sign a tombstone that does nothing. | `protocol-archive.ts` remove. |
| Low | Decrypted album cache is in the default iOS backup set, with no file-protection class. | `album-photo-store.native.ts`. |
| Low | Archived spaces are not enforced on every write path (moments/collections/calendar/letters/someday). | domain reads/writes. |
| Low | Legacy `mediaPreview` / `audioUri` are free-form and can make the partner’s client fetch an arbitrary URL. | shared moment schema; moments domain. |
| Medium | Media service still has a 403/404 distinction in some paths (complete is fixed; serve is not). | `domains/media.ts`. |

## Unverified hypotheses

- Sandbox RevenueCat events could grant production Plus because `environment` is not checked.
- TRANSFER payload compatibility with real provider payloads is unverified.
- The webhook route parses the full JSON body before authorization; no application-level body limit was tested.
- Suspended/revoked device uploads signed before revocation remain valid for peers; documented v1 limit, not fixed.

## Security OASIS run

`pnpm mirofish -- --live --security --rounds 2` ran nine couples through security-focused prompts:

- 25 scenarios extracted
- 4 representative executable scenarios passed
- 2 covered, 15 partial, 8 not automatable

The OASIS output is abuse narrative, not proof of a vulnerability. The code-level findings above are the security evidence.

## Verification

```text
Unit:          2,582 passed
Integration:   611 passed, 3 skipped
Typecheck:     passed
Lint:          0 errors, 11 existing warnings
Accessibility: 0 findings across 142 files
```

No deployed service, production data, or real credential was used.
