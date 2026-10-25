# Flow swarm verification — 2026-10-23

Three read-only workers checked the flow map against current source and test assertions. No production code was changed by the swarm. Aoi commit: `048f7838`.

- Worker 1: A/B/H/I — auth, onboarding/pairing, account, album/recovery.
- Worker 2: C/D/E — memories capture/read/edit, Us sky.
- Worker 3: F/G/J/K/L — plans, lists, subscription, notifications/squeezes, failure states.

This is not a claim that every row was verified. Rows that were not read to the assertion level are marked unverified in the working notes.


## Corrections and fixes applied after the swarm

The swarm was read-only and one finding was wrong:

- **B22 was overstated.** An invite link opens the join step with the code filled in, but joining still requires an explicit `Join space` press (`app/(auth)/space-setup.tsx`, `onboarding-wizard.tsx` Join button). It is not a silent auto-join. The remaining risk is a person choosing the wrong signed-in account, not a missing confirmation.
- **B06 was a false positive.** The minted beat is transient by design. `SkyWelcome` on Memories does show the code, share button, and copy action (`components/home/sky-welcome.tsx:26-92`), fed by `onboarding-wizard.tsx:856-869` through `SkyEntryProvider`. The development preview bypasses that provider, which made the code appear missing there. No production fix was needed.

Fixes applied after the report:

- **B03**: the relationship date now starts empty and is optional. Create omits `relationshipStartDate` when unset; the form offers “Add your start date (optional)” and “Skip the date”.
- **H05**: Us no longer offers the creator-only date editor to the partner; it tells them to ask their partner.
- **F03/F05**: multi-day and all-day events now appear on every day they cover in the month grid, day pages, year dots, and agenda. Month/day/range reads include overlapping events consistently.
- **J02**: active Plus subscribers can now reach “Manage subscriptions” from the paywall, with a note that the link manages the store account that bought Plus.

## Original confirmed problems (fixed items marked)

| # | Flow | Evidence | Impact |
|---|---|---|---|
| 1 | **Relationship date is always today** **(fixed)** | `features/setup` flow defaults to `new Date()` (`components/setup/use-onboarding-flow.ts:139`) and always sends `relationshipStartDate` (`:255`); there is no skip/clear control. Contradicts `features/space/types.ts:11-20` and the setup acceptance flow. | Every new space gets a fabricated anniversary. Days-together, chapters, and anniversary content start from a date the person never chose. |
| 2 | **Partner can reach a relationship editor that always fails** **(fixed)** | Account hides the row (`app/(app)/account.tsx:358-364`), but Us offers “Set our start date” to every member (`app/(app)/(tabs)/together.tsx:159-161`) into an unguarded route (`app/(app)/profile/edit-relationship.tsx:23-93`). Save is creator-only on the server (`packages/api/src/routes/spaces.ts:262`). | Dead-end form for the joiner, ending in a generic “Unable to save”. The Account fix is incomplete. |
| 4 | **Invite link can join under the wrong account** | `app/_layout.tsx:150-155` forwards a code to setup with no account/creator check; `use-onboarding-flow.ts:129-130` goes straight to join. | A signed-in third account with no space can silently join the space. Account isolation gap. |
| 4 | **Multi-day and all-day events appear only on their start day** **(fixed)** | `features/calendar/calendar-date-utils.ts:120-122` buckets by `startsAt`; the month read filters on `starts_at` only (`calendar-repository.ts:190-201`). | An event saved Mar 10–12 is missing from Mar 11 and 12, even though the edit form round-trips `endsAt`. Silent content loss in the calendar. |
| 5 | **“Repeats weekly” on edit creates no occurrences** | Expansion exists only in `insertEvent` (`calendar-repository.ts:243-263`; `packages/api/src/domains/calendar.ts:288-330`). `updateEvent` writes the marker only (`calendar-repository.ts:288-289`). | A person edits an event, chooses weekly, saves, and gets no repeats while the UI implies siblings exist. |
| 6 | **Plus subscribers have no Manage subscriptions link** **(fixed)** | `app/(app)/paywall.tsx:148-160` returns early for Plus; the manage link is at `:304-322` in the unreachable branch. | A paying subscriber cannot reach store subscription management from the paywall. |
| 7 | **Squeeze cannot be sent** | `sendSqueeze` (`features/squeeze/squeeze-context.tsx:68-88`) has no caller under `app/`, `components/`, or `features/dev/`; only the receive overlay is mounted (`app/(app)/_layout.tsx:83`). | The feature is receive-only, silently. Delivery availability is hardcoded true (`:102`). |
| 8 | **Collections have no conflict handling** | `features/collections/remote-collections-repository.ts:94-100` performs a plain PATCH with no version/If-Match. | Two members editing a list/item is last-write-wins. The flow map promised a surfaced conflict; there is none. |
| 9 | **Video is promised but not supported** | Composer picker is images-only (`components/moments/inline-memory-composer.tsx:166`) and the media allowlist is image/audio (`packages/shared/src/media.ts:22,49`), while Memories empty copy says “Photos, videos and voice notes” (`app/(app)/(tabs)/(memories)/index.tsx:1333,1336`) and the edit form says “A photo or video” (`components/moments/moment-form.tsx:52`). | The UI offers a capability the pipeline rejects. |
| 10 | **Overlong memory bodies are silently truncated** | `features/composer/composer-context.tsx:475` slices to `COMPOSER_BODY_MAX` on update. | Pasting a long note loses the tail without warning. Validation should reject or count, not mutate. |
| 11 | **First album creation never shows the recovery phrase** | Archive creation is implicit (`features/album/protocol-archive.ts:377-459`, entropy at `:537`); the phrase screen only reads an existing archive (`app/(app)/album/recovery-phrase.tsx:45-59`). | A person can create the encrypted archive without ever being shown the words. Recovery depends on finding Account later. |
| 12 | **No device revocation UI** | `app/(app)/album/devices.tsx` lists only pending claims; no enrolled-device list or remove action. | Replacing a phone does not give a way to check or revoke the old device. |

## Contradictions and stale assumptions

- The flow map and product docs describe Us relationship-home sections (current activity, on-this-night, constellations, story feed) and weekly letters. The current `together.tsx` renders only the encrypted photo sky; there is no authenticated letters route.
- The memory sky component is not mounted on any tab. “Future memory does not light today’s sky” has no current user route.
- `onboarding-wizard.tsx:484-485` says the partner name “may be left blank”; the flow and Worker return 400 (`packages/api/src/__tests__/routes/spaces.test.ts:120`).
- Profile and Settings routes are redirects to Account, not independent screens.
- A “you” dedication is not a private audience. There is no audience field in the draft or moment payload; dedication only changes copy/title.
- The day timeline/reminder flow is edit-only; create has no reminder control.

## Covered and well-supported by assertions

These are not gaps:

- Calendar month empty/loading/failed separation (`plans.test.tsx:475-602`).
- Calendar read freshness, stale response rejection, save-retargeting (`calendar-context-read-freshness.test.tsx:75-243`).
- Paywall purchase isolation, no double purchase, no second subscription, real prices, policy links (`paywall.test.tsx`).
- Subscription entitlement sharing/expiry, restore, cross-account (`subscription-context.test.tsx`, `session-plus.test.ts`).
- Composer offline queue, failed-send distinction, single retry, draft durability, corrupt-manifest fail-closed (`composer-provider.test.tsx`, `composer-send.test.ts`).
- Sky empty/loading/failed states, Plus history gate, sky history stepping (`together.test.tsx`, `sky-history-screen.test.tsx`).
- Album boundary: unauthorized device, publish/decrypt, restart persistence, tombstone (`tests/integration/album-protocol-boundary.test.ts`).
- Little things/partner portrait failure and empty states (`empty-details.test.tsx`).
- Account partner edit affordance now covered (`ours-hub.test.tsx`, `tabs-structure.test.tsx`).

## Recommended execution order

1. **Fix #1 and #2 together.** The relationship date is the root cause of a whole class of wrong anniversary/day-count states; the partner editor is the visible dead end.
2. **Fix #3 and #4.** Pairing is the product's first gate. Not showing the code and accepting a wrong account are both P0.
3. **Fix #5 and #6.** Calendar content silently missing is worse than a visible error.
4. **Fix #7 and #8.** Small, self-contained, and user-visible.
5. **Fix #9, #10, #11.** List conflicts, video copy, and silent truncation.
6. **Fix #12 and #13.** Recovery enrollment and device revocation need a product decision before code.

## Limits

- The swarm was read-only. Defects are proven from source paths, not from runtime reproduction.
- Several C/D rows (feed paging, delete/edit ownership, stale write, deleted deep link, attachment caps) were not read to the assertion level and remain unverified.
- No simulator or device was used.

## Re-swarm outcome

A second read-only swarm verified the fixes and found one incomplete area, which was then fixed:

- Year-view dots and the agenda still bucketed multi-day events by their start day. Both now use `eventDayKeys`.
- `listEventsInRange` used an inclusive end while month/day reads used an exclusive end. All three implementations now use `ends_at > from`.
- B22 was overstated: joining still requires an explicit `Join space` press. It is not a silent auto-join.
- B06 was a false positive: `SkyWelcome` shows the invite code, share sheet, and copy action after creation.

A third implementation pass addressed the remaining small and medium items:

- **F06**: the nonfunctional “Repeats weekly” toggle was removed from the edit form rather than leaving a control that promises something it cannot do.
- **C19**: overlong bodies now reject with `BODY_TOO_LONG`; the editor also sets `maxLength`, so the tail is not silently sliced.
- **C06**: “videos” was removed from the empty Memories copy, the welcome tour, and the edit form description; the composer is image/audio only.
- **K08**: Us now has a “Send a squeeze” header control wired to the existing send path.
- **J09**: the quota panel now shows used/limit bytes when available and tells the person to delete media from Memories to free space.
- **L02**: a 401 that cannot be refreshed now clears the local session and signs out instead of leaving an apparently signed-in app with every read failing.
- **F02/F03/F05**: year dots and the agenda now use the same multi-day event bucketing as the month/day views; range reads use an exclusive end consistently.

Still open, because they need product or protocol decisions rather than a small patch:

- **G09** list/item conflict detection: no version/If-Match contract exists; implementing it touches shared schemas, API, repositories, and edit screens.
- **I01** recovery phrase at first album creation: archive creation is implicit and the phrase screen is read-only; a correct flow needs an explicit post-create surface and one-time state.
- **I13** device revocation: the protocol has revocation records but no client/API path to list enrolled devices or sign a revocation. This is a protocol feature, not a button.

Final verification for this pass: 2,580 unit tests, 612 integration tests (3 skipped), typecheck, lint (0 errors), and static accessibility (0 findings).
