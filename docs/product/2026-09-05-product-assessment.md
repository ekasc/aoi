# Aoi product assessment — 5 September 2026

## Verdict

Aoi is salvageable. It has a substantial Expo client, shared contracts, and a Cloudflare Worker backend. Rebuilding it would discard useful work without resolving the main problem: too many features and no finished, trustworthy paid outcome.

Current maturity: a broad development product, not a verified store release. Source implementation is not proof that two people can use it reliably on different phones. Existing claims that only dashboard setup remains are contradicted by the code.

This is a source-based assessment. No customer interviews, live competitor research, production inspection, or native device testing were performed. Willingness to pay remains a hypothesis. No existing source files were removed during assessment; nothing inspected justifies discarding the entire implementation. This workspace has no Git metadata.

## Recommended product

**A private living keepsake for two: save the little things now, enjoy your story together later.**

Start with couples who already save photos, messages, and anniversary memories but lack a shared place to revisit them, including couples split across iOS and Android. Long-distance use is compatible, but the product should not depend on location tracking.

The reason to pay must be the resulting keepsake and confidence it will survive a phone change. A calendar, generic question bank, or second sealed letter is insufficient differentiation on its own. People already have chats, shared albums, notes, and calendars.

The core loop should be:

1. One person creates a space and adds a meaningful first memory immediately.
2. Their partner joins through an easy invitation and sees that memory.
3. Either person adds a photo, short note, voice memory, or future letter in under a minute.
4. Both revisit a growing story through a weekly reflection, resurfaced memory, or monthly chapter.
5. Aoi offers an upgrade after demonstrating the keepsake, with one purchase covering the couple.

No streaks, relationship scores, mandatory daily questions, or pressure when the partner is inactive. The first person should still receive value while waiting for an invitation to be accepted.

## Keep, reshape, defer

| Area | Current evidence | Recommendation |
| --- | --- | --- |
| Timeline, photos, notes, voice | Screens, remote repositories, media pipeline, ownership rules, tests | Keep as the center; finish capture, processing, recovery, retrieval, and sync |
| Letters | Local and remote implementations; future opening; client free limit | Keep as emotional differentiation; verify scheduling, recipient privacy, time zones, delivery and recovery |
| Memory wall | Gallery built from loaded moments | Keep inside the story; evolve toward monthly/anniversary chapters instead of selling a gallery alone |
| Weekly question | Twenty repeating prompts; two-person reveal | Keep as an optional creation prompt; preserve answers in the story; not a standalone paid content library |
| Calendar, proposals, Someday | Multiple planning surfaces and domain implementations | Consolidate into lightweight plans and important dates; defer a general scheduling product |
| Live location, partner map | Background permissions, platform services, approval/retention logic | Remove from the first release's scope and paid proposition; disable entry points and background registration together in implementation |
| Squeeze | Small affectionate interaction | Optional secondary detail; not a main destination or reason to subscribe |
| Little things | AsyncStorage repository keyed to user | Sync securely or defer; device-only storage is a poor fit for a lasting keepsake |
| Profile and Settings | Separate primary tabs | Merge account controls into a secondary destination; aim for Story, Together, Plans |
| Splash lab and alternate concepts | Development route and experimental components | Exclude from release navigation/build where appropriate; remove unused experiments after dependency inspection |
| Legacy Node/Postgres API | Retained beside Worker/D1 implementation and tests | Retire after confirming deployment ownership and preserving necessary migration evidence; do not rewrite the Worker |
| Marketing and ship docs | Conflicting pricing and unsupported capability claims | Replace with one approved product contract before publishing |

Deferring a feature is a scope decision, not evidence that its implementation is unsalvageable. Preserve existing user data when retiring functionality.

## Concrete blockers

### 1. Stored memories can be deleted after a database failure

`packages/api/src/programs/cron.ts:175–212`: the orphan sweep catches failure to read known media keys and substitutes an empty result. Every listed object then appears orphaned and is eligible for deletion. This is a release blocker for a memory product. Abort destructive cleanup on lookup failure; verify variant-write races, bounded pagination, and retries as part of the repair.

### 2. Space setup with a photo has an ordering conflict

`components/setup/use-setup-flow.ts:149–163` uploads the photo before creating the space. `packages/api/src/domains/media.ts:131–133` rejects uploads without an active space. A new user selecting a photo can be blocked from completing onboarding. Create the space first, then attach the photo with a recoverable retry, or defer the photo until setup is complete.

### 3. The paid promise is not implemented as sold

`features/subscription/subscription-context.tsx` simulates a successful purchase through AsyncStorage when a store key is absent, without a development-only guard. It tracks customer entitlements on the client and has no corresponding couple entitlement backend in the mounted Worker routes. `app/(app)/paywall.tsx` nevertheless promises one subscription for both partners.

`features/subscription/limits.ts` advertises memory wall, live location and unlimited voice; inspected feature gates only restrict letter creation in the client. Store key selection also falls back across platforms. Subscription identity reset, plan selection, expiry/refund behavior, restore results and missing configuration need explicit handling. Do not take money against the current promise.

### 4. Account and relationship lifecycle promises disagree with behavior

`app/(app)/(tabs)/settings.tsx:48–50` says deletion permanently deletes both people's shared data and requests email confirmation, but the alert collects no email. `packages/api/src/domains/auth.ts` soft-deletes the user, revokes sessions/tokens, and marks membership left. It does not perform the advertised content purge. The inspected cron does not complete account deletion.

The leave confirmation claims archiving and partner notification; `leaveSpaceProgram` changes membership and removes location rows. No archive transition or notification is performed there.

Define ownership, removal of authored content, retained partner content, invite reuse, archive access, export, and deletion retention before repairing the flow. A breakup must not unexpectedly expose an earlier partner's content to a replacement partner. Raw data export and deletion must not require Plus.

### 5. The enduring archive experience is incomplete

`features/moments/moments-context.tsx:132–140` fetches every page on refresh. Memory wall depends on loaded moments. This needs incremental pagination and retrieval appropriate to years of memories, not only a small demo dataset.

The inspected code has resurfacing but no complete monthly chapter/export product. Local stub repositories do not establish production offline support. `features/partner-details/partner-details-repository.ts` stores details only on the device. Verify interrupted uploads, processing failures, drafts, reinstall, cross-device restore, partner changes and loss of access.

### 6. Published claims need replacement

`marketing/03-pricing.md` promises a $9.99 lifetime relationship, 5 GB, end-to-end encryption, offline support, export and archiving. `docs/MONETIZATION.md` instead proposes $4.99/month or $39.99/year and defers partner entitlement sharing until after revenue. The current server processes plaintext content and media; reserved encryption fields are not E2EE.

The old README/PLAN also describe a superseded backend and stale completion status. Marketing includes illustrative testimonials and refund/economic assumptions that must not be treated as established facts. Do not publish these documents as current product truth.

### 7. Store readiness is unproven

EAS profiles, package identifiers, native auth, push registration and purchase integration exist. That is useful groundwork. It does not prove sign-in, invitations, push delivery, media playback, permissions, subscription renewal or restore on release builds.

Settings and paywall need working privacy/terms/support and subscription management destinations. Complete account deletion, the public deletion request path, accurate store privacy disclosures, accessibility, permission denial, notification controls, tablet/small-screen behavior, and review instructions. Validate current Apple/Google requirements at submission time.

## Paid offer to validate

Use a free shared space that genuinely demonstrates the experience. Both partners can create memories, use important dates, answer the optional reflection, read existing content, export their data and leave safely. Give a modest, clearly disclosed media allowance.

Test one Plus subscription per couple, with annual as the main offer and monthly available. The existing $39.99/year and $4.99/month are starting hypotheses, not validated pricing. Plus should buy a larger media allowance, multiple future letters, and finished monthly/anniversary keepsakes with designed export. Basic raw export stays free. Do not promise unlimited storage or perpetual cloud service for a small one-time fee.

Build a real sample chapter before the upgrade decision. When a subscription ends, preserve reading, deletion and export; restrict additional premium creation/storage with clearly explained limits. Backend owns entitlement, quotas, sharing, refunds and expiry. Define subscription ownership when a couple separates or changes spaces.

Estimate contribution margin from measured media size, retention, storage operations, delivery, processing, platform fees, refunds and support. The old marketing revenue forecasts are assumptions, not traction or a cost model.

## Completion order and acceptance gates

1. **Protect the foundation.** Repair cleanup, setup ordering, release configuration and misleading lifecycle/purchase behavior. Establish a runnable verification baseline and a recoverable source snapshot. Gate: failure-injection tests prove valid media survives database/storage faults; first-time setup works with and without a photo.
2. **Finish one two-person journey.** Reduce navigation; first memory before decorative setup; clear waiting/invite state; partner joins and contributes; uploads show recoverable progress; consistent empty/error states. Gate: two fresh accounts on iOS and Android complete it against the real API, including interruption and relaunch.
3. **Deliver the keepsake.** Incremental browsing, finding older memories, optional reflection, monthly chapter, future letter and export. Gate: representative multi-year data remains responsive and the exported artifact contains the expected memories and media.
4. **Finish trust and separation.** Export, account deletion, membership/ownership, privacy/support pages, permission controls, retention and recovery procedures. Gate: a former or new partner cannot access content outside the agreed lifecycle rules; deletion matches the disclosed policy.
5. **Make Plus real.** Server-owned couple entitlements and quotas, real store offers, restore/manage, expiry/refund and account-change behavior. Gate: sandbox purchases on both platforms grant exactly the purchased benefits to the intended couple without granting another account access.
6. **Run a small beta before public paid launch.** Suggested pilot: 10–15 couples over four weeks. Observe whether both join, contribute and revisit voluntarily, whether they value the chapter, and whether they actually purchase at the offered price. Track content-free events only. This is directional evidence, not statistical proof.
7. **Release.** Current store policy review, signed release builds, device accessibility/permission checks, privacy disclosures, support, monitoring and recovery rehearsal. Submit only after the product and operational gates pass.

Do not use number of implemented screens or passing mocked tests as the completion criterion. The paid outcome is a dependable shared keepsake that both people choose to return to.

## Verification

Source inspection covered product/marketing docs, routes/navigation, onboarding, client repositories, subscription logic, media domains/processing/cleanup, account/space lifecycle and build/test configuration. Automated baseline results are recorded below after execution. No native build, simulator, deployment or purchase was initiated.

- `pnpm run typecheck`: passed. pnpm first restored dependencies automatically in this workspace.
- `node_modules/.bin/vitest run`: passed, 88 test files and 1,005 tests, 124.59 seconds. The configured projects include mocked mobile tests, API/shared tests and a Worker spike; this does not establish native end-to-end readiness.
- `node_modules/.bin/eslint .`: failed, 67 errors and 129 warnings; the broad scan includes historical `.stversions` files.
- `node_modules/.bin/eslint app components constants features hooks packages tests --quiet`: failed with two conditional-hook errors in `features/moments/moments-context.tsx:380`. Quiet mode suppresses warnings.
- No production data or service configuration was inspected. No old source was deleted, no application behavior changed, and no deployment was attempted. This assessment is the only authored project change.
