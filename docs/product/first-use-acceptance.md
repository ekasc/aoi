# First use and two-person reliability

Current priority is making the existing app understandable and dependable. Store submission follows acceptance of these flows. Physical testing belongs to the owner. The product guidance and acceptance rules are the same on iPhone and Android.

## What a new person needs to understand

Aoi is a space for two people to save memories and make plans together. One person creates a space, then the other signs in with their own account and joins it. Sharing an invitation does not connect the accounts until the other person finishes joining.

The first useful action is saving one memory. Someone can start before their partner joins, and the partner can read that saved memory after joining. A person should be able to find that action, complete it, and understand whether it was saved without an explanation from the maker.

The app map is:

- Memories holds shared notes, photos, videos and voice memories. The add button opens the memory editor. Gallery shows saved media.
- Us holds the shared photo sky. Choosing photos here is an explicit action.
- Plans holds calendar events and shared planning.
- Lists holds ideas and collections the couple keeps together.
- The avatar opens Account. How to use Aoi reopens the guide.

## Changes made in this pass

- Sign-in explains creating or joining a space and returning with the same account.
- Help opens only when requested from Account and offers a route to Memories. No automatic tour interrupts first use.
- The setup handover explains what the other person does with an invitation and where the creator goes next.
- The first-memory action says Add your first memory. The empty gallery has its own action to open the editor.
- Invite your partner is available from Account and the first-memory prompt, rather than floating above every tab. It opens code sharing, joining instructions and a manual status check. Sharing does not claim delivery or successful pairing. Expired codes are regenerated before sharing; expired displayed codes cannot be copied as valid invitations.
- Invitation messages explain how to join when the app link does not open.
- Us uses a sky icon instead of an envelope.
- Space membership refreshes on returning to the foreground, even without push. Manual refresh failures reach the UI while preserving existing space data. Responses from the previous account cannot overwrite a newly signed-in account's space.

These changes have automated evidence. They have not passed physical usability or two-phone acceptance.

## Owner's physical acceptance run

Use two independent test accounts on the same build and backend. Disable development seed and stub auth. A run with the same account on both phones does not establish that invitations, membership or partner attribution work. Use disposable test content.

Record the build, date, accounts and result for each scenario. Avoid recording access tokens, invite codes, recovery phrases or personal media in shared bug reports.

### Arrival and pairing

- [ ] On phone A, start signed out. Explain what the app is for after reading the opening screen. Create a space without coaching.
- [ ] Skip the optional relationship date. Confirm that setup completes and no date is invented.
- [ ] Before inviting anyone, add one short memory. Confirm its saved or pending status is understandable.
- [ ] After leaving setup, tap your avatar to open Account and find Invite your partner. Open it, cancel sharing, and confirm that the app still says the partner has not joined.
- [ ] Send the invite. On phone B, sign in with a different account and join the existing space. Confirm the code fallback is understandable if the link does not open.
- [ ] Verify both people see the same space and the memory saved before pairing, with the correct author.
- [ ] With notifications denied, return phone A to the foreground and verify the waiting state changes after joining. Also exercise the explicit partner-status check.
- [ ] Try a wrong or expired code. Confirm there is a useful error and a way to correct it without restarting setup or creating another space.

### Shared actions

- [ ] Save a note on A. Read it on B. Repeat from B to A. Check attribution and timestamps.
- [ ] Save a photo, video and voice memory in both directions. Check playback, orientation and the gallery. Confirm adding media requires an explicit selection or recording.
- [ ] Add photos to the Us sky. Verify the intended shared photos appear on the other phone and that any device approval or recovery requirements are explained.
- [ ] Create and edit a plan in each direction. Check date, time, all-day behavior, ownership and the result on the other phone.
- [ ] Create a list and add or change an item from the other phone. Confirm both copies converge after refresh.
- [ ] Edit or remove disposable content you own. Verify the other person sees the update and cannot use controls that imply ownership of your content.

### Failures and return visits

- [ ] Start a memory offline. Attempt to save. Confirm the app preserves the work, distinguishes pending or failed from saved, and offers a useful recovery action.
- [ ] Reconnect and use the available retry. Confirm one memory arrives, without duplicates.
- [ ] Deny photo, microphone and notification permissions in separate attempts. Confirm the relevant action explains what happened and can recover without blocking unrelated features.
- [ ] Background and reopen both apps. Confirm they restore the correct space, pick up partner changes and do not require a new invitation.
- [ ] Sign out of a test account and into a different test account. Confirm the previous person's space and media do not flash or return after delayed requests finish.
- [ ] Confirm no guide opens automatically. Open How to use Aoi from Account. Follow its Memories action, then find your way back to the other tabs.
- [ ] Increase text size and test the guide, invite sheet and composer. Confirm the content and actions remain reachable. Repeat in light and dark appearances.

Acceptance requires understandable status and recovery as well as successful saves. Any lost draft, duplicate save, wrong account's data, inaccessible next action or falsely reported success blocks this gate. Store setup does not resolve those failures.

## Evidence and limits

Automated checks exercise setup actions, invitation sharing and renewal, guide dismissal and navigation, first-memory and gallery navigation, foreground membership refresh, failed reads, and stale account responses. They use controlled dependencies and cannot establish OS permission behavior, native sheet layout, live notification delivery, real media transfer or whether a person understands the UI.

The attempted web inspection failed with browser navigation and snapshot timeouts. No rendered or physical acceptance is claimed. The temporary Metro server and preview tab were closed after that attempt.

Verification for this pass:

- Eight focused journey test files passed, 73 tests. These cover setup, joining, invitations, help, and membership refresh.
- The final guide, invitation, membership and tab-navigation rerun passed, 38 tests across four files.
- Two focused feed tests passed for first-memory and empty-gallery navigation. Other tests in that file were intentionally excluded from that run.
- Both push-context files passed. The tab test initially failed because it pinned the old envelope icon. Its design snapshot assertions were removed while retaining the existing no-hearts rule; the navigation rerun passes.
- App typechecking passed with `NODE_OPTIONS=--max-old-space-size=768 ./node_modules/.bin/tsc --noEmit --pretty false`.
- Scoped ESLint passed with no errors and one existing unused-import warning in the feed. `node scripts/a11y-audit.mjs` reported zero findings across 143 files.
- No full-suite, physical-device or rendered-screen acceptance is claimed. Checks ran sequentially with one test worker. No temporary preview or Metro process from this pass remains running.


## Research implementation follow-up

The research assessment led to an optional guide and contextual invitations. The floating invitation and automatic-tour hook were removed. Account contains the stable relationship membership and invitation section, and the first-memory prompt offers a secondary invitation action. Adding a memory remains the primary action.

Us now explains that sky photos and dated memories are separate destinations. Photo encryption and partner sharing remain visible before choosing photos. Sky date guidance still refers to the date a photo was added. No storage migration or automatic cross-posting was introduced.

DeepSeek v4.1 Flash implemented the frontend through OpenCode under a scoped brief. Codex reviewed the source, corrected wording and privacy-copy regressions, and owns the final verification. The owner retains physical testing.

Final verification after the research implementation and owner review:

- 210 focused tests passed across 23 files. This includes the guide, invitations, space state, navigation, Us, dedication actions and the Memories feed.
- App typecheck passed with a 768 MB heap cap.
- Scoped implementation lint passed with no errors and one existing unused `bump` import warning in the Memories feed.
- Static accessibility audit reported zero findings across 142 files.
- `git diff --check` passed. The OpenCode helper and verification processes completed; no new server or device session was launched.

Exact test command:

```sh
NODE_OPTIONS=--max-old-space-size=512 pnpm exec vitest run --project unit-app --maxWorkers 1 tests/unit/info tests/unit/space tests/unit/navigation tests/unit/together tests/unit/components/foundations.test.tsx tests/unit/moments/story-feed.test.tsx
```

Typecheck and accessibility commands:

```sh
NODE_OPTIONS=--max-old-space-size=768 ./node_modules/.bin/tsc --noEmit --pretty false
node scripts/a11y-audit.mjs
```

This is scoped automated evidence. The full unit suite, rendered layout and physical two-phone acceptance remain unverified in this pass.

## Reliability and rendered follow-up

The later [reliability verification](../reports/2026-10-22-reliability-verification.md) supersedes the earlier browser limitation for the sampled screens. Codex inspected setup, first-memory invitations, optional help, Lists, Agenda, Us and Account through the real development preview screens.

Setup now scrolls on short screens, keeps its footer after its form, and fits invite-code cells within the page gutters. Create and join actions are reachable at 320 by 568. Account preserves the chosen anniversary calendar day across time zones. Plans only identifies a month as empty after its own successful read; older reads and late save refreshes cannot replace the selected month's window.

The same first-use guidance applies on iPhone and Android. Platform keyboard handling follows the existing native conventions. Browser geometry does not establish native keyboard, gesture, audio-routing or permission behavior. The owner's physical checklist above remains open, including the two-phone shared-memory loop. Preview routes also omit the bottom tab navigator, so the rendered samples do not establish complete native navigation acceptance.
