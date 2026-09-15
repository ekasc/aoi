# Aoi implementation audit — 2026-09-06

Audited directly by Codex, without subagents or Pi, as requested. This is a current-state review against `docs/product/IMPLEMENTATION-PLAN.md`, not an implementation pass. Application source was not changed.

## Verdict

**Salvageable, substantially improved, not ready for paid release.** Keep the current foundation. The Story/Together/Plans direction, shared contracts, server limits, chapter/export modules, and expanded regression suite are useful work. However, privacy after separation and reliable billing have reproducible failures. Account deletion and free data export do not meet the planned trust contract. The original artwork and final visual acceptance are unfinished.

“Implemented stages” currently means substantial code exists, not that the stages' acceptance gates have passed. The canonical plan still says execution has not started; that ledger is stale and should be reconciled with evidence after repairs.

## Findings, in priority order

### 1. P1 — A replacement partner can read the previous relationship's memories

**Source:** `packages/api/src/domains/spaces.ts:549`, `:585`; join logic in the same module. Leaving marks a member left but preserves the space. The creator can issue another invite and admit a different partner to that same historical space.

**Reproduced:** A creates a space; B joins and writes a private note; B leaves; A creates another invite; C joins successfully. C's moments API returns B's note, including its body and author identity. This is an actual authorization outcome in the local database harness, not a hypothetical UI concern.

**Required repair:** Enforce the planned invariant that a new pairing gets a new space. Preserve the remaining partner's legitimate history without admitting a replacement to it. Add a lifecycle test with A/B/C covering notes, media, letters, plans and exports, including attempts through old invites.

### 2. P1 — A transient webhook failure permanently loses a paid entitlement event

**Source:** `packages/api/src/domains/plus.ts:186–197`, entitlement write at `:287–317`.

The webhook records its deduplication ID before applying the entitlement. These operations are not one atomic transaction. A later database failure returns 500, but the retry is acknowledged as a duplicate and never applies the purchase.

**Reproduced:** Inject one failure on entitlement insertion. First delivery returns 500; retry returns 200 with `reason: duplicate`; the space remains free.

**Required repair:** Commit event completion and entitlement mutation atomically, or use a durable inbox with retryable processing state. Record success only after application. Add failure injection between each durable step and a reconciliation path for already-lost events.

### 3. P1 — An older renewal reactivates an expired/revoked entitlement

**Source:** `packages/api/src/domains/plus.ts:110–126`, `:240–243`, `:275–304`.

The ordering check only reads an active, unexpired row. Once an EXPIRATION event makes the row inactive, its timestamp stops protecting the entitlement. An older renewal takes the new-grant path and overwrites the inactive row.

**Reproduced:** Initial purchase → EXPIRATION at T+300 → delayed RENEWAL at T+100. The space changes from inactive to active despite the renewal preceding the expiration.

**Required repair:** Retain and compare the provider event watermark independently of current entitlement liveness. Enforce ordering in the database write, including concurrent deliveries. Cover inactive/expired rows, duplicate timestamps, purchaser changes and both partners subscribing.

### 4. P1 — “Permanently deletes your account” only soft-deletes identity

**Source:** `packages/api/src/domains/auth.ts:211–250`; user-facing promise in `app/(app)/space.tsx:520` and `app/(app)/settings.tsx:44`.

Deletion revokes sessions/push tokens, marks membership left, and sets `users.deleted_at`. It does not erase/anonymize the retained name/email/provider identity or schedule a durable account purge. The media retention cron is not an account deletion workflow. Preserving a partner's shared memories can be deliberate; indefinitely retaining the deleted person's account identity is a separate concern.

**Required repair:** Define retained shared content versus purged personal data, implement a durable retryable purge, and make the confirmation/privacy policy describe the actual outcome and retention period. Verify failure recovery, last-member deletion and backup retention. Do not label soft deletion permanent erasure.

### 5. P2 — Regenerating an invitation leaves the old code usable

**Source:** `packages/api/src/domains/spaces.ts:546–566`.

Regeneration inserts an additional invitation without revoking earlier unused invitations.

**Reproduced:** Create space → regenerate code → join using the original code succeeds with HTTP 200.

**Required repair:** Atomically invalidate superseded invitations when rotating. Test the old code, concurrent redemption/rotation and archived spaces. This is separate from finding 1: fixing replacement membership does not make rotation revoke a leaked code.

### 6. P2 — Legacy Profile and Settings routes still become tabs

**Source:** `app/(app)/(tabs)/_layout.tsx:37–76`; `app/(app)/(tabs)/profile.tsx:7`; `app/(app)/(tabs)/settings.tsx:8`.

The layout declares three screens, but the two compatibility redirects remain inside the tab route group without `href: null`. The installed Expo Router appends undisclosed route children to the ordered screens (`node_modules/expo-router/build/useScreens.js`, `getSortedChildren`). Declaring three screens does not exclude the other two.

The navigation test mocks the explicit declarations and therefore cannot detect route discovery. This finding is source/framework verified; authenticated browser rendering was blocked by web sign-in (see verification limits).

**Required repair:** Hide compatibility routes explicitly or move the redirects outside the tab group while preserving intended deep links. Verify the actual rendered navigation contains exactly Story, Together and Plans.

### 7. P2 — Deleting a memory does not free its media allowance

**Source:** `packages/api/src/domains/moments.ts:578–589`; usage query in `packages/api/src/domains/plus.ts:604–605`.

The deletion batch tombstones the moment and creates an activity event, but leaves linked media live. Usage sums pending/complete media rows whose `deleted_at` is null, independently of moment visibility. The media retention sweep cannot reclaim this as deleted media. Consequently, deleting a photo memory does not provide the expected way to recover quota.

**Evidence level:** Source traced; no native upload/delete walkthrough performed.

**Required repair:** Define media ownership/references and tombstone unreferenced media through a durable deletion process. Make quota reclamation and physical retention consistent with the disclosed policy. Test shared references, retry and deletion during processing.

### 8. P2 — Plus state can remain stale after payment or changing spaces

**Source:** `features/subscription/subscription-context.tsx:72–82`, `:115–186`, `:201–210`.

Server Plus state is scoped to account/session changes, not the active space. Purchase performs a single server refresh immediately after the store response, although webhook delivery can occur later. There is no corresponding subscription-context retry/focus reconciliation, and the public `refresh` refreshes store information only. A successful buyer can retain a free server snapshot; the same user changing spaces can retain the previous space's snapshot.

**Evidence level:** Source traced; real store purchase timing was not tested. Backend checks still protect server-enforced actions; this does not establish unrestricted backend access.

**Required repair:** Key authoritative state by user and space, clear it on membership transitions, and reconcile pending purchases with bounded retries and foreground refresh. Show activation pending distinctly from purchase failure. Test delayed webhook delivery and leave/join without signing out.

### 9. P2 — Native export cleanup has an empty production implementation

**Source:** `features/export/keepsake-assets.ts:129–145`, cleanup call at `:176`.

Image manipulation produces intermediate photo files and returns their URIs, but the production `removeTempFiles` dependency is an empty async function. Calling cleanup therefore does not delete these generated copies. Mocked cleanup tests do not establish that the native adapter removes files.

**Required repair:** Delete tracked intermediates on success/failure, handle partial transformation failure, and audit account-switch cleanup for export files. Keep a deliberately saved keepsake separate from incidental caches. Verify filesystem contents on a device after repeated exports and failures.

### 10. P2 — CI's API build step cannot detect build failure

**Source:** `.github/workflows/ci.yml:68`; `packages/api/package.json` scripts.

CI calls `build`, but the package defines `build:cloudflare`. It suppresses stderr and converts every failure into a successful echo. The actual Worker build passes locally in this audit, but future build regressions would not fail this gate.

**Required repair:** Run the actual non-publishing build script and propagate failures. Check app/API/shared typechecks and migration validation independently rather than treating one app check as proof of all packages.

## Product and visual completeness

### Artwork remains specified rather than delivered

`docs/design/asset-manifest.md` still marks welcome, first-memory, invitation and envelope artwork as needed; chapter cover grammar is defined but the asset deliverable remains needed; icon/splash work is needed. Licensed demo photography is also absent. Removing fonts with unclear redistribution rights was a good decision. A system font stack is acceptable, but it does not complete the promised brand work. Some asset inventory references now point to retired files and need reconciliation.

The web welcome screen renders as a large typographic wordmark, short promise and authentication buttons. It establishes a restrained direction but does not demonstrate the planned original visual identity or explain the tangible keepsake outcome. The captured screenshot may include entry animation; do not use it to certify final contrast.

### Onboarding is shorter, but still carries setup work

`components/setup/onboarding-wizard.tsx:25–161` still takes the user through a post-auth welcome, an “About you two” form (own name, optional partner, date, photo), then a first-memory step with photo/note/voice choices. Optional fields are an improvement, but they still compete for attention before Story. This differs from the planned short setup followed by contextual invitations in Story.

Finish the simplified sequence: establish identity/space, enter Story, present one first-memory action, and reveal date/partner customization contextually. Capture should preserve drafts across interruptions. Evaluate this with real small-phone rendering, keyboard and permission-denial cases before declaring it solved.

### Free raw export is missing

The current designed chapter export is not the planned free JSON + media account export. No corresponding raw export workflow was found among the active Worker routes. This is a P7 deliverable, separate from polishing the premium PDF. Users should retain data retrieval after Plus expiry and before deletion.

### Paid value is plausible, not yet validated

The coherent proposition is a shared archive that becomes an attractive keepsake. Chapters give a concrete reason to consider paying; adding more feature categories would weaken the current improvement. Verify an actual sparse and photo-rich PDF, both partners' access and repeat use before treating pricing hypotheses as validated demand. No customer research or willingness-to-pay evidence was established by this audit.

## Stage assessment against the saved plan

| Phase | Current assessment | Remaining acceptance gap |
| --- | --- | --- |
| P0 foundation | Improved | Checks pass; source protection/history and ledger remain unclear without Git metadata |
| P1 design system/assets | Partial | Tokens/font cleanup exist; original assets and native visual acceptance remain |
| P2 navigation | Partial | Three-tab intent exists; legacy route discovery defeats it |
| P3 onboarding | Partial | Optional setup improved; contextual flow and live acceptance incomplete |
| P4 Story/capture | Substantial implementation | Media deletion/quota lifecycle and real upload interruption evidence needed |
| P5 Together/Plans | Substantial implementation | Real envelope artwork, device interactions and two-user acceptance remain unverified |
| P6 keepsake | Implemented foundation | Real native export inspection and cleanup; lifecycle/entitlement reliability |
| P7 trust | Not complete | Replacement-partner privacy, genuine account purge, free raw export |
| P8 monetization | Not safe to launch | Reproduced retry/order failures; client reconciliation; real store lifecycle evidence |
| P9 release | Partial | CI build gate incorrect; native/store/operational acceptance not established |

These are gate assessments, not percentages or a claim that every feature in each phase was exhaustively tested.

## Verification performed

- `node_modules/.bin/tsc --noEmit`: passed.
- `node_modules/.bin/vitest run`: **108 files, 1,250 tests passed**, 195.31 seconds.
- `node_modules/.bin/eslint app components constants features hooks packages tests --quiet`: passed. This verifies no reported lint errors under `--quiet`; it is not a zero-warning claim.
- From `packages/api`, `./node_modules/.bin/vite build`: passed; no deployment performed.
- Direct HTTP requests to `createApp(makeTestHarness().layer)` with isolated synthetic users/database: reproduced findings 1, 2, 3 and 5. No production accounts or data were used.
- An additional synthetic webhook with `entitlement_id: null` returned 400. This is a contract-compatibility follow-up, not a ranked provider defect until compared against current official payload fixtures. Audit actual TRANSFER/refund/grace payloads too; passing internally constructed fixtures is insufficient evidence.
- Existing Expo server at port 8081: welcome renders at 390×844. Google sign-in does not reach setup on web: `features/auth/oauth-client.ts:188` calls the native-only platform resolver before stub handling. This limits preview testing; it does not prove native OAuth failure.
- Inspected current source, route discovery, lifecycle/billing paths, asset manifest and saved implementation plan. No subagents used.

No simulator, native build, device purchase, store submission or production action was performed. No complete authenticated visual walkthrough, screen-reader review, real PDF inspection, production migration rehearsal or two-device end-to-end flow was established. These remain necessary acceptance work, not implied successes from the unit suite.

## Recommended next sequence

1. Fix relationship lifecycle/invite privacy and specify permanent deletion/free export. Add adversarial two-partner-plus-replacement tests first.
2. Repair webhook atomicity/order and space-scoped client reconciliation. Test actual provider fixtures, delayed delivery and two subscribers; then run store sandbox cases on both platforms.
3. Connect media deletion to quota/retention, implement export cleanup and correct CI's build command.
4. Finish the three-tab navigation, contextual onboarding and original asset family. Review empty and mature Story/Together/Plans/Space screens on actual phones, including dark mode and large text.
5. Inspect real keepsake exports and run the complete two-user journey. Reconcile the implementation ledger with evidence, then undertake a limited product beta before store release.

Do not restart the app or expand its feature list. Repair the trust boundary and finish the experience already promised.
