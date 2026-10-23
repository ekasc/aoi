# App-wide interaction polish

Status: first implementation batch verified. App-wide native motion acceptance remains open. This is a verification ledger, not a claim that every interaction is smooth.

## Scope and acceptance

Preserve Aoi's couples product, existing design, native navigation, and the media fixes already in the working tree. Do not add decorative animation to every action or globally speed up transitions.

For each interaction, check immediate feedback, gesture ownership, interruption, repeat input, completion, failure/retry, leaving the screen, reduced motion, and accessibility. Test behavior, not the presence of a particular design element.

No native builds or simulators. Device checks navigate or open/close existing content only. Mutations, purchases, authentication changes, recording, and destructive actions use isolated unit tests, not personal content.

## Research used

- [Apple HIG: Motion](https://developer.apple.com/design/human-interface-guidelines/motion): purposeful motion that follows gestures, with alternatives for motion sensitivity.
- [Apple HIG: Gestures](https://developer.apple.com/design/human-interface-guidelines/gestures): familiar gesture meanings and explicit handling of conflicts.
- [React Native performance](https://reactnative.dev/docs/performance): distinguish JS responsiveness from UI-thread animation; prefer transforms for image movement; development timings are not production guarantees.
- [Reanimated 4: withTiming](https://docs.swmansion.com/react-native-reanimated/docs/animations/withTiming/): custom easing, system reduced motion, and completion callbacks that report cancellation.
- Emil Kowalski animation guidance supplied in this session: momentum, context-specific easing, interruptibility, and immediate feedback. Durations are constraints, not evidence of good feel.

These principles favor fixing blocked input, duplicate actions, and stale completion callbacks before adding motion. Native gesture feel remains a human acceptance check.

## Coverage

| Interaction family | Inspection / implementation | Verification still required |
| --- | --- | --- |
| Shared buttons and selection | Inspect press, disabled/busy state, rapid reselection, interruption | Runtime repeat-tap and reduced-motion checks |
| Native action sheets | Memory deletion now passes busy state and rejects synchronous duplicate confirmation | Delayed native close callback ordering |
| Memories feed/gallery | Hidden FAB now releases hit testing and accessibility; scrolling no longer restarts its fade on every event. Earlier media handoff and intrinsic-host carousel fix retained | Native finger paging; UI-thread scroll scheduling remains to investigate |
| Image zoom, paging, dismiss | Velocity-matched bounded return, reversal cancellation and scroll interruption implemented earlier | Human confirmation of slow drag, flick, cancel, pinch and paging |
| Audio/video | Attachment-before-play, inactive-page stop and voice scrub release fixed earlier | Native scrub, interruption and controls |
| Voice recording | Synchronous operation phases, busy feedback, cancellation across async boundaries, permission retry and deduplicated stops; failed stop retries stop if native capture is still running | Native permission/preparation/stop behavior and audio-session restoration; no personal recording performed |
| Plans month/day/year | Day pager retains its stopped page during viewport resize instead of returning to the anchor. The day heading is short enough to hold one line beside the row's actions | Native paging, year-open stalls and keyboard/detent transitions |
| Calendar editors | Create-event sheet carries its actions in the native header and is sized to its form; pending save and back are guarded in both chrome paths | Native header tap feel and the sheet's height with the keyboard open; no live calendar writes |
| Lists and items | Synchronous submit guards; completion navigation requires the same focus instance and a mounted route. Lead reviewed changes | Native navigation feel; mutations verified with isolated tests only |
| Letters and weekly question | Letter open requests serialize; stale completion cannot navigate or emit success feedback after blur/refocus or unmount. Weekly question not changed | Native navigation feel; weekly question concurrency remains to inspect |
| Us / sky / history | Inspect and navigate existing read-only surfaces | Shader/GPU performance and finger gestures are not covered by JS frame cadence |
| Account / theme / subscription | Inspect shared controls and read-only navigation. Account carries a Help row into "How Aoi works" | No live purchase, restore, sign-out, leave-space or deletion |
| Learning the app | One first-run sheet names the space and each tab in a line, plus the one line that says Account holds the rest; shown once per person per space. Letters has a plain row in Account. No toggle explainer sits over a screen | Native sheet feel on a fresh install; This week stays retired by design |
| Auth / onboarding | Inspect shared control behavior and existing tests | No live session replacement or onboarding writes |

## Implemented fixes

- Memory delete confirmation blocks pending dismissal and repeated confirmation.
- Collection forms reject same-render duplicate submissions. Editor save/remove completions cannot navigate from an old focus instance, including blur followed by refocus.
- Voice preparation and stopping serialize synchronously. Disabling or unmounting during permission/audio-mode/preparation awaits cancels the pending start. Busy controls acknowledge work immediately. Successful permission retry clears earlier denial.
- Plans day-pager resize preserves the stopped day and fractional offset.
- Letter opening rejects overlapping requests and ignores stale navigation, success haptics and errors.
- Memories FAB cannot receive taps or screen-reader focus while hidden. It starts one fade per scrolling period, not a new fade on every scroll event.
- Clipboard completion after unmount cannot allocate a feedback timer. An older completion cannot replace feedback for a newer copy.
- Device measurement scripts track foreground continuity and stop tracking in `finally`. The runner no longer prints `OK` for successful actions with large frame stalls or accepts missing foreground evidence.
- The create-event sheet's save and close moved from a bottom footer into the header it already shows, as native `Stack.Toolbar` items (xmark on the left, title, checkmark on the right, with the children strings as their accessibility names). The sheet is now sized to the form itself, so dropping the footer leaves no empty band: the scroll view reports the height it lays out and the sheet takes it, including when the form grows. Both header actions disable while a save is in flight, and closing still refuses to leave until the write finishes. Platforms without the native toolbar keep the footer, which is the only chrome their plain modal has.
- The Plans day heading no longer wraps. It read a full weekday plus the year ("Wednesday – Oct 14, 2026"), which needs about 240pt in the roughly 202pt the row leaves beside back, Today and add, so it broke after the date. It now reads "Wed – Oct 14", with the year appended only when the day is outside the current one.
- A new space now introduces itself once. The first launch shows a single sheet: "This is your space", one line about who can see it, four rows in tab order — Memories, Us, Plans, Lists — each with the tab's own glyph and one sentence, and one closing line naming Account as the home of everything that is not a tab. "Got it" closes it and stores the answer per person per space, so it never returns. Two earlier attempts were removed: a reference page with paragraphs per feature (a manual) and a header panel that toggled the two rituals open and shut. Letters had become unreachable — its only links pointed at its own writer — so Account now carries one plain "Letters" row beside the other secondary features; "This week" remains retired from the UI on purpose.

## Verification log

- Before this pass: 2,564 unit tests passed; existing unrelated edits preserved.
- Collection, letter and recorder implementations reviewed by Build. Focused collection/letter/recorder tests passed, 221 tests across 20 files. Broader composer integration tests passed after exercising actual start before synthetic recording completion.
- Full suite passed, 2,621 tests across 252 files. Typecheck and strict accessibility audit passed, zero findings across 145 files. Repository lint passed with 11 existing warnings and no errors. `git diff --check` passed.
- Browser checks through `agent-browser`: Feed/Gallery switching, feed scrolling, hidden FAB disabled during movement and restored after rest, opening the action sheet, and composer rendering. No console errors. Inspected the captured feed screenshot, which retained the current After Hours layout. Recording, saving and deleting were not performed.
- Device was connected at the start. The initial extended navigation diagnostic completed but lacked foreground evidence, so its timings are not an accepted baseline. It reported JS stalls around 110–200ms on many routes. The phone disconnected before a foreground-validated rerun; `dev:targets` reports no connected app. No claim of measured performance improvement follows from that run.
- No native build or simulator was started. The existing Metro server was reused; the temporary browser session was closed.
- Create-event sheet change: the unit-app project passed, 2,178 tests across 230 files, including four new sheet tests (one close and one save action, save from the check, the sheet frame tracking the form's measured height, and both header actions locked while the save settles). Typecheck clean. Strict accessibility audit zero findings across 145 files. Repository lint unchanged. `git diff --check` clean. No device and no simulator were available, and the route is behind authentication on web, so the native header items, the fit-to-content sheet height, and the keyboard transition remain a device check.
- Day-heading change: the plans suite passed, 107 tests across 8 files; the calendar, plans and component suites passed, 494 tests across 47 files. Typecheck clean, lint at 0 errors with the same 11 existing warnings, strict accessibility audit zero findings across 145 files. On the connected phone the header held one line for a current-year day ("Wed – Oct 14") and for a day outside it ("Fri – Jan 15, 2027", opened from the year view through January 2027); today's day view read "Tue – Oct 20". Two lines are still allowed, so larger text on a narrow phone reflows rather than truncating, and the test fixtures compute the expected heading under the same year rule because they sit in a fixed calendar year.
- First-run sheet: the full unit-app suite passed, 2,189 tests across 231 files, including seven checks on the sheet (the four rows, the closing line, dialog semantics with a name, nothing in the tree before it is shown, waiting for the space to load, appearing once, the dismissal surviving a remount, a new space counting as new), the account door for Letters, and the route-reachability guard still agreeing that This week is deep-link-only. Typecheck clean, lint at 0 errors with the same 11 warnings, strict accessibility audit zero findings across 147 files. On the device the sheet appeared over the Us sky on relaunch with all four rows, "Got it" closed it, and a reload did not bring it back; Account → Letters opened the shelf. The added closing line is covered by the sheet test, not re-screenshotted, because the one-time card had already been dismissed on that device.

- Letters overhaul: the unit-app suite passed, 2,186 tests across 231 files. Typecheck clean, lint at 0 errors with the 11 pre-existing warnings, strict accessibility audit zero findings across 148 files, `git diff --check` clean. On the device: the shelf reads as a paper envelope with a folded band, a wax seal initial and a wax stamp; the writer is a sheet with the date, the salutation and the body, and a second envelope sheet for the caption, the opening day and the seal; the opened reader is a sheet with the byline, the body and the two dates, after its right-hand line was fixed to wrap inside the paper. The three routes are now full-screen pushes instead of half-sheets. The one seeded demo letter was opened on the device to read the opened state, which is why the sealed reader is covered by tests only.

- Letters removal: the feature is gone from the app rather than hidden. Deleted `app/(app)/letters.tsx`, `app/(app)/letter/*`, `features/letters/*`, `components/letters/*`, and the dead `features/home/us-focal.ts`; removed the LettersProvider, the three routes, the Account door, the customer-facing Plus benefit and its paywall copy, the `letter_sealed` push branch, the letters dataset in the raw export, and the relationship-aware letter copy. The full unit-app suite passed, 2,079 tests across 222 files (the letters suites and their design snapshots are gone with it); typecheck clean, lint at 0 errors with the 11 pre-existing warnings, strict accessibility audit zero findings across 143 files, `git diff --check` clean. The server endpoints (`/v1/spaces/current/letters`), the shared wire types and any stored letter rows were left untouched: removing them is a backend migration with no UI surface left to drive it.

## Remaining work

Reconnect the foregrounded phone before further performance attribution. Capture a foreground-valid baseline and compare repeated samples for year open/close, tab transitions, day drill-in and route navigation. Do not choose a render optimization from the old partial phase timers alone. Preserve the preferred media return curve.

Shared selection animation interruption, sheet close/reopen ordering, weekly question concurrency, native audio-session restoration, and the remaining account/auth paths still need their own runtime checks. Purchases and destructive/account actions remain isolated from live testing.

The sibling `calendar/edit/[id]` sheet (view, edit and delete modes) still keeps its footer buttons and its fixed detents. It was not part of this request; moving it to the header chrome is the same change and needs its own decision.

## Limits

Automated native handler calls do not exercise native touch recognition. JS `requestAnimationFrame` cadence does not measure GPU frame rate. A development build cannot establish production performance. Test success alone does not establish polished motion.
